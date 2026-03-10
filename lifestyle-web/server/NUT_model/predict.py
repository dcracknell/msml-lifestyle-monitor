import argparse
import datetime
import hashlib
import json
import platform
import sys
from pathlib import Path


DEPENDENCY_INSTALL_MESSAGE = (
    "PyTorch is not installed. Run "
    "`python -m pip install -r lifestyle-web/server/NUT_model/requirements.txt`."
)


def parse_args():
    parser = argparse.ArgumentParser(description="Run CANet food photo inference.")
    parser.add_argument("--image", help="Path to the image to classify.")
    parser.add_argument("--model", required=True, help="Path to the .pth checkpoint.")
    parser.add_argument("--labels", required=True, help="Path to the FoodSeg103 label JSON.")
    parser.add_argument("--top-k", type=int, default=5, help="Number of candidate classes to return.")
    parser.add_argument(
        "--image-size",
        type=int,
        default=512,
        help="Square resize used before inference.",
    )
    parser.add_argument(
        "--self-check",
        action="store_true",
        help="Validate imports, labels, and checkpoint compatibility without loading an image.",
    )
    args = parser.parse_args()
    if not args.self_check and not args.image:
        parser.error("--image is required unless --self-check is used.")
    return args


def require_runtime():
    try:
        import PIL
        import torch
        import torchvision
    except ImportError as error:
        raise RuntimeError(DEPENDENCY_INSTALL_MESSAGE) from error

    return {
        "PIL": PIL,
        "torch": torch,
        "torchvision": torchvision,
    }


def build_model(num_classes):
    import torch.nn as nn
    from torchvision.models import resnet50

    class ResNetEncoder(nn.Module):
        def __init__(self):
            super().__init__()
            backbone = resnet50(weights=None)
            self.conv1 = backbone.conv1
            self.bn1 = backbone.bn1
            self.relu = backbone.relu
            self.maxpool = backbone.maxpool
            self.layer1 = backbone.layer1
            self.layer2 = backbone.layer2
            self.layer3 = backbone.layer3
            self.layer4 = backbone.layer4

        def forward(self, x):
            x = self.conv1(x)
            x = self.bn1(x)
            x = self.relu(x)
            x = self.maxpool(x)
            x = self.layer1(x)
            x = self.layer2(x)
            x = self.layer3(x)
            x = self.layer4(x)
            return x

    class CANetFoodModel(nn.Module):
        def __init__(self, classes):
            super().__init__()
            self.backbone_cls = ResNetEncoder()
            self.backbone_seg = ResNetEncoder()
            self.cls_head_conv = nn.Conv2d(2048, classes, kernel_size=1)
            self.seg_head_conv = nn.Conv2d(2048, classes, kernel_size=1)

        def forward(self, x):
            cls_features = self.backbone_cls(x)
            seg_features = self.backbone_seg(x)
            cls_logits = self.cls_head_conv(cls_features).mean(dim=(2, 3))
            seg_logits = self.seg_head_conv(seg_features)
            return cls_logits, seg_logits

    return CANetFoodModel(num_classes)


def load_labels(labels_path):
    labels = json.loads(Path(labels_path).read_text(encoding="utf-8"))
    if not isinstance(labels, list) or not labels:
        raise ValueError("FoodSeg103 labels JSON must contain a non-empty list.")
    normalized = [str(label).strip() for label in labels]
    if len(set(normalized)) != len(normalized):
        raise ValueError("FoodSeg103 labels JSON must not contain duplicate labels.")
    return normalized


def fingerprint_file(file_path):
    target = Path(file_path).resolve()
    digest = hashlib.sha256()
    with target.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return {
        "path": str(target),
        "fileName": target.name,
        "sizeBytes": target.stat().st_size,
        "sha256": digest.hexdigest(),
    }


def load_image(image_path, image_size):
    from PIL import Image
    import torchvision.transforms as transforms

    transform = transforms.Compose(
        [
            transforms.Resize((image_size, image_size)),
            transforms.ToTensor(),
            transforms.Normalize(
                mean=[0.485, 0.456, 0.406],
                std=[0.229, 0.224, 0.225],
            ),
        ]
    )

    image = Image.open(image_path).convert("RGB")
    return transform(image).unsqueeze(0)


def extract_prediction(model, image_tensor, labels, top_k):
    import torch

    with torch.no_grad():
        cls_logits, seg_logits = model(image_tensor)
        cls_probs = torch.softmax(cls_logits, dim=1)[0]
        seg_probs = torch.softmax(seg_logits, dim=1)[0].mean(dim=(1, 2))
        blended = (cls_probs * 0.7) + (seg_probs * 0.3)
        top_scores, top_indices = torch.topk(blended, k=min(top_k, len(labels)))

    matches = []
    for score, index in zip(top_scores.tolist(), top_indices.tolist()):
        matches.append(
            {
                "name": labels[index],
                "confidence": round(float(score), 4),
            }
        )

    return {
        "name": matches[0]["name"],
        "confidence": matches[0]["confidence"],
        "topMatches": matches,
    }


def load_checkpoint(torch_module, model_path):
    try:
        checkpoint = torch_module.load(model_path, map_location="cpu", weights_only=False)
    except TypeError:
        checkpoint = torch_module.load(model_path, map_location="cpu")
    state_dict = checkpoint.get("model_state", checkpoint)
    if not isinstance(state_dict, dict):
        raise ValueError("Checkpoint does not contain a valid model state dictionary.")
    return checkpoint, state_dict


def validate_checkpoint(labels, checkpoint, state_dict):
    cls_head_shape = tuple(state_dict["cls_head_conv.weight"].shape)
    seg_head_shape = tuple(state_dict["seg_head_conv.weight"].shape)
    cls_head_classes = cls_head_shape[0]
    seg_head_classes = seg_head_shape[0]
    labels_count = len(labels)

    if cls_head_classes != labels_count or seg_head_classes != labels_count:
        raise ValueError(
            "Label count does not match checkpoint heads: "
            f"labels={labels_count}, cls={cls_head_classes}, seg={seg_head_classes}."
        )

    return {
        "labelsCount": labels_count,
        "clsHeadClasses": cls_head_classes,
        "segHeadClasses": seg_head_classes,
        "checkpointEpoch": int(checkpoint.get("epoch")) if "epoch" in checkpoint else None,
    }


def run_self_check(args):
    runtime = require_runtime()
    labels = load_labels(args.labels)
    checkpoint, state_dict = load_checkpoint(runtime["torch"], args.model)
    metadata = validate_checkpoint(labels, checkpoint, state_dict)
    model_fingerprint = fingerprint_file(args.model)
    labels_fingerprint = fingerprint_file(args.labels)

    model = build_model(len(labels))
    model.load_state_dict(state_dict, strict=True)
    model.eval()

    return {
        "ready": True,
        "checkedAt": datetime.datetime.utcnow().isoformat() + "Z",
        "pythonVersion": platform.python_version(),
        "torchVersion": getattr(runtime["torch"], "__version__", None),
        "torchvisionVersion": getattr(runtime["torchvision"], "__version__", None),
        "pillowVersion": getattr(runtime["PIL"], "__version__", None),
        "modelPath": model_fingerprint["path"],
        "modelFileName": model_fingerprint["fileName"],
        "modelSizeBytes": model_fingerprint["sizeBytes"],
        "modelSha256": model_fingerprint["sha256"],
        "labelsPath": labels_fingerprint["path"],
        "labelsFileName": labels_fingerprint["fileName"],
        "labelsSizeBytes": labels_fingerprint["sizeBytes"],
        "labelsSha256": labels_fingerprint["sha256"],
        **metadata,
    }


def run_prediction(args):
    runtime = require_runtime()
    labels = load_labels(args.labels)
    checkpoint, state_dict = load_checkpoint(runtime["torch"], args.model)
    validate_checkpoint(labels, checkpoint, state_dict)

    model = build_model(len(labels))
    model.load_state_dict(state_dict, strict=True)
    model.eval()

    image_tensor = load_image(args.image, args.image_size)
    return extract_prediction(model, image_tensor, labels, args.top_k)


def main():
    args = parse_args()
    result = run_self_check(args) if args.self_check else run_prediction(args)
    json.dump(result, sys.stdout)


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)

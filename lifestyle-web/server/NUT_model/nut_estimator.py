import argparse
import hashlib
import json
import os
import subprocess
import sys
from datetime import datetime, timezone

BOOTSTRAP_FILE_PATH = os.path.abspath(__file__)
BOOTSTRAP_FILE_DIR = os.path.dirname(BOOTSTRAP_FILE_PATH)
if os.path.basename(BOOTSTRAP_FILE_DIR) == "__pycache__":
    BOOTSTRAP_FILE_DIR = os.path.dirname(BOOTSTRAP_FILE_DIR)
LAUNCH_SCRIPT_PATH = (
    BOOTSTRAP_FILE_PATH
    if BOOTSTRAP_FILE_PATH.endswith(".py")
    else os.path.join(BOOTSTRAP_FILE_DIR, "nut_estimator.py")
)
LOCAL_VENV_ROOT = os.path.join(BOOTSTRAP_FILE_DIR, ".venv")
LOCAL_VENV_PYTHON = os.path.join(BOOTSTRAP_FILE_DIR, ".venv", "bin", "python")
LOCAL_VENV_WINDOWS_PYTHON = os.path.join(
    BOOTSTRAP_FILE_DIR,
    ".venv",
    "Scripts",
    "python.exe",
)

def maybe_rerun_with_local_venv():
    for candidate in (LOCAL_VENV_PYTHON, LOCAL_VENV_WINDOWS_PYTHON):
        if not os.path.exists(candidate):
            continue
        if os.path.abspath(sys.prefix) == os.path.abspath(LOCAL_VENV_ROOT):
            return False
        completed = subprocess.run(
            [candidate, LAUNCH_SCRIPT_PATH, *sys.argv[1:]],
            check=False,
            capture_output=True,
            text=True,
        )
        if completed.stdout:
            sys.stdout.write(completed.stdout)
        if completed.stderr:
            sys.stderr.write(completed.stderr)
        raise SystemExit(completed.returncode)
    return False


maybe_rerun_with_local_venv()


try:
    import numpy as np
    import requests
    import torch
    import torch.nn.functional as F
    import torchvision
    from PIL import Image, __version__ as PILLOW_VERSION
    from torchvision import transforms
except ModuleNotFoundError:
    maybe_rerun_with_local_venv()
    raise

try:
    import cv2
except ImportError:  # pragma: no cover - optional dependency for plate scaling only.
    cv2 = None

FILE_DIR = BOOTSTRAP_FILE_DIR
PROJECT_ROOT = os.path.dirname(FILE_DIR)
if PROJECT_ROOT not in sys.path:
    sys.path.insert(0, PROJECT_ROOT)

from NUT_model.models.canet import canetSeg  # noqa: E402


NUM_CLASSES = 104
PLATE_DIAMETER_MM = 270.0
DEFAULT_IMAGE_SIZE = 448
DEFAULT_THICKNESS_MM = 20.0
MIN_SEGMENT_RATIO = 0.025
FALLBACK_MM_PER_PIXEL = 0.5
USDA_TIMEOUT_SECONDS = 8
USDA_API_KEY = os.environ.get(
    "USDA_API_KEY",
    "zOQeCfbzL5dav3dFHsbbUf1XjQEs4gZoxkiZubfF",
)

DEFAULT_DATASET_ROOT = os.path.abspath(os.path.join(FILE_DIR, "..", "data", "FoodSeg103"))
DEFAULT_IMAGE_PATH = os.path.abspath(
    os.path.join(DEFAULT_DATASET_ROOT, "custom-images", "sausage.jpg")
)
DEFAULT_MODEL_PATH = os.path.abspath(os.path.join(FILE_DIR, "checkpoint", "canet_NUT.pth"))
DEFAULT_LABELS_PATH = os.path.abspath(os.path.join(DEFAULT_DATASET_ROOT, "category_id.txt"))

DEVICE = "cuda" if torch.cuda.is_available() else "cpu"

FOOD_DENSITY = {
    "broccoli": 0.37,
    "cabbage": 0.45,
    "carrot": 0.80,
    "cauliflower": 0.50,
    "celery": 0.40,
    "cucumber": 0.96,
    "eggplant": 0.72,
    "garlic": 0.60,
    "ginger": 0.80,
    "lettuce": 0.15,
    "mushroom": 0.40,
    "onion": 0.90,
    "pepper": 0.60,
    "potato": 0.77,
    "pumpkin": 0.60,
    "radish": 0.75,
    "spinach": 0.20,
    "tomato": 0.94,
    "zucchini": 0.94,
    "apple": 0.61,
    "banana": 0.94,
    "blueberry": 0.72,
    "cherry": 0.80,
    "grape": 0.72,
    "kiwi": 0.95,
    "lemon": 0.96,
    "mango": 0.85,
    "orange": 0.96,
    "pear": 0.59,
    "pineapple": 0.50,
    "strawberry": 0.60,
    "watermelon": 0.96,
    "rice": 0.85,
    "fried_rice": 0.88,
    "noodles": 0.80,
    "spaghetti": 0.85,
    "pasta": 0.85,
    "bread": 0.27,
    "toast": 0.30,
    "bagel": 0.40,
    "hamburger_bun": 0.35,
    "pizza": 0.55,
    "dumpling": 0.90,
    "beef": 1.02,
    "steak": 1.02,
    "pork": 1.01,
    "bacon": 0.95,
    "ham": 1.02,
    "sausage": 0.96,
    "chicken": 0.80,
    "fried_chicken": 0.75,
    "turkey": 1.02,
    "lamb": 1.03,
    "fish": 1.00,
    "salmon": 1.05,
    "shrimp": 1.03,
    "crab": 1.02,
    "lobster": 1.03,
    "oyster": 1.05,
    "egg": 1.03,
    "fried_egg": 1.02,
    "boiled_egg": 1.03,
    "cheese": 1.10,
    "butter": 0.96,
    "yogurt": 1.03,
    "milk": 1.03,
    "chips": 0.35,
    "french_fries": 0.45,
    "popcorn": 0.12,
    "cracker": 0.30,
    "cookie": 0.40,
    "cake": 0.45,
    "donut": 0.31,
    "soup": 1.01,
    "salad": 0.20,
    "burger": 0.55,
    "sandwich": 0.50,
    "hot_dog": 0.65,
    "taco": 0.60,
    "burrito": 0.70,
    "fried_food": 0.80,
    "ketchup": 1.09,
    "mayonnaise": 0.91,
    "mustard": 1.01,
    "soy_sauce": 1.18,
    "default": 0.80,
}


def utc_now_iso():
    return datetime.now(timezone.utc).isoformat()


def safe_float(value):
    try:
        numeric = float(value)
    except (TypeError, ValueError):
        return None
    if not np.isfinite(numeric):
        return None
    return numeric


def round_or_none(value, digits=2):
    numeric = safe_float(value)
    if numeric is None:
        return None
    return round(numeric, digits)


def round_or_zero(value, digits=2):
    numeric = safe_float(value)
    if numeric is None:
        return 0.0
    return round(numeric, digits)


def load_foodseg103_class_names(labels_path):
    class_names = {}
    with open(labels_path, "r", encoding="utf-8") as labels_file:
        for line in labels_file:
            stripped = line.strip()
            if not stripped:
                continue
            class_id, name = stripped.split("\t", 1)
            class_names[int(class_id)] = name.strip()
    return class_names


def sha256_for_file(target_path):
    digest = hashlib.sha256()
    with open(target_path, "rb") as file_handle:
        while True:
            chunk = file_handle.read(1024 * 1024)
            if not chunk:
                break
            digest.update(chunk)
    return digest.hexdigest()


def normalize_food_key(name):
    return str(name or "").strip().lower().replace("-", " ").replace(" ", "_")


def display_food_name(name):
    return str(name or "").strip().replace("_", " ")


def resolve_density(food_name):
    normalized = normalize_food_key(food_name)
    if normalized in FOOD_DENSITY:
        return FOOD_DENSITY[normalized]
    spaced = normalized.replace("_", " ")
    if spaced in FOOD_DENSITY:
        return FOOD_DENSITY[spaced]
    return FOOD_DENSITY["default"]


def resolve_usda_query(food_name):
    return display_food_name(food_name)


def extract_usda_nutrients(raw_nutrients):
    calories = None
    protein = None
    carbs = None
    fats = None
    fiber = None

    for nutrient_entry in raw_nutrients or []:
        if not isinstance(nutrient_entry, dict):
            continue
        nutrient_meta = nutrient_entry.get("nutrient") or {}
        nutrient_name = str(
            nutrient_entry.get("nutrientName")
            or nutrient_meta.get("name")
            or ""
        ).strip().lower()
        nutrient_number = str(
            nutrient_entry.get("nutrientNumber")
            or nutrient_meta.get("number")
            or ""
        ).strip()
        unit_name = str(
            nutrient_entry.get("unitName")
            or nutrient_meta.get("unitName")
            or ""
        ).strip().upper()
        amount = safe_float(nutrient_entry.get("value"))
        if amount is None:
            amount = safe_float(nutrient_entry.get("amount"))
        if amount is None:
            continue

        if calories is None and nutrient_name == "energy":
            calories = amount
        elif calories is None and nutrient_number == "1008":
            calories = amount
        elif calories is None and (
            nutrient_number == "1007"
            or (nutrient_name == "energy" and unit_name == "KJ")
        ):
            calories = amount / 4.184
        elif nutrient_number == "1003" or nutrient_name == "protein":
            protein = amount
        elif nutrient_number == "1005" or nutrient_name in {
            "carbohydrate, by difference",
            "carbohydrates",
        }:
            carbs = amount
        elif nutrient_number == "1004" or nutrient_name in {
            "total lipid (fat)",
            "fat",
        }:
            fats = amount
        elif nutrient_number == "1079" or nutrient_name in {
            "fiber, total dietary",
            "dietary fiber",
            "fibre, total dietary",
        }:
            fiber = amount

    return {
        "caloriesPer100g": round_or_none(calories, 4),
        "proteinPer100g": round_or_none(protein, 4),
        "carbsPer100g": round_or_none(carbs, 4),
        "fatsPer100g": round_or_none(fats, 4),
        "fiberPer100g": round_or_none(fiber, 4),
    }


def scale_usda_nutrients(nutrients_per_100g, mass_g):
    mass = safe_float(mass_g) or 0.0
    scale = mass / 100.0

    calories = nutrients_per_100g.get("caloriesPer100g")
    protein = nutrients_per_100g.get("proteinPer100g")
    carbs = nutrients_per_100g.get("carbsPer100g")
    fats = nutrients_per_100g.get("fatsPer100g")
    fiber = nutrients_per_100g.get("fiberPer100g")

    return {
        "calories": round_or_none(calories * scale if calories is not None else None, 2),
        "protein": round_or_none(protein * scale if protein is not None else None, 2),
        "carbs": round_or_none(carbs * scale if carbs is not None else None, 2),
        "fats": round_or_none(fats * scale if fats is not None else None, 2),
        "fiber": round_or_none(fiber * scale if fiber is not None else None, 2),
    }


def lookup_usda_nutrients(food_name, session, cache):
    query = resolve_usda_query(food_name)
    cache_key = query.lower()
    if cache_key in cache:
        return cache[cache_key]

    if not USDA_API_KEY:
        cache[cache_key] = {"query": query, "found": False}
        return cache[cache_key]

    try:
        response = session.get(
            "https://api.nal.usda.gov/fdc/v1/foods/search",
            params={
                "api_key": USDA_API_KEY,
                "query": query,
                "pageSize": 1,
            },
            timeout=USDA_TIMEOUT_SECONDS,
        )
        response.raise_for_status()
        payload = response.json()
        foods = payload.get("foods") or []
        if not foods:
            result = {"query": query, "found": False}
            cache[cache_key] = result
            return result

        first_food = foods[0]
        food_id = first_food.get("fdcId")
        nutrients = extract_usda_nutrients(first_food.get("foodNutrients"))
        description = first_food.get("description")

        if food_id:
            detail_response = session.get(
                f"https://api.nal.usda.gov/fdc/v1/food/{food_id}",
                params={"api_key": USDA_API_KEY},
                timeout=USDA_TIMEOUT_SECONDS,
            )
            detail_response.raise_for_status()
            detail_payload = detail_response.json()
            nutrients = extract_usda_nutrients(detail_payload.get("foodNutrients"))
            description = detail_payload.get("description") or description

        result = {
            "query": query,
            "found": True,
            "description": description,
            **nutrients,
        }
        cache[cache_key] = result
        return result
    except requests.RequestException:
        result = {"query": query, "found": False}
        cache[cache_key] = result
        return result


def detect_plate_scale(image_rgb):
    if cv2 is None:
        return {
            "plateDetected": False,
            "plateDiameterPx": None,
            "mmPerPixel": FALLBACK_MM_PER_PIXEL,
        }

    # Preserve the original plate-scaling conversion so mass and kcal line up with the legacy estimator.
    gray = cv2.cvtColor(image_rgb, cv2.COLOR_BGR2GRAY)
    blur = cv2.GaussianBlur(gray, (9, 9), 2)

    circles = cv2.HoughCircles(
        blur,
        cv2.HOUGH_GRADIENT,
        dp=1.2,
        minDist=200,
        param1=100,
        param2=30,
        minRadius=100,
        maxRadius=1000,
    )

    if circles is None:
        return {
            "plateDetected": False,
            "plateDiameterPx": None,
            "mmPerPixel": FALLBACK_MM_PER_PIXEL,
        }

    x, y, radius = np.uint16(np.around(circles))[0][0]
    diameter_px = int(radius) * 2
    mm_per_pixel = PLATE_DIAMETER_MM / diameter_px if diameter_px else FALLBACK_MM_PER_PIXEL
    return {
        "plateDetected": True,
        "plateDiameterPx": diameter_px,
        "mmPerPixel": mm_per_pixel,
        "plateCenterX": int(x),
        "plateCenterY": int(y),
        "plateRadiusPx": int(radius),
    }


def load_model(model_path):
    model = canetSeg(num_classes=NUM_CLASSES)
    checkpoint = torch.load(model_path, map_location=DEVICE)
    state_dict = checkpoint["model_state"] if "model_state" in checkpoint else checkpoint
    model.load_state_dict(state_dict)
    model.to(DEVICE)
    model.eval()
    return model


def run_segmentation(model, pil_img, image_size):
    image_transform = transforms.Compose(
        [
            transforms.Resize((image_size, image_size)),
            transforms.ToTensor(),
        ]
    )
    image_tensor = image_transform(pil_img).unsqueeze(0).to(DEVICE)
    original_width, original_height = pil_img.size

    with torch.no_grad():
        seg_logits, _ = model(image_tensor)
        seg_logits = F.interpolate(
            seg_logits,
            size=(original_height, original_width),
            mode="bilinear",
            align_corners=False,
        )
        seg_probs = torch.softmax(seg_logits, dim=1)[0].cpu().numpy()

    pred_mask = np.argmax(seg_probs, axis=0)
    return pred_mask, seg_probs


def build_meal_analysis(image_path, model_path, labels_path, image_size, thickness_mm):
    class_names = load_foodseg103_class_names(labels_path)
    model = load_model(model_path)

    pil_img = Image.open(image_path).convert("RGB")
    original_rgb = np.array(pil_img)

    plate = detect_plate_scale(original_rgb)
    mm_per_pixel = safe_float(plate.get("mmPerPixel")) or FALLBACK_MM_PER_PIXEL

    pred_mask, seg_probs = run_segmentation(model, pil_img, image_size)
    total_pixels = int(pred_mask.size)
    threshold = total_pixels * MIN_SEGMENT_RATIO

    unique_ids, counts = np.unique(pred_mask, return_counts=True)
    significant = []
    for class_id, pixel_count in zip(unique_ids, counts):
        if int(class_id) == 0 or int(pixel_count) <= threshold:
            continue
        significant.append((int(class_id), int(pixel_count)))
    significant.sort(key=lambda entry: entry[1], reverse=True)

    items = []
    session = requests.Session()
    nutrient_cache = {}

    for class_id, pixel_count in significant:
        class_mask = pred_mask == class_id
        label = class_names.get(class_id, "default")
        density = resolve_density(label)
        area_ratio = pixel_count / total_pixels if total_pixels else 0.0
        mean_confidence = (
            float(seg_probs[class_id][class_mask].mean()) if np.any(class_mask) else None
        )

        area_mm2 = pixel_count * (mm_per_pixel ** 2)
        volume_mm3 = area_mm2 * thickness_mm
        volume_cm3 = volume_mm3 / 1000.0
        mass_g = volume_cm3 * density

        usda = lookup_usda_nutrients(label, session, nutrient_cache)
        scaled = scale_usda_nutrients(usda, mass_g)
        item_name = display_food_name(label)

        items.append(
            {
                "classId": class_id,
                "name": item_name,
                "lookupQuery": usda.get("query"),
                "confidence": round_or_none(mean_confidence, 4),
                "portionPercent": round_or_none(area_ratio * 100.0, 2),
                "pixelCount": pixel_count,
                "massG": round_or_none(mass_g, 2),
                "weightAmount": round_or_none(mass_g, 2),
                "weightUnit": "g",
                "density": round_or_none(density, 4),
                "calories": scaled.get("calories"),
                "protein": scaled.get("protein"),
                "carbs": scaled.get("carbs"),
                "fats": scaled.get("fats"),
                "fiber": scaled.get("fiber"),
                "caloriesPer100g": usda.get("caloriesPer100g"),
                "proteinPer100g": usda.get("proteinPer100g"),
                "carbsPer100g": usda.get("carbsPer100g"),
                "fatsPer100g": usda.get("fatsPer100g"),
                "fiberPer100g": usda.get("fiberPer100g"),
            }
        )

    dominant = items[0] if items else {}
    total_calories = sum(safe_float(item.get("calories")) or 0.0 for item in items)
    total_protein = sum(safe_float(item.get("protein")) or 0.0 for item in items)
    total_carbs = sum(safe_float(item.get("carbs")) or 0.0 for item in items)
    total_fats = sum(safe_float(item.get("fats")) or 0.0 for item in items)
    total_fiber = sum(safe_float(item.get("fiber")) or 0.0 for item in items)
    total_weight = sum(safe_float(item.get("weightAmount")) or 0.0 for item in items)

    food_count = len(items)
    is_reliable = food_count > 0
    reliability_reason = None if is_reliable else "No food segments passed the minimum area threshold."

    top_matches = [
        {
            "name": item["name"],
            "confidence": item["confidence"],
        }
        for item in items[:5]
    ]

    detected_foods = [
        {
            "name": item["name"],
            "confidence": item["confidence"],
            "portionPercent": item["portionPercent"],
            "calories": item["calories"],
            "protein": item["protein"],
            "carbs": item["carbs"],
            "fats": item["fats"],
            "fiber": item["fiber"],
            "weightAmount": item["weightAmount"],
            "weightUnit": item["weightUnit"],
        }
        for item in items[:8]
    ]

    return {
        "name": dominant.get("name", ""),
        "confidence": dominant.get("confidence"),
        "isReliable": is_reliable,
        "reliabilityThreshold": 0.0 if is_reliable else MIN_SEGMENT_RATIO,
        "reliabilityReason": reliability_reason,
        "calories": round_or_none(total_calories, 0),
        "protein": round_or_none(total_protein, 1),
        "carbs": round_or_none(total_carbs, 1),
        "fats": round_or_none(total_fats, 1),
        "fiber": round_or_none(total_fiber, 1),
        "weightAmount": round_or_none(total_weight, 1),
        "weightUnit": "g",
        "topMatches": top_matches,
        "detectedFoods": detected_foods,
        "mealAnalysis": {
            "foodCount": food_count,
            "totalCalories": round_or_none(total_calories, 2),
            "totalProtein": round_or_none(total_protein, 2),
            "totalCarbs": round_or_none(total_carbs, 2),
            "totalFats": round_or_none(total_fats, 2),
            "totalFiber": round_or_none(total_fiber, 2),
            "totalWeightAmount": round_or_none(total_weight, 2),
            "weightUnit": "g",
            "plateDetected": bool(plate.get("plateDetected")),
            "plateDiameterPx": plate.get("plateDiameterPx"),
            "mmPerPixel": round_or_none(mm_per_pixel, 4),
            "items": items,
        },
    }


def build_setup_payload(model_path, labels_path):
    checkpoint = torch.load(model_path, map_location="cpu")
    state_dict = checkpoint["model_state"] if "model_state" in checkpoint else checkpoint
    class_names = load_foodseg103_class_names(labels_path)
    foreground_count = len([class_id for class_id in class_names if class_id != 0])

    cls_head_classes = None
    seg_head_classes = None
    cls_head_weight = state_dict.get("cls_head_conv.weight")
    seg_head_weight = state_dict.get("seg_head_conv.weight")
    if hasattr(cls_head_weight, "shape") and len(cls_head_weight.shape) >= 1:
        cls_head_classes = int(cls_head_weight.shape[0])
    if hasattr(seg_head_weight, "shape") and len(seg_head_weight.shape) >= 1:
        seg_head_classes = int(seg_head_weight.shape[0])

    checkpoint_epoch = checkpoint.get("epoch") if isinstance(checkpoint, dict) else None
    checkpoint_epoch = int(checkpoint_epoch) if safe_float(checkpoint_epoch) is not None else None

    return {
        "ready": True,
        "checkedAt": utc_now_iso(),
        "pythonVersion": sys.version.split()[0],
        "torchVersion": torch.__version__,
        "torchvisionVersion": torchvision.__version__,
        "pillowVersion": PILLOW_VERSION,
        "labelsCount": foreground_count,
        "checkpointEpoch": checkpoint_epoch,
        "clsHeadClasses": cls_head_classes,
        "segHeadClasses": seg_head_classes,
        "modelPath": os.path.abspath(model_path),
        "modelFileName": os.path.basename(model_path),
        "modelSizeBytes": os.path.getsize(model_path),
        "modelSha256": sha256_for_file(model_path),
        "labelsPath": os.path.abspath(labels_path),
        "labelsFileName": os.path.basename(labels_path),
        "labelsSizeBytes": os.path.getsize(labels_path),
        "labelsSha256": sha256_for_file(labels_path),
    }


def print_text_report(result):
    meal_analysis = result.get("mealAnalysis") or {}
    items = meal_analysis.get("items") or []
    plate_diameter = meal_analysis.get("plateDiameterPx")
    mm_per_pixel = meal_analysis.get("mmPerPixel")

    if plate_diameter:
        print(f"\nDetected Plate Diameter: {plate_diameter}px")
    else:
        print("\nDetected Plate Diameter: not detected")
    print(f"mm per pixel: {round_or_zero(mm_per_pixel, 4):.4f}")

    print("\nNutritional Estimates:\n")
    if not items:
        print("No significant foods detected.")
    for item in items:
        name = item.get("name", "unknown")
        percent = round_or_zero(item.get("portionPercent"), 2)
        mass_g = round_or_zero(item.get("weightAmount"), 2)
        calories = round_or_zero(item.get("calories"), 2)
        protein = round_or_zero(item.get("protein"), 2)
        carbs = round_or_zero(item.get("carbs"), 2)
        fiber = round_or_zero(item.get("fiber"), 2)
        print(
            f"{name:<20} ({percent:.2f}%) -> {mass_g:.2f} g  ≈ {calories:.2f} kcal"
            f" | P {protein:.2f} g | C {carbs:.2f} g | Fiber {fiber:.2f} g"
        )

    print("\nTotal Meal Calories:")
    print(f"{round_or_zero(meal_analysis.get('totalCalories'), 2):.2f} kcal")
    print(
        "Protein: "
        f"{round_or_zero(meal_analysis.get('totalProtein'), 2):.2f} g | "
        "Carbs: "
        f"{round_or_zero(meal_analysis.get('totalCarbs'), 2):.2f} g | "
        "Fiber: "
        f"{round_or_zero(meal_analysis.get('totalFiber'), 2):.2f} g"
    )


def parse_args():
    parser = argparse.ArgumentParser(description="NUT meal estimator")
    parser.add_argument("--image", default=DEFAULT_IMAGE_PATH)
    parser.add_argument("--image-size", type=int, default=DEFAULT_IMAGE_SIZE)
    parser.add_argument("--model", default=DEFAULT_MODEL_PATH)
    parser.add_argument("--labels", default=DEFAULT_LABELS_PATH)
    parser.add_argument("--thickness-mm", type=float, default=DEFAULT_THICKNESS_MM)
    parser.add_argument("--json", action="store_true", help="Print JSON instead of the default text report.")
    parser.add_argument("--self-check", action="store_true", help="Validate runtime/model setup and print JSON.")
    return parser.parse_args()


def main():
    args = parse_args()
    image_path = os.path.abspath(args.image)
    model_path = os.path.abspath(args.model)
    labels_path = os.path.abspath(args.labels)
    image_size = int(args.image_size) if args.image_size and args.image_size > 0 else DEFAULT_IMAGE_SIZE
    thickness_mm = (
        float(args.thickness_mm)
        if args.thickness_mm and float(args.thickness_mm) > 0
        else DEFAULT_THICKNESS_MM
    )

    if not os.path.exists(model_path):
        raise FileNotFoundError(f"Model weights not found at {model_path}")
    if not os.path.exists(labels_path):
        raise FileNotFoundError(f"Label map not found at {labels_path}")

    if args.self_check:
        print(json.dumps(build_setup_payload(model_path, labels_path)))
        return

    if not os.path.exists(image_path):
        raise FileNotFoundError(f"Image not found at {image_path}")

    result = build_meal_analysis(
        image_path=image_path,
        model_path=model_path,
        labels_path=labels_path,
        image_size=image_size,
        thickness_mm=thickness_mm,
    )

    if args.json:
        print(json.dumps(result))
        return

    print_text_report(result)


if __name__ == "__main__":
    main()

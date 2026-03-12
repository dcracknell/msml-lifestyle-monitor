# datasets/datasets.py
#
# Dataset definitions used:
#   - Food101Dataset: image-level classification (Food-101).
#   - FoodSeg103Dataset: semantic segmentation (FoodSeg103, PNG masks).
#   - FoodSeg103SingleLabelDataset: classification view of FoodSeg103
#       (one "dominant" class per image, derived from the mask).

# ======================================================================
# Libraries
# ======================================================================
import os
import numpy as np
import torch
from PIL import Image
from torch.utils.data import Dataset
from torchvision import transforms

# ======================================================================
# Food101Dataset
# ======================================================================
class Food101Dataset(Dataset):
    """
    Minimal Food-101 dataset loader.

    structure under 'root':
        root/
          images/
            class_name/
              xxx.jpg
              yyy.jpg
          meta/
            train.txt
            test.txt

    Each line in train.txt / test.txt is formatted:
        class_name/image_xxx
        
     i.e. the *relative* path from images/ to the .jpg.
     
    This dataset returns:
        x : image tensor (3 x 224 x 224).
        y : integer class index.    
    """

    def __init__(self, root, split="train"):
        """
        Args:
            root  : path to Food-101 root directory.
            split : "train" or "test", which selects meta/train.txt or meta/test.txt.
        """
        
        super().__init__()
        self.root = root
        self.split = split  # Setting the split we are loading.

        img_root = os.path.join(root, "images") # Folder containing the images.
        list_file = os.path.join(root, "meta", f"{split}.txt") # File containing split.

        self.samples = []  # List of (image_path and class_name).
        
        # Read each line from train.txt / test.txt.
        with open(list_file, "r") as f:
            for line in f:
                rel = line.strip() + ".jpg"  # e.g. 'apple_pie/1001.jpg'.
                cls_name = rel.split("/")[0] # Relevent folder name.
                img_path = os.path.join(img_root, rel) # Absolute path.
                self.samples.append((img_path, cls_name)) # Adds to list.

        # Build a sorted list of all class names that appear.
        self.classes = sorted({cls for _, cls in self.samples})
        
        # Map from class name to integer index [0 .. num_classes-1].
        self.class_to_idx = {c: i for i, c in enumerate(self.classes)}

        # Define transforms.
        # For training add some augmentation (random crop, flip).
        if split == "train":
            self.transform = transforms.Compose([
                transforms.Resize(256),
                transforms.RandomResizedCrop(224),
                transforms.RandomHorizontalFlip(),
                transforms.ToTensor(),
            ])
        else:
            self.transform = transforms.Compose([
            transforms.Resize(256),
            transforms.CenterCrop(224),
                transforms.ToTensor(),
            ])

    def __len__(self):
        """Returns the number of images in the set split."""
        return len(self.samples)

    def __getitem__(self, idx):
        """
        Returns:
            x : image tensor (3 x 224 x 224).
            y : integer class index.
        """
        img_path, cls_name = self.samples[idx]
        img = Image.open(img_path).convert("RGB")# Load image and convert to RGB.
        x = self.transform(img) # Apply transforms defined in __init__.
        y = self.class_to_idx[cls_name] # Map class name (string) to integer label.
        return x, y

# ======================================================================
# FoodSeg103Dataset
# ======================================================================
class FoodSeg103Dataset(Dataset):
    """
    FoodSeg103 loader for PNG masks.

    Structure under 'root':
        root/
          Images/
            img_dir/
              train/
              test/
            ann_dir/
              train/
              test/

    This dataset returns:
        img  : 3 x H x W float tensor in [0,1]
        mask : H x W int64 tensor of class indices
    """

    def __init__(self, root, split="train", transform=None):
        """
        Args:
            root      : path to FoodSeg103 dataset root.
            split     : "train" or "test".
            transform : optional image transform pipeline. If none,
                       we use a default (Resize 256, CenterCrop 224, ToTensor).
        """
        super().__init__()
        self.root = root
        self.split = split

        # Folder containing RGB images for teh split.
        img_dir = os.path.join(root, "Images", "img_dir", split)
        
        # Folder containing segmentation masks (PNG) for the split.
        mask_dir = os.path.join(root, "Images", "ann_dir", split)

        # List all image files.
        names = [
            f for f in os.listdir(img_dir)
            if f.lower().endswith((".jpg", ".jpeg", ".png"))
        ]

        self.samples = [] # list of images
        
        # For each element in names.
        for name in names:
            img_path = os.path.join(img_dir, name)
            
            # Mask filename uses same basename but with ".png" extension
            base, _ = os.path.splitext(name)
            mask_name = base + ".png"
            mask_path = os.path.join(mask_dir, mask_name)

            if os.path.exists(mask_path):
                self.samples.append((img_path, mask_path))
            else:
                # If annotation missing, just warn (and skip this sample)
                print(f"[warn] missing mask for {name}")

        # Default image transform if none provided
        if transform is None:
            self.img_transform = transforms.Compose([
                transforms.Resize((448, 448)),
                transforms.ToTensor(),
            ])
        else:
            self.img_transform = transform

    def __len__(self):
        """Number of (image, mask) PAIRS in this split."""
        return len(self.samples)

    def __getitem__(self, idx):
        """
        Returns:
            img  : 3 x H x W float tensor (after transform)
            mask : H x W int64 tensor of class indices
        """
        img_path, mask_path = self.samples[idx]

        # Loads and transforms image.
        img = Image.open(img_path).convert("RGB")
        img = self.img_transform(img) # -> [3, H, W]

        # Loads respecive mask 
        mask = Image.open(mask_path) # single-channel PNG with class IDs

        # resize mask to match image size (H, W)
        H, W = img.shape[1], img.shape[2]
        mask = mask.resize((W, H), resample=Image.NEAREST)

        # Convert HxW array of uint8/uint16 -> torch int64 tensor
        mask = torch.from_numpy(np.array(mask, dtype="int64"))

        return img, mask
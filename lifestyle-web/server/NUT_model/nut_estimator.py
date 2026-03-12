# nut_estimator.py
#
# Nutritional Unit Tracker (NUT)
#
# This script performs automatic nutritional estimation from a food image
# using semantic segmentation and volumetric approximation.
#
# Pipeline:
#
#   1. Load a trained FoodSeg103 semantic segmentation model
#   2. Detect the plate in the image to estimate spatial scale
#   3. Segment the food image into semantic food classes
#   4. Remove very small predicted segments (<2.5% of image)
#   5. Estimate food volume using:
#
#           volume = area x thickness
#
#   6. Convert volume to mass using bulk density estimates
#
#           mass = volume x density
#
#   7. Query USDA FoodData Central API to retrieve calories
#   8. Display the nutritional estimates and segmentation visualisation
#   (for testing purposes)
#
# ======================================================================
# Libraries
# ======================================================================
# os
# Used for file system operations such as constructing dataset paths,
# locating model checkpoints, and loading configuration files.
import os

# sys
# Allows modification of the Python module search path so project
# modules (e.g. canet.models and canet.datasets) can be imported.
import sys

# torch
# PyTorch deep learning framework used to load the trained segmentation
# model and perform neural network inference.
import torch

# torch.nn.functional (F)
# Provides neural network utility functions, used here to resize the
# segmentation output to match the original image resolution.
import torch.nn.functional as F

# numpy (np)
# Used for numerical array operations including mask analysis, pixel
# counting, and colour generation for segmentation visualisation.
import numpy as np

# matplotlib.pyplot (plt)
# Used to visualise the results, including the original image,
# segmentation mask, plate detection, and overlay outputs.
import matplotlib.pyplot as plt

# PIL.Image
# Used to load and handle input images before converting them to tensors
# for processing by the segmentation model.
from PIL import Image

# cv2 (OpenCV)
# Used for computer vision operations, specifically detecting the plate
# using the Hough Circle Transform to estimate real-world scale.
import cv2

# requests
# Used to query the USDA FoodData Central API to retrieve nutritional
# information (calories per 100g) for detected food classes.
import requests

# ======================================================================
# Project Path Configuration
# ======================================================================
# Absolute directory of this script
FILE_DIR = os.path.dirname(os.path.abspath(__file__))

# Project root directory (one level above this file)
PROJECT_ROOT = os.path.dirname(FILE_DIR)

# Add project root to Python import path if not already present
# This allows importing project modules such as canet.models
if PROJECT_ROOT not in sys.path:
    sys.path.insert(0, PROJECT_ROOT)

# ======================================================================
# Import Model and Dataset
# ======================================================================
# canetSeg = Semantic segmentation network used for FoodSeg103
from NUT_model.models.canet import canetSeg

# Dataset loader for FoodSeg103 (for testing purposes)
from NUT_model.datasets.datasets import FoodSeg103Dataset

# ======================================================================
# Device Configuration
# ======================================================================
# Use GPU if available, otherwise fallback to CPU
device = "cuda" if torch.cuda.is_available() else "cpu"

# Base directory for dataset and checkpoints
BASE_DIR = FILE_DIR

# Total number of segmentation classes (FoodSeg103 + background)
NUM_CLASSES = 104

# Assumed real-world diameter of the plate used for scale estimation (mm)
PLATE_DIAMETER_MM = 270

# ======================================================================
# USDA API Configuration
# ======================================================================
# API key for accessing USDA FoodData Central database
USDA_API_KEY = "zOQeCfbzL5dav3dFHsbbUf1XjQEs4gZoxkiZubfF"

# ======================================================================
# Input Image Path
# ======================================================================
# Absolute path to the input test image
IMAGE_PATH = os.path.abspath(os.path.join(
    BASE_DIR,
    "..",
    "data",
    "FoodSeg103",
    "custom-images",
    "sausage.jpg"
))

# ======================================================================
# Load FoodSeg103 Class Names
# ======================================================================
def load_foodseg103_class_names(root):
    """
    Loads the FoodSeg103 class name mapping file which associates
    segmentation class IDs with human-readable food names.
    """
    
    # Construct path to the FoodSeg103 class mapping file
    cat_file = os.path.join(root, "category_id.txt")
    
    # Create empty dictionary to store class_id to class_name mapping
    class_names = {}
    
    # Open mapping file for reading
    with open(cat_file, "r") as f:
        
        # Iterate through each line in the file
        for line in f:
            
            # Split line into class ID and class name
            cid, name = line.strip().split("\t")
            
            # Store mapping in dictionary with integer class ID
            class_names[int(cid)] = name
    
    # Return dictionary of class names        
    return class_names

# ======================================================================
# Plate Detection for Scale Estimation
# ======================================================================
def detect_plate_scale(image):
    """
    Detects the plate using Hough Circle Transform to estimate
    pixel-to-millimetre conversion for real-world measurements.
    """

    # Convert RGB image to grayscale for edge detection
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    
    # Apply Gaussian blur to reduce noise before circle detection
    blur = cv2.GaussianBlur(gray,(9,9),2)

    # Detect circular shapes using Hough Circle Transform parameters   
    circles = cv2.HoughCircles(
        blur,
        cv2.HOUGH_GRADIENT,
        dp=1.2,  # Inverse resolution ratio
        minDist=200,  # Minimum distance between circles
        param1=100,  # Edge detection threshold
        param2=30,  # Circle detection sensitivity
        minRadius=100,  # Minimum expected plate radius
        maxRadius=1000# Maximum expected plate radius
    )

    # If no plate detected, return fallback scale
    if circles is None:
        print("Plate not detected — using fallback")
        return 0.5, image

    # Round detected circle parameters to integers
    circles = np.uint16(np.around(circles))
    # Extract x-coordinate, y-coordinate and radius
    x,y,r = circles[0][0]

    # Calculate detected plate diameter in pixels
    plate_pixel_diameter = 2*r
    # Convert pixel measurement to millimetres
    mm_per_pixel = PLATE_DIAMETER_MM / plate_pixel_diameter

    # Copy image to draw visualisation overlay
    overlay = image.copy()
    # Draw detected plate circle on overlay image
    cv2.circle(overlay,(x,y),r,(0,255,0),3)

    # Print detected plate diameter and conversion scale
    print(f"\nDetected Plate Diameter: {plate_pixel_diameter}px")
    print(f"mm per pixel: {mm_per_pixel:.4f}")

    # Return scale factor and visualisation image
    return mm_per_pixel, overlay

# ======================================================================
# USDA Calorie Retrieval
# ======================================================================
def get_usda_calories(food_name, mass_g):
    """
    Queries USDA FoodData Central API to retrieve calorie information
    and scales it according to estimated food mass.
    """

    try:
        
        # Construct API request to search for food item
        search_url = (
            "https://api.nal.usda.gov/fdc/v1/foods/search"
            f"?api_key={USDA_API_KEY}"
            f"&query={food_name}"
            "&pageSize=1"
        )

        # Send HTTP request and parse JSON response
        r = requests.get(search_url).json()

        # If no results found, return zero calories
        if len(r['foods']) == 0:
            return 0

        # Extract FoodData Central unique ID
        fdcId = r['foods'][0]['fdcId']

        # Construct second API request for nutrient details
        nutrient_url = (
            f"https://api.nal.usda.gov/fdc/v1/food/{fdcId}"
            f"?api_key={USDA_API_KEY}"
        )

        # Retrieve nutrient information
        r2 = requests.get(nutrient_url).json()

        # Initialise calorie value
        kcal_per_100g = 0

        # Initialise calorie value
        for n in r2['foodNutrients']:
            
            # Check for energy nutrient
            if n['nutrient']['name'] == "Energy":
                kcal_per_100g = n['amount']
                break

        # Scale calories according to estimated mass
        kcal = kcal_per_100g * (mass_g/100)
        
        # Return calorie estimate
        return kcal

    # If any error occurs return zero calories
    except:
        return 0

# ======================================================================
# Main Pipeline
# ======================================================================
def main():

    # Construct path to FoodSeg103 dataset
    root = os.path.join(BASE_DIR, "..", "data", "FoodSeg103")
    # Initialise dataset loader (used for preprocessing transforms)
    ds = FoodSeg103Dataset(root=root, split="test")
    # Load mapping from class ID to food name
    class_names = load_foodseg103_class_names(root)

    # Create segmentation model instance
    model = canetSeg(num_classes=NUM_CLASSES)

    # Construct path to trained model checkpoint
    ckpt_path = os.path.join(
        BASE_DIR,
        "checkpoint",
        "canet_NUT.pth",
    )

    # Load trained model parameters
    ckpt = torch.load(ckpt_path, map_location=device)
    # Extract model state dictionary
    state_dict = ckpt["model_state"] if "model_state" in ckpt else ckpt
    # Load weights into model
    model.load_state_dict(state_dict)
    # Move model to CPU or GPU device
    model.to(device)
    # Set model to inference mode
    model.eval()

    # ==================================================================
    # Load Input Image
    # ==================================================================
    # Open input image and convert to RGB
    pil_img = Image.open(IMAGE_PATH).convert("RGB")
    # Convert PIL image to NumPy array
    orig_np = np.array(pil_img)

    # Detect plate and estimate pixel-to-mm scale
    mm_per_pixel, plate_overlay = detect_plate_scale(orig_np)

    # Apply dataset image preprocessing transform 
    img = ds.img_transform(pil_img).unsqueeze(0).to(device)

    # ==================================================================
    # Run Segmentation Inference
    # ==================================================================
    
    # Disable gradient calculation for inference
    with torch.no_grad():
        
        # Forward pass through segmentation model    
        seg_logits,_ = model(img)
        
        # Resize segmentation output to original image resolution
        seg_logits = F.interpolate(
            seg_logits,
            size=(orig_np.shape[0],orig_np.shape[1]),
            mode="bilinear",
            align_corners=False,
        )
        
        # Convert logits to predicted class mask
        pred_mask = torch.argmax(seg_logits,dim=1)[0].cpu().numpy()

    # ==================================================================
    # Remove Small Segments (<2.5%) i.e, calorific relevent segments
    # ==================================================================
    
    # Find unique classes and pixel counts
    unique,counts = np.unique(pred_mask,return_counts=True)

    # Total number of pixels in image
    total_pixels = pred_mask.size
    # Define minimum area threshold (2.5%)
    threshold = 0.025 * total_pixels

    # Keep only classes larger than threshold
    significant = [
        (cid,cnt) for cid,cnt in zip(unique,counts)
        if cid!=0 and cnt > threshold
    ]

    # Extract class IDs for significant segments
    significant_ids = [cid for cid,_ in significant]

    # Create empty filtered mask
    filtered_mask = np.zeros_like(pred_mask)

    # Retain only significant classes
    for cid in significant_ids:
        filtered_mask[pred_mask==cid] = cid

    # Replace original mask with filtered mask
    pred_mask = filtered_mask

    print("\nNutritional Estimates:\n")

    # ==================================================================
    # Food Density Dictionary (g/cm³)
    # ==================================================================
    # Approximate bulk density values for FoodSeg1o3 foods
    food_density = {

    # Vegetables
    "broccoli":0.37,
    "cabbage":0.45,
    "carrot":0.80,
    "cauliflower":0.50,
    "celery":0.40,
    "cucumber":0.96,
    "eggplant":0.72,
    "garlic":0.60,
    "ginger":0.80,
    "lettuce":0.15,
    "mushroom":0.40,
    "onion":0.90,
    "pepper":0.60,
    "potato":0.77,
    "pumpkin":0.60,
    "radish":0.75,
    "spinach":0.20,
    "tomato":0.94,
    "zucchini":0.94,

    # Fruits
    "apple":0.61,
    "banana":0.94,
    "blueberry":0.72,
    "cherry":0.80,
    "grape":0.72,
    "kiwi":0.95,
    "lemon":0.96,
    "mango":0.85,
    "orange":0.96,
    "pear":0.59,
    "pineapple":0.50,
    "strawberry":0.60,
    "watermelon":0.96,

    # Grains / carbs
    "rice":0.85,
    "fried_rice":0.88,
    "noodles":0.80,
    "spaghetti":0.85,
    "pasta":0.85,
    "bread":0.27,
    "toast":0.30,
    "bagel":0.40,
    "hamburger_bun":0.35,
    "pizza":0.55,
    "dumpling":0.90,

    # Meat
    "beef":1.02,
    "steak":1.02,
    "pork":1.01,
    "bacon":0.95,
    "ham":1.02,
    "sausage":0.96,
    "chicken":0.80,
    "fried_chicken":0.75,
    "turkey":1.02,
    "lamb":1.03,

    # Seafood
    "fish":1.00,
    "salmon":1.05,
    "shrimp":1.03,
    "crab":1.02,
    "lobster":1.03,
    "oyster":1.05,

    # Eggs / dairy
    "egg":1.03,
    "fried_egg":1.02,
    "boiled_egg":1.03,
    "cheese":1.10,
    "butter":0.96,
    "yogurt":1.03,
    "milk":1.03,

    # Snacks
    "chips":0.35,
    "french_fries":0.45,
    "popcorn":0.12,
    "cracker":0.30,
    "cookie":0.40,
    "cake":0.45,
    "donut":0.31,

    # Mixed meals
    "soup":1.01,
    "salad":0.20,
    "burger":0.55,
    "sandwich":0.50,
    "hot_dog":0.65,
    "taco":0.60,
    "burrito":0.70,
    "fried_food":0.80,

    # sauces
    "ketchup":1.09,
    "mayonnaise":0.91,
    "mustard":1.01,
    "soy_sauce":1.18,

    # fallback
    "default":0.80
    }

    # Initialise total calorie counter
    total_kcal = 0

    # ==================================================================
    # Nutritional Estimation Loop
    # ==================================================================

    for cid,_ in significant:
        
        # Create binary mask for this class
        class_mask = (pred_mask==cid)
        # Count number of pixels belonging to this food
        pixel_count = class_mask.sum()

        # Convert pixel area to mm^2
        area_mm2 = pixel_count*(mm_per_pixel**2)
        # Assume constant food thickness, may be able to optimised with
        # 3D imaging later via use of 1p coin as in paper
        thickness_mm = 20

        # Estimate food volume in mm^3
        volume_mm3 = area_mm2*thickness_mm
        # Convert volume to cm^3
        volume_cm3 = volume_mm3/1000

        # Retrieve food name from class mapping
        name = class_names.get(int(cid),"default")
        
        # Retrieve density value
        density = food_density.get(name, food_density["default"])

        # Estimate mass in grams
        mass_g = volume_cm3*density

        # Estimate calorie value using USDA API
        kcal = get_usda_calories(name, mass_g)
        # Accumulate total calories
        total_kcal += kcal

        # Calculate percentage of image occupied
        pct = 100 * pixel_count / total_pixels

        # Print nutritional estimate for this food segment
        print(f"{name:20s} ({pct:.2f}%) → {mass_g:.2f} g  ≈ {kcal:.2f} kcal")

    # Print total calorie estimate
    print("\nTotal Meal Calories:")
    print(f"{total_kcal:.2f} kcal")

    # ==================================================================
    # Visualisation
    # ==================================================================

    # Initialise deterministic random colour generator
    rng = np.random.RandomState(0)
    # Generate random colours for each class
    colors = rng.randint(0,255,size=(NUM_CLASSES,3),dtype=np.uint8)
    # Convert segmentation mask to RGB image
    pred_rgb = colors[pred_mask]

    # Overlay segmentation on original image
    overlay = (0.6 * orig_np + 0.4 * pred_rgb).astype(np.uint8)

    # Create visualisation figure
    fig = plt.figure(figsize=(14,6))

    # Display original image
    ax1 = fig.add_subplot(2,2,1)
    ax1.set_title("Original Image")
    ax1.imshow(orig_np)
    ax1.axis("off")

    # Display segmentation mask
    ax2 = fig.add_subplot(2,2,2)
    ax2.set_title(">2.5% Segmentation")
    ax2.imshow(pred_rgb)
    ax2.axis("off")

    # Display plate detection result
    ax3 = fig.add_subplot(2,2,3)
    ax3.set_title("Plate Detection")
    ax3.imshow(plate_overlay)
    ax3.axis("off")

    # Display segmentation overlay
    ax4 = fig.add_subplot(2,2,4)
    ax4.set_title("Segmentation Overlay")
    ax4.imshow(overlay)
    ax4.axis("off")

    # Adjust subplot layout
    plt.tight_layout()
    # Display visualisation window
    plt.show()

# ======================================================================
# Script Entry Point
# ======================================================================

# Run main function if script is executed directly
if __name__=="__main__":
    main()

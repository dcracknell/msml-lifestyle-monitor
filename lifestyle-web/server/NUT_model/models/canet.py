# models/canet.py
#
# canet Semantic Segmentation Model
#
# This file defines the canet segmentation architecture used for
# FoodSeg103 semantic segmentation.
#
# The architecture follows the SSDB-II design principle with two
# independent backbones:
#
#   - Classification branch
#   - Segmentation branch
#
# The segmentation branch produces dense pixel-wise predictions,
# while the classification branch produces segment image-level class
# predictions (currently unused during training).
#
# ======================================================================
# Libraries
# ======================================================================
# Import PyTorch tensor and neural network functionality
import torch
# Import neural network layer module
import torch.nn as nn
# Import functional utilities (interpolation, pooling, etc.)
import torch.nn.functional as F

# Import ResNet-38 backbone used as feature extractor
from .resnet38_backbone import ResNetBackbone

# ======================================================================
# canet Segmentation Model
# ======================================================================
class canetSeg(nn.Module):
    """
    canet segmentation architecture.

    Two independent ResNet backbones are used:
        1) Segmentation branch
        2) Classification branch

    The segmentation branch generates pixel-wise predictions.
    The classification branch generates global class predictions.
    """

    def __init__(self, num_classes: int):
        """
        Initialise the model.

        Args:
            num_classes : number of segmentation classes including
                          background (FoodSeg103 uses 104).
        """
        
        # Initialise parent PyTorch module
        super().__init__()
        # Store number of segmentation classes
        self.num_classes = num_classes

        # --------------------------------------------------------------
        # Backbone Networks
        # --------------------------------------------------------------
        # Backbone used for classification branch
        self.backbone_cls = ResNetBackbone()
        # Backbone used for segmentation branch
        self.backbone_seg = ResNetBackbone()
 
        # --------------------------------------------------------------
        # Classification Head
        # --------------------------------------------------------------  
        # 1x1 convolution converting backbone features to class 
        # activation maps
        self.cls_head_conv = nn.Conv2d(
            512 * 4,  # Number of channels from backbone
            num_classes - 1,  # Foreground classes only (no background)
            kernel_size = 1, # 1x1 convolution
            bias = True,
        )

        # --------------------------------------------------------------
        # Segmentation Head
        # --------------------------------------------------------------
        # 1x1 convolution producing segmentation logits
        self.seg_head_conv = nn.Conv2d(
            512 * 4,  # Backbone feature channels
            num_classes,  # One channel per segmentation class
            kernel_size=1,
            bias=True,
        )

    # ==================================================================
    # Backbone Forward Functions
    # ==================================================================
    def forward_backbone_seg(self, x):
        """
        Forward pass through segmentation backbone.

        Returns intermediate feature maps used by the segmentation head.
        """

        # Extract intermediate feature maps
        feat3, feat4 = self.backbone_seg(x)
        return feat3, feat4

    def forward_backbone_cls(self, x):
        """
        Forward pass through classification backbone.

        Returns intermediate feature maps used for classification head.
        """
        
        # Extract intermediate feature maps
        feat3, feat4 = self.backbone_cls(x)
        return feat3, feat4

    # ==================================================================
    # Forward Pass
    # ==================================================================
    def forward(self, x):
        """
        Forward pass of the canet model.

        Args:
            x : input image tensor with shape [B,3,H,W]

        Returns:
            seg_logits : segmentation prediction tensor
                         shape [B, num_classes, H, W]

            cls_logits : classification prediction tensor
                         shape [B, num_classes-1]
        """
        # Extract tensor dimensions
        B, C, H, W = x.shape

        # -------------------------------------------------------------
        # Segmentation Branch
        # -------------------------------------------------------------
        # Extract features from segmentation backbone
        _, feat4_seg = self.forward_backbone_seg(x)
        # Apply segmentation head convolution
        seg_logits_low = self.seg_head_conv(feat4_seg)  # [B,C,H/8,W/8]
        # Upsample segmentation output to match input image size
        seg_logits = F.interpolate(
            seg_logits_low, 
            size=(H, W), 
            mode="bilinear", 
            align_corners=False
        )

        # -------------------------------------------------------------
        # Classification Branch (not yet trained...)
        # -------------------------------------------------------------
        # Extract features from classification backbone
        _, feat4_cls = self.forward_backbone_cls(x)
        # Generate class activation maps
        cls_cam = self.cls_head_conv(feat4_cls)  # [B, C_fg, H/8, W/8]
        # Perform global average pooling to obtain class scores
        cls_logits = F.adaptive_avg_pool2d(
            cls_cam, 
            output_size=1
        ).view(B, -1)

        # Return segmentation and classification predictions
        return seg_logits, cls_logits

    # ==================================================================
    # Inference Helper
    # ==================================================================
    def predict_masks(self, x, bg_value: float = 0.15):
        """
        Generates final segmentation masks during inference.

        Combines segmentation predictions with classification scores
        to suppress unlikely classes and improve segmentation quality.
        """
        
        # Set model to evaluation mode
        self.eval()
        # Disable gradient calculations for inference
        with torch.no_grad():
            
            # Forward pass
            seg_logits, cls_logits = self.forward(x)
            # Extract tensor dimensions
            B, C, H, W = seg_logits.shape

            # Convert segmentation logits to probabilities
            seg_scores = torch.softmax(seg_logits[:, 1:], dim=1)  # [B, C_fg, H, W]

            # Convert classification logits to probabilities
            cls_probs = torch.sigmoid(cls_logits)  # [B, C_fg]
            # Reshape classification probabilities for broadcasting
            cls_probs = cls_probs.view(B, -1, 1, 1)

            # Combine segmentation and classification predictions
            cam = seg_scores * cls_probs  # [B, C_fg, H, W]

            # Create constant background channel
            bg_plane = torch.full(
                (B, 1, H, W), 
                float(bg_value), 
                device=x.device, 
                dtype=cam.dtype
            )

            # Concatenate background and foreground probabilities
            P = torch.cat([bg_plane, cam], dim=1)  # [B, 1 + C_fg, H, W]
            # Select most probable class per pixel
            pred_mask = P.argmax(dim=1)  # [B, H, W]

        # Return predicted segmentation mask
        return pred_mask

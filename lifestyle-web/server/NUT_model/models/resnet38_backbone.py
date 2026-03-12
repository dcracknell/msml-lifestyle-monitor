# models/resnet38_backbone.py
#
# ResNet-38 Backbone Network
#
# This file defines the feature extraction backbone used by the canet
# segmentation architecture.
#
# The backbone consists of:
#
#   - Bottleneck blocks (ResNet style residual blocks)
#   - A ResNet-38 style architecture with dilated convolutions
#
# The network returns intermediate feature maps rather than final
# classification logits, allowing it to be reused by both:
#
#   • Segmentation branch
#   • Classification branch
#
# The final output stride is 8, which preserves spatial resolution
# for semantic segmentation tasks.
#
# ======================================================================
# Libraries
# ======================================================================
# Import PyTorch tensor library
import torch
# Import neural network layers
import torch.nn as nn
# Import neural network functional operations
import torch.nn.functional as F

# ======================================================================
# Bottleneck Residual Block
# ======================================================================
class Bottleneck(nn.Module):
    """Standard ResNet bottleneck with optional dilation."""
    
    # Expansion factor used in ResNet bottleneck blocks
    expansion = 4
    
    def __init__(self, 
                 inplanes, 
                 planes, 
                 stride = 1, 
                 dilation = 1, 
                 downsample=None
                 ):
        
        # Initialise parent PyTorch module
        super().__init__()
        # Padding size determined by dilation value
        padding = dilation

        # 1x1 convolution used to reduce feature channel dimensions
        self.conv1 = nn.Conv2d(inplanes, 
                               planes, 
                               kernel_size = 1, 
                               bias=False
                               )
        # Batch normalisation layer for conv1
        self.bn1 = nn.BatchNorm2d(planes)

        # 3x3 convolution used for spatial feature extraction
        self.conv2 = nn.Conv2d(
            planes,  # Input channels
            planes,  # Output channels
            kernel_size = 3,  # 3x3 convolution
            stride=stride,  # Stride for spatial downsampling
            padding=padding,  # Padding value
            dilation=dilation,  # Dilation for larger receptive field
            bias=False,
        )
        # Batch normalisation layer for conv2
        self.bn2 = nn.BatchNorm2d(planes)

        # 1x1 convolution expanding feature channels
        self.conv3 = nn.Conv2d(
            planes, 
            planes * self.expansion, 
            kernel_size = 1, 
            bias=False
        )
        # Batch normalisation layer for conv3
        self.bn3 = nn.BatchNorm2d(planes * self.expansion)

        # ReLU activation function
        self.relu = nn.ReLU(inplace=True)
        # Optional downsampling layer used when input/output sizes differ
        self.downsample = downsample

    # ==================================================================
    # Forward Pass
    # ==================================================================
    def forward(self, x):
        # Store original input for residual connection
        identity = x

        # Apply first convolution
        out = self.conv1(x)
        # Apply batch normalisation
        out = self.bn1(out)
        # Apply ReLU activation
        out = self.relu(out)

        # Apply second convolution
        out = self.conv2(out)
        # Apply batch normalisation
        out = self.bn2(out)
        # Apply ReLU activation
        out = self.relu(out)

        # Apply third convolution
        out = self.conv3(out)
        # Apply batch normalisation
        out = self.bn3(out)

        # If downsample layer exists adjust identity tensor
        if self.downsample is not None:
            identity = self.downsample(x)

        # Add residual connection
        out += identity
        # Apply final activation
        out = self.relu(out)

        # Return output tensor
        return out

# ======================================================================
# ResNet Backbone Network
# ======================================================================
class ResNetBackbone(nn.Module):
    """
    ResNet-38 style backbone used for feature extraction.
    """

    def __init__(self, block=Bottleneck, layers=(3, 3, 3, 3)):
        
        # Initialise parent PyTorch module
        super().__init__()
        # Initial number of channels
        self.inplanes = 64

        # -----------------------------------------------------------------
        # Stem Layers
        # -----------------------------------------------------------------
        # Initial convolution layer applied to RGB input image
        self.conv1 = nn.Conv2d(
            3, 
            64, 
            kernel_size = 7, 
            stride = 2, 
            padding = 3, 
            bias=False
        )
        # Batch normalisation for stem convolution
        self.bn1 = nn.BatchNorm2d(64)
        # ReLU activation function
        self.relu = nn.ReLU(inplace=True)
        # Max pooling layer reducing spatial resolution
        self.maxpool = nn.MaxPool2d(kernel_size = 3, 
                                    stride = 2, 
                                    padding = 1
                                    )

        # -----------------------------------------------------------------
        # Residual Stages
        # -----------------------------------------------------------------

        # Stage 1 residual block group (output stride = 4)
        self.layer1 = self._make_layer(block, 
                                       64, 
                                       layers[0], 
                                       stride = 1, 
                                       dilation = 1
                                       )

        # Stage 2 residual block group (output stride = 8)
        self.layer2 = self._make_layer(block, 
                                       128, 
                                       layers[1], 
                                       stride = 2, 
                                       dilation = 1
                                       )

        # Stage 3 residual block group with dilated convolution
        self.layer3 = self._make_layer(block, 
                                       256, 
                                       layers[2], 
                                       stride = 1, 
                                       dilation = 2
                                       )

        # Stage 4 residual block group with larger dilation
        self.layer4 = self._make_layer(block, 512, layers[3], stride=1, dilation=4)

        # Initialise network weights
        self._init_weights()


    # ==================================================================
    # Layer Construction Function
    # ==================================================================
    def _make_layer(self, block, planes, blocks, stride=1, dilation=1):
        # Initialise downsample module
        downsample = None
        # Store dilation value
        previous_dilation = dilation

        # If spatial size or channel count changes create downsample layer
        if stride != 1 or self.inplanes != planes * block.expansion:
            # Downsample only changes channels; stride is in conv2
            downsample = nn.Sequential(
                
                nn.Conv2d(
                    self.inplanes,   # Input channels
                    planes * block.expansion,   # Output channels
                    kernel_size = 1,
                    stride=stride,
                    bias=False,
                ),
                
                # Batch norm layer
                nn.BatchNorm2d(planes * block.expansion),
            )

        # Create list of residual blocks
        layers = []
        # Add first block with potential downsampling
        layers.append(
            block(
                self.inplanes,
                planes,
                stride=stride,
                dilation = previous_dilation,
                downsample = downsample,
            )
        )
        # Update channel size
        self.inplanes = planes * block.expansion

        # Add remaining residual blocks
        for _ in range(1, blocks):
            layers.append(
                block(self.inplanes, 
                      planes, 
                      stride = 1, 
                      dilation = dilation, 
                      downsample = None)
            )

        # Convert block list to sequential module
        return nn.Sequential(*layers)

    # ==================================================================
    # Weight Initialisation
    # ==================================================================
    def _init_weights(self):
        # Iterate through all layers
        for m in self.modules():
            # Initialise convolution layers with He normal initialisation
            if isinstance(m, nn.Conv2d):
                nn.init.kaiming_normal_(m.weight, 
                                        mode = "fan_out", 
                                        nonlinearity = "relu")
            # Initialise normalisation layers    
            elif isinstance(m, (nn.BatchNorm2d, nn.GroupNorm)):
                nn.init.constant_(m.weight, 1)
                nn.init.constant_(m.bias, 0)

    # ==================================================================
    # Forward Pass
    # ==================================================================
    def forward(self, x):
        # Input tensor shape: [Batch, Channels, Height, Width]
        
        # Apply first convolution
        x = self.conv1(x)    # /2
        # Apply batch normalisation
        x = self.bn1(x)
        # Apply ReLU activation
        x = self.relu(x)
        # Apply max pooling
        x = self.maxpool(x)  # /4

        # Pass through stage 1 residual blocks
        x = self.layer1(x)   # /4
        # Pass through stage 2 residual blocks
        x = self.layer2(x)   # /8
        # Stage 3 features (dilated)
        feat_stage3 = self.layer3(x)  # /8, dilation 2
        # Stage 4 features
        feat_stage4 = self.layer4(feat_stage3)  # /8, dilation 4

        # Return intermediate feature maps
        return feat_stage3, feat_stage4

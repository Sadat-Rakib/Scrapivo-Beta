"""
Convert hero-cloud.png from RGB to RGBA with proper transparency.
The cloud image has a dark/black background that needs to become transparent.
We use luminance-based alpha: bright cloud areas stay opaque, dark background becomes transparent.
"""
from PIL import Image
import numpy as np

img = Image.open("src/assets/hero-cloud.png").convert("RGBA")
data = np.array(img, dtype=np.float64)

# Calculate luminance from RGB
r, g, b = data[:,:,0], data[:,:,1], data[:,:,2]
luminance = 0.299 * r + 0.587 * g + 0.114 * b

# Create alpha channel based on luminance
# Dark pixels (background) -> transparent, bright pixels (cloud) -> opaque
# Use a curve to make the transition smoother
alpha = np.clip(luminance * 1.8, 0, 255)

# For very dark pixels, make fully transparent
alpha[luminance < 15] = 0

# For mid-range, apply a smooth curve
mid_mask = (luminance >= 15) & (luminance < 80)
alpha[mid_mask] = ((luminance[mid_mask] - 15) / 65.0) ** 0.7 * 180

# Brighten the cloud pixels slightly so they look good on dark backgrounds
# Keep the cloud texture but make it lighter/more visible
cloud_mask = luminance > 30
data[:,:,0][cloud_mask] = np.clip(data[:,:,0][cloud_mask] * 1.15 + 20, 0, 255)
data[:,:,1][cloud_mask] = np.clip(data[:,:,1][cloud_mask] * 1.15 + 20, 0, 255)
data[:,:,2][cloud_mask] = np.clip(data[:,:,2][cloud_mask] * 1.15 + 20, 0, 255)

data[:,:,3] = alpha

result = Image.fromarray(data.astype(np.uint8), "RGBA")
result.save("src/assets/hero-cloud.png")
print("Done! Saved transparent cloud to src/assets/hero-cloud.png")
print(f"Result mode: {result.mode}, size: {result.size}")

# Verify
verify = Image.open("src/assets/hero-cloud.png")
print(f"Verify mode: {verify.mode}")

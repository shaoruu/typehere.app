#!/usr/bin/env python3
"""
Generate macOS app icons from a source image.

Layout:
- 1024×1024 transparent canvas
- inset “icon plate” (default 128px per side -> 768×768 plate)
- rounded corners apply to the plate, not the outer transparent margin
"""

import sys
from pathlib import Path

try:
    from PIL import Image, ImageChops, ImageDraw
except ImportError:
    print("Pillow is required. Install with: pip install Pillow")
    sys.exit(1)


CANVAS_SIZE = 1024
INSET_PX = 128  # 12.5% - Apple sweet spot
PLATE_RADIUS_FACTOR = 0.22

# macOS icon sizes (filename suffix, size in px)
MACOS_SIZES = [
    ("1024x1024", 1024),
    ("512x512@2x", 1024),
    ("512x512", 512),
    ("256x256@2x", 512),
    ("256x256", 256),
    ("128x128@2x", 256),
    ("128x128", 128),
    ("64x64@2x", 128),
    ("64x64", 64),
    ("32x32@2x", 64),
    ("32x32", 32),
    ("16x16@2x", 32),
    ("16x16", 16),
]


def create_squircle_mask(size: int, radius_factor: float) -> Image.Image:
    """
    Create a squircle (superellipse) mask for macOS-style rounded corners.
    
    Apple uses a continuous curvature shape, not simple rounded rectangles.
    This approximation uses a high-quality antialiased approach.
    """
    # Work at 4x resolution for antialiasing
    scale = 4
    large_size = size * scale
    
    mask = Image.new("L", (large_size, large_size), 0)
    draw = ImageDraw.Draw(mask)
    
    # Rounded-rectangle approximation of macOS squircle
    corner_radius = int(large_size * radius_factor)
    
    # Draw rounded rectangle (approximation of squircle)
    draw.rounded_rectangle(
        [(0, 0), (large_size - 1, large_size - 1)],
        radius=corner_radius,
        fill=255
    )
    
    # Downscale with high-quality resampling for smooth edges
    mask = mask.resize((size, size), Image.Resampling.LANCZOS)
    
    return mask


def crop_center_square(img: Image.Image) -> Image.Image:
    w, h = img.size
    if w == h:
        return img
    side = min(w, h)
    left = (w - side) // 2
    top = (h - side) // 2
    return img.crop((left, top, left + side, top + side))


def average_corner_color(img: Image.Image, sample_size: int = 16, alpha_threshold: int = 12) -> tuple[int, int, int, int]:
    w, h = img.size
    s = min(sample_size, w, h)
    corners = [
        (0, 0),
        (w - s, 0),
        (0, h - s),
        (w - s, h - s),
    ]

    r_sum = 0
    g_sum = 0
    b_sum = 0
    count = 0

    for x, y in corners:
        region = img.crop((x, y, x + s, y + s))
        for r, g, b, a in region.getdata():
            if a >= alpha_threshold:
                r_sum += r
                g_sum += g
                b_sum += b
                count += 1

    if count == 0:
        return (255, 255, 255, 255)

    return (r_sum // count, g_sum // count, b_sum // count, 255)


def process_icon(source_path: Path, output_dir: Path, inset_px: int = INSET_PX) -> None:
    """
    Process source image into macOS icon set.
    
    1. Load source image
    2. Create a square, resized artwork for the icon plate
    3. Fill the plate background based on source corners (avoid halos)
    4. Apply rounded mask to the plate
    5. Composite plate onto transparent 1024×1024 canvas at inset
    6. Export at all required sizes
    """
    print(f"Loading source: {source_path}")
    source = Image.open(source_path).convert("RGBA")

    if inset_px < 0 or inset_px * 2 >= CANVAS_SIZE:
        raise ValueError(f"inset_px must be in [0, {CANVAS_SIZE // 2 - 1}]")

    plate_size = CANVAS_SIZE - (inset_px * 2)

    source_sq = crop_center_square(source)
    art = source_sq.resize((plate_size, plate_size), Image.Resampling.LANCZOS)

    plate_bg = average_corner_color(art)
    plate = Image.new("RGBA", (plate_size, plate_size), plate_bg)
    plate.alpha_composite(art)

    plate_mask = create_squircle_mask(plate_size, PLATE_RADIUS_FACTOR)
    pr, pg, pb, pa = plate.split()
    plate_alpha = ImageChops.multiply(pa, plate_mask)
    plate = Image.merge("RGBA", (pr, pg, pb, plate_alpha))

    canvas = Image.new("RGBA", (CANVAS_SIZE, CANVAS_SIZE), (0, 0, 0, 0))
    canvas.alpha_composite(plate, (inset_px, inset_px))
    
    # Create output directory
    output_dir.mkdir(parents=True, exist_ok=True)
    
    # Save at each required size
    print(f"Generating icons in: {output_dir}")
    for suffix, size in MACOS_SIZES:
        output_path = output_dir / f"icon_{suffix}.png"
        
        if size == CANVAS_SIZE:
            icon = canvas.copy()
        else:
            icon = canvas.resize((size, size), Image.Resampling.LANCZOS)
        
        icon.save(output_path, "PNG")
        print(f"  {suffix}: {output_path.name}")
    
    # Also save the main 1024 icon as icon.png
    main_icon_path = output_dir / "icon.png"
    canvas.save(main_icon_path, "PNG")
    print(f"  Main icon: {main_icon_path.name}")
    
    print(f"\nDone! Generated {len(MACOS_SIZES) + 1} icons.")


def main():
    if len(sys.argv) < 2:
        print("Usage: python generate-macos-icons.py <source_image> [output_dir] [inset_px]")
        print()
        print("Arguments:")
        print("  source_image  Path to source image (PNG recommended)")
        print("  output_dir    Output directory (default: ./icons)")
        print("  inset_px      Inset in pixels at 1024 scale (default: 128)")
        print()
        print("Examples:")
        print("  python generate-macos-icons.py logo.png")
        print("  python generate-macos-icons.py logo.png ./my-icons 140")
        sys.exit(1)
    
    source_path = Path(sys.argv[1])
    if not source_path.exists():
        print(f"Error: Source file not found: {source_path}")
        sys.exit(1)
    
    output_dir = Path(sys.argv[2]) if len(sys.argv) > 2 else Path("./icons")
    inset_px = int(sys.argv[3]) if len(sys.argv) > 3 else INSET_PX
    
    print(f"Settings:")
    print(f"  Canvas: {CANVAS_SIZE}x{CANVAS_SIZE}")
    print(f"  Inset: {inset_px}px ({inset_px/CANVAS_SIZE*100:.1f}%)")
    print(f"  Plate: {CANVAS_SIZE - inset_px*2}px")
    print()
    
    process_icon(source_path, output_dir, inset_px)


if __name__ == "__main__":
    main()

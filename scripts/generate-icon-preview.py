#!/usr/bin/env python3

from PIL import Image, ImageDraw
import os

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_DIR = os.path.dirname(SCRIPT_DIR)

ICON_SCALE = 0.847
CORNER_RADIUS_PERCENT = 0.225
CONTENT_SCALE = 0.72


def get_content_bbox(img):
    if img.mode != "RGBA":
        img = img.convert("RGBA")

    pixels = img.load()
    width, height = img.size

    min_x, min_y = width, height
    max_x, max_y = 0, 0

    for y in range(height):
        for x in range(width):
            r, g, b, a = pixels[x, y]
            is_white = r > 250 and g > 250 and b > 250
            is_transparent = a < 10

            if not is_white and not is_transparent:
                min_x = min(min_x, x)
                min_y = min(min_y, y)
                max_x = max(max_x, x)
                max_y = max(max_y, y)

    if min_x > max_x or min_y > max_y:
        return (0, 0, width, height)

    return (min_x, min_y, max_x + 1, max_y + 1)


def process_icon(input_path, output_path, target_size=1024):
    source = Image.open(input_path).convert("RGBA")
    bbox = get_content_bbox(source)
    content = source.crop(bbox)

    content_w, content_h = content.size
    max_dim = max(content_w, content_h)

    icon_size = int(target_size * ICON_SCALE)
    margin = (target_size - icon_size) // 2

    target_content_size = int(icon_size * CONTENT_SCALE)
    scale = target_content_size / max_dim

    new_w = int(content_w * scale)
    new_h = int(content_h * scale)

    content_resized = content.resize((new_w, new_h), Image.LANCZOS)

    icon_img = Image.new("RGBA", (icon_size, icon_size), (255, 255, 255, 255))
    paste_x = (icon_size - new_w) // 2
    paste_y = (icon_size - new_h) // 2
    icon_img.paste(content_resized, (paste_x, paste_y), content_resized)

    corner_radius = int(icon_size * CORNER_RADIUS_PERCENT)
    mask = Image.new("L", (icon_size, icon_size), 0)
    draw = ImageDraw.Draw(mask)
    draw.rounded_rectangle([(0, 0), (icon_size - 1, icon_size - 1)], radius=corner_radius, fill=255)

    result = Image.new("RGBA", (target_size, target_size), (0, 0, 0, 0))
    result.paste(icon_img, (margin, margin), mask)

    result.save(output_path, "PNG")
    return output_path


if __name__ == "__main__":
    input_icon = os.path.join(PROJECT_DIR, "app-icon.png")
    output_preview = os.path.join(PROJECT_DIR, "icon-preview.png")

    process_icon(input_icon, output_preview, target_size=1024)

    print(f"Preview icon created: {output_preview}")

"""
PNG rendering for tree skeleton visualization.
"""
from io import BytesIO
from typing import Dict

from PIL import Image, ImageDraw


def render_skeleton_png(skeleton_data: Dict) -> BytesIO:
    """
    Render skeleton data to PNG image using bezier curves.

    Returns BytesIO object containing PNG data.
    """
    width, height = skeleton_data["canvas_size"]

    img = Image.new("RGB", (width, height), "white")
    draw = ImageDraw.Draw(img)

    for branch in skeleton_data["branches"]:
        start = branch["start"]
        end = branch["end"]
        cp1 = branch["control1"]
        cp2 = branch["control2"]
        thickness = int(branch["thickness"])

        # Sample bezier curve into line segments
        points = []
        steps = 20
        for i in range(steps + 1):
            t = i / steps
            x = (
                (1 - t) ** 3 * start[0] +
                3 * (1 - t) ** 2 * t * cp1[0] +
                3 * (1 - t) * t ** 2 * cp2[0] +
                t ** 3 * end[0]
            )
            y = (
                (1 - t) ** 3 * start[1] +
                3 * (1 - t) ** 2 * t * cp1[1] +
                3 * (1 - t) * t ** 2 * cp2[1] +
                t ** 3 * end[1]
            )
            points.append((x, y))

        if len(points) > 1:
            draw.line(points, fill="black", width=thickness, joint="curve")

    buffer = BytesIO()
    img.save(buffer, format="PNG")
    buffer.seek(0)

    return buffer

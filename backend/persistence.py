"""
Persistence layer: save skeleton data and PNG to Supabase.
"""
from io import BytesIO
from datetime import datetime
from typing import Dict

from db import supabase


def save_skeleton(user_id: str, skeleton_data: Dict, png_bytes: BytesIO) -> str:
    """
    Save skeleton data and PNG to Supabase.

    Returns public URL of the PNG.
    """
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    filename = f"{user_id}/{timestamp}.png"

    supabase.storage.from_("tree-assets").upload(
        filename,
        png_bytes.getvalue(),
        {"content-type": "image/png"}
    )

    png_url = supabase.storage.from_("tree-assets").get_public_url(filename)

    supabase.table("tree_skeletons").insert({
        "owner_id": user_id,
        "skeleton_data": skeleton_data,
        "png_url": png_url
    }).execute()

    return png_url

"""
Tree visualization orchestrator.
"""
import os
from tree_repository import fetch_user_tree
from lsystem import generate_lsystem_skeleton
from tree_skeleton import generate_tree_skeleton as generate_sc_skeleton
from renderer import render_skeleton_png
from persistence import save_skeleton

TREE_GEN_VERSION = int(os.environ.get("TREE_GEN_VERSION", "2"))


def generate_tree_visualization(user_id: str) -> str:
    """
    Main function to generate tree visualization.

    Returns PNG URL.
    """
    tree_data = fetch_user_tree(user_id)

    if not tree_data:
        raise ValueError(f"No tree data found for user {user_id}")

    if TREE_GEN_VERSION == 2:
        skeleton = generate_sc_skeleton(tree_data)
    else:
        skeleton = generate_lsystem_skeleton(tree_data)
    png_bytes = render_skeleton_png(skeleton)
    png_url = save_skeleton(user_id, skeleton, png_bytes)

    return png_url

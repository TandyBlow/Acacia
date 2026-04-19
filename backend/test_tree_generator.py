"""
Test script for tree_generator.py

Usage:
    python test_tree_generator.py <user_id>

Example:
    python test_tree_generator.py 550e8400-e29b-41d4-a716-446655440000
"""
import sys
from tree_generator import generate_tree_visualization


def main():
    if len(sys.argv) < 2:
        print("Usage: python test_tree_generator.py <user_id>")
        sys.exit(1)

    user_id = sys.argv[1]

    print(f"Generating tree visualization for user: {user_id}")

    try:
        png_url = generate_tree_visualization(user_id)
        print(f"\nSuccess!")
        print(f"PNG URL: {png_url}")
        print(f"\nOpen this URL in your browser to view the generated tree.")
    except ValueError as e:
        print(f"\nError: {e}")
        sys.exit(1)
    except Exception as e:
        print(f"\nUnexpected error: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)


if __name__ == "__main__":
    main()

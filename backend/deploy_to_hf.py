"""
Deploy backend to Hugging Face Spaces
"""
import os
import sys
from pathlib import Path
from huggingface_hub import HfApi, create_repo, upload_folder

def deploy_to_hf_spaces():
    # Configuration
    space_name = "acacia"
    username = "TandyBlow"
    repo_id = f"{username}/{space_name}"

    print(f"Deploying to {repo_id}...")

    # Initialize API
    api = HfApi()

    # Check if logged in
    try:
        user = api.whoami()
        print(f"Logged in as: {user['name']}")
    except Exception as e:
        print("Error: Not logged in to Hugging Face.")
        print("Please run: huggingface-cli login")
        print("Or set HF_TOKEN environment variable")
        sys.exit(1)

    # Create Space if it doesn't exist
    try:
        print(f"Creating Space {repo_id}...")
        create_repo(
            repo_id=repo_id,
            repo_type="space",
            space_sdk="docker",
            exist_ok=True,
        )
        print("Space created/verified successfully")
    except Exception as e:
        print(f"Error creating Space: {e}")
        sys.exit(1)

    # Upload backend files
    backend_dir = Path(__file__).parent

    print(f"Uploading files from {backend_dir}...")
    try:
        api.upload_folder(
            folder_path=str(backend_dir),
            repo_id=repo_id,
            repo_type="space",
            ignore_patterns=[
                "*.pyc",
                "__pycache__",
                ".env",
                ".env.*",
                "tests",
                "test_*.py",
                "deploy_to_hf.py",
                ".pytest_cache",
            ],
        )
        print("Upload successful!")
        print(f"\nSpace URL: https://huggingface.co/spaces/{repo_id}")
        print(f"API URL: https://{username}-{space_name}.hf.space")
        print("\nDon't forget to add Secrets in Space settings:")
        print("  SUPABASE_URL")
        print("  SUPABASE_SERVICE_KEY")
    except Exception as e:
        print(f"Error uploading files: {e}")
        sys.exit(1)

if __name__ == "__main__":
    deploy_to_hf_spaces()

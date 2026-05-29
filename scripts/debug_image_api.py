#!/usr/bin/env python3
"""
Debug script to compare image API calls between demo and production.
"""
import httpx
import base64
import os
from pathlib import Path

PROJECT_ROOT = Path(__file__).parent.parent
REFERENCE_IMAGE = PROJECT_ROOT / "background.png"
OUTPUT_DIR = PROJECT_ROOT / "scripts" / "demo_output"

IMAGE_API_KEY = os.getenv("IMAGE_API_KEY")
if not IMAGE_API_KEY:
    raise RuntimeError("IMAGE_API_KEY 环境变量未设置")
IMAGE_API_URL = "https://ai.centos.hk/v1/images/edits"
IMAGE_MODEL = "gpt-image-2"

def test_api_call(prompt: str, output_name: str):
    """Test image API with given prompt."""
    print(f"\n{'='*60}")
    print(f"Testing: {output_name}")
    print(f"Prompt: {prompt}")
    print(f"{'='*60}")

    headers = {"Authorization": f"Bearer {IMAGE_API_KEY}"}

    image_bytes = open(REFERENCE_IMAGE, "rb").read()
    print(f"Reference image size: {len(image_bytes)/1024:.1f} KB")

    files = {"image": ("reference.png", image_bytes, "image/png")}

    data = {
        "model": IMAGE_MODEL,
        "prompt": prompt,
        "size": "1536x1024",
        "n": "1",
    }

    print(f"\nRequest data:")
    print(f"  model: {data['model']}")
    print(f"  size: {data['size']}")
    print(f"  n: {data['n']}")
    print(f"  prompt: {data['prompt']}")

    try:
        with httpx.Client(timeout=180) as client:
            resp = client.post(IMAGE_API_URL, headers=headers, files=files, data=data)
            print(f"\nResponse status: {resp.status_code}")

            if resp.status_code != 200:
                print(f"Error: {resp.text[:500]}")
                return None

            result = resp.json()
            if "data" in result and len(result["data"]) > 0:
                b64_data = result["data"][0]["b64_json"]
                image_data = base64.b64decode(b64_data)
                output_path = OUTPUT_DIR / f"{output_name}.png"
                with open(output_path, "wb") as f:
                    f.write(image_data)
                print(f"[OK] Saved to: {output_path} ({len(image_data)/1024:.1f} KB)")
                return output_path
            else:
                print(f"Unexpected response: {str(result)[:200]}")
                return None
    except Exception as e:
        print(f"Exception: {e}")
        return None


if __name__ == "__main__":
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    # Test 1: Demo-style prompt (what works)
    test_api_call(
        "保持完全相同的构图和结构，改变为黄昏时分，天空从橙金渐变到淡紫，远山笼罩在暖色薄雾中，地面呈现干燥的赭石色调，整体氛围沉静而温暖。",
        "test_demo_style"
    )

    # Test 2: Production-style prompt (what might be failing)
    test_api_call(
        "保持完全相同的构图和结构，改变为温暖的古典图书馆氛围，暖黄色灯光透过哥特式窗户洒落，书架与木质家具呈现深棕色调，整体散发沉静的学术气息。",
        "test_production_style"
    )

    # Test 3: Minimal prompt
    test_api_call(
        "保持完全相同的构图和结构，改变为夜晚星空场景",
        "test_minimal"
    )

    print(f"\n{'='*60}")
    print("All tests complete. Check demo_output/ for results.")
    print(f"{'='*60}")

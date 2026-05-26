#!/usr/bin/env python3
"""
Test different scene types to understand what works and what doesn't.
"""
import httpx
import base64
from pathlib import Path

PROJECT_ROOT = Path(__file__).parent.parent
REFERENCE_IMAGE = PROJECT_ROOT / "background.png"
OUTPUT_DIR = PROJECT_ROOT / "scripts" / "demo_output"

IMAGE_API_KEY = "REMOVED"
IMAGE_API_URL = "https://ai.centos.hk/v1/images/edits"

TEST_SCENES = [
    # 成功案例（从demo推测）
    ("赛博都市", "保持完全相同的构图和结构，改变为赛博朋克都市夜景，霓虹灯光，高楼林立，雨后街道反光"),
    ("日式禅意", "保持完全相同的构图和结构，改变为日式禅意庭院，樱花飘落，远山如富士山，枯山水纹理"),

    # 失败案例（从项目推测）
    ("图书馆内部", "保持完全相同的构图和结构，改变为温暖的古典图书馆氛围，暖黄色灯光透过哥特式窗户洒落，书架与木质家具呈现深棕色调"),

    # 新测试：建筑外观 vs 建筑内部
    ("城堡外观", "保持完全相同的构图和结构，改变为中世纪城堡外观，石墙高耸，远处山峦，地面石板路"),
    ("教堂内部", "保持完全相同的构图和结构，改变为哥特式教堂内部，彩色玻璃窗，石柱林立，光线从窗户洒入"),

    # 新测试：开放空间 vs 封闭空间
    ("广场", "保持完全相同的构图和结构，改变为欧洲广场，远处教堂尖顶，地面鹅卵石铺就，天空晴朗"),
    ("洞穴", "保持完全相同的构图和结构，改变为神秘洞穴内部，钟乳石垂挂，地面潮湿，微光从洞口透入"),
]

def test_scene(name: str, prompt: str):
    print(f"\n{'='*60}")
    print(f"测试: {name}")
    print(f"Prompt: {prompt[:80]}...")
    print(f"{'='*60}")

    headers = {"Authorization": f"Bearer {IMAGE_API_KEY}"}
    image_bytes = open(REFERENCE_IMAGE, "rb").read()
    files = {"image": ("reference.png", image_bytes, "image/png")}
    data = {
        "model": "gpt-image-2",
        "prompt": prompt,
        "size": "1536x1024",
        "n": "1",
    }

    try:
        with httpx.Client(timeout=180) as client:
            resp = client.post(IMAGE_API_URL, headers=headers, files=files, data=data)
            if resp.status_code != 200:
                print(f"[ERROR] HTTP {resp.status_code}")
                return None

            result = resp.json()
            if "data" in result and len(result["data"]) > 0:
                b64_data = result["data"][0]["b64_json"]
                image_data = base64.b64decode(b64_data)
                safe_name = name.replace(" ", "_").replace("/", "_")
                output_path = OUTPUT_DIR / f"scene_test_{safe_name}.png"
                with open(output_path, "wb") as f:
                    f.write(image_data)
                print(f"[OK] 已保存: {output_path.name} ({len(image_data)/1024:.1f} KB)")
                return output_path
            else:
                print(f"[ERROR] API返回格式错误")
                return None
    except Exception as e:
        print(f"[ERROR] {e}")
        return None

if __name__ == "__main__":
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    print("="*60)
    print("场景类型测试：什么能保持构图，什么不能？")
    print("="*60)

    for name, prompt in TEST_SCENES:
        test_scene(name, prompt)

    print(f"\n{'='*60}")
    print("测试完成！请查看生成的图片，对比哪些保持了构图。")
    print(f"{'='*60}")

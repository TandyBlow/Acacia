#!/usr/bin/env python3
"""
Final test: Generate background image with the fixed prompt to verify it maintains composition.
"""
import os
import sys
import json
import base64
import httpx
from pathlib import Path

PROJECT_ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(PROJECT_ROOT / "backend"))

from style_generator import STYLE_SYSTEM_PROMPT, _call_deepseek, _parse_json

# Load API keys
env_path = PROJECT_ROOT / "backend" / ".env"
if env_path.exists():
    for line in open(env_path):
        if line.startswith("LLM_API_KEY="):
            os.environ["LLM_API_KEY"] = line.strip().split("=", 1)[1].strip('"')

IMAGE_API_KEY = os.getenv("IMAGE_API_KEY")
if not IMAGE_API_KEY:
    raise RuntimeError("IMAGE_API_KEY 环境变量未设置")
IMAGE_API_URL = "https://ai.centos.hk/v1/images/edits"
REFERENCE_IMAGE = PROJECT_ROOT / "background.png"
OUTPUT_DIR = PROJECT_ROOT / "scripts" / "demo_output"

# Test with library/academic knowledge that previously triggered indoor scenes
LIBRARY_KNOWLEDGE = [
    "图书馆学：杜威十进制分类法的设计原理",
    "信息检索：布尔逻辑与全文搜索",
    "古籍修复：纸张脱酸与装帧技术",
    "档案管理：文献保存的温湿度控制",
    "阅读心理学：深度阅读与浅层浏览的认知差异",
    "书籍装帧艺术：从羊皮卷到精装本",
    "文献计量学：引文分析与学术影响力",
    "数字图书馆：元数据标准与互操作性",
]

def generate_style_for_test():
    """Generate style params using the updated prompt."""
    user_prompt = "以下是一个学习者的知识库内容，请分析其知识世界的气质与情感温度，生成匹配的视觉风格参数：\n\n"
    for node in LIBRARY_KNOWLEDGE:
        user_prompt += f"- {node}\n"

    print("正在调用DeepSeek生成风格...")
    raw = _call_deepseek([
        {"role": "system", "content": STYLE_SYSTEM_PROMPT},
        {"role": "user", "content": user_prompt},
    ])
    result = _parse_json(raw)

    style_name = result.get("styleName", "?")
    bg_prompt = result.get("backgroundPrompt", "")

    print(f"\n风格名称: {style_name}")
    print(f"背景Prompt: {bg_prompt}")

    # Check for indoor keywords
    indoor_keywords = ["图书馆", "书架", "房间", "室内", "窗户", "建筑内", "书房", "办公室", "教室"]
    found_indoor = [kw for kw in indoor_keywords if kw in bg_prompt]

    if found_indoor:
        print(f"\n[WARNING] 检测到室内关键词: {found_indoor}")
    else:
        print(f"\n[OK] 背景为户外场景")

    return result

def generate_background_image(bg_prompt: str, output_name: str):
    """Generate background image using gpt-image-2."""
    print(f"\n正在生成背景图...")

    headers = {"Authorization": f"Bearer {IMAGE_API_KEY}"}
    full_prompt = f"保持完全相同的构图和结构，改变为{bg_prompt}"

    image_bytes = open(REFERENCE_IMAGE, "rb").read()
    files = {"image": ("reference.png", image_bytes, "image/png")}
    data = {
        "model": "gpt-image-2",
        "prompt": full_prompt,
        "size": "1536x1024",
        "n": "1",
    }

    with httpx.Client(timeout=180) as client:
        resp = client.post(IMAGE_API_URL, headers=headers, files=files, data=data)
        if resp.status_code != 200:
            print(f"[ERROR] HTTP {resp.status_code}: {resp.text[:200]}")
            return None

        result = resp.json()
        if "data" in result and len(result["data"]) > 0:
            b64_data = result["data"][0]["b64_json"]
            image_data = base64.b64decode(b64_data)
            output_path = OUTPUT_DIR / f"{output_name}.png"
            with open(output_path, "wb") as f:
                f.write(image_data)
            print(f"[OK] 背景图已保存: {output_path} ({len(image_data)/1024:.1f} KB)")
            return output_path
        else:
            print(f"[ERROR] API返回格式错误")
            return None

if __name__ == "__main__":
    print("="*60)
    print("最终测试：图书馆学知识库 → 户外场景背景")
    print("="*60)

    # Step 1: Generate style
    style_result = generate_style_for_test()

    # Step 2: Generate background image
    bg_prompt = style_result.get("backgroundPrompt", "")
    if bg_prompt:
        bg_path = generate_background_image(bg_prompt, "final_test_library_outdoor")

        # Save result
        result_path = OUTPUT_DIR / "final_test_result.json"
        with open(result_path, "w", encoding="utf-8") as f:
            json.dump(style_result, f, ensure_ascii=False, indent=2)

        print(f"\n{'='*60}")
        print("测试完成！")
        print(f"风格JSON: {result_path}")
        print(f"背景图: {bg_path}")
        print(f"{'='*60}")
    else:
        print("[ERROR] 未生成背景描述")

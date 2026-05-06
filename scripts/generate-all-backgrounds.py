#!/usr/bin/env python3
"""
批量生成多风格背景图
基于参考图使用 image-to-image 方式生成不同风格
"""
import httpx
import base64
from pathlib import Path
import time

# API配置
API_KEY = "REMOVED"
API_URL = "https://ai.centos.hk/v1/images/edits"
MODEL = "gpt-image-2"

# 参考图路径
REFERENCE_IMAGE = Path(__file__).parent.parent / "background.png"

# 输出目录
OUTPUT_DIR = Path(__file__).parent.parent / "frontend" / "public" / "backgrounds"

# 风格配置
STYLES = {
    "default": "吉卜力动画风格，柔和的水彩插画效果，温暖色调，宁静氛围",
    "sakura": "樱花主题，粉色花瓣飘落，春天氛围，柔和粉色调，日本美学",
    "cyberpunk": "赛博朋克风格，霓虹灯光，未来科技感，紫色和蓝色调，全息投影元素，科幻城市",
    "ink": "中国传统水墨画风格，黑白为主，留白艺术，毛笔笔触，写意山水",
}


def generate_background(style_name: str, style_prompt: str) -> bytes:
    """
    生成指定风格的背景图

    Returns:
        图片的二进制数据
    """
    print(f"\n[{style_name}] 开始生成...")
    print(f"  Prompt: {style_prompt[:80]}...")

    # 构建完整prompt
    full_prompt = f"保持完全相同的构图和结构，改变为{style_prompt}"

    headers = {
        "Authorization": f"Bearer {API_KEY}",
    }

    # 使用 multipart/form-data 格式
    files = {
        "image": ("reference.png", open(REFERENCE_IMAGE, "rb"), "image/png")
    }

    data = {
        "model": MODEL,
        "prompt": full_prompt,
        "size": "1536x1024",
        "n": "1"
    }

    try:
        with httpx.Client(timeout=180) as client:
            response = client.post(API_URL, headers=headers, files=files, data=data)

            if response.status_code != 200:
                print(f"  [ERROR] HTTP {response.status_code}: {response.text[:200]}")
                return None

            result = response.json()

            if "data" in result and len(result["data"]) > 0:
                b64_data = result["data"][0]["b64_json"]
                image_data = base64.b64decode(b64_data)

                print(f"  [OK] 生成成功，大小: {len(image_data) / 1024:.1f} KB")
                return image_data
            else:
                print(f"  [ERROR] API返回格式错误")
                return None

    except Exception as e:
        print(f"  [ERROR] 生成失败: {e}")
        return None


def main():
    print("=" * 60)
    print("批量生成多风格背景图")
    print("=" * 60)
    print(f"参考图: {REFERENCE_IMAGE}")
    print(f"输出目录: {OUTPUT_DIR}")
    print(f"风格数量: {len(STYLES)}")
    print("=" * 60)

    if not REFERENCE_IMAGE.exists():
        print(f"[ERROR] 参考图不存在: {REFERENCE_IMAGE}")
        return

    # 创建输出目录
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    # 统计
    success_count = 0
    failed_count = 0

    # 生成所有风格
    for style_name, style_prompt in STYLES.items():
        image_data = generate_background(style_name, style_prompt)

        if image_data:
            # 保存图片
            output_path = OUTPUT_DIR / f"{style_name}.png"
            with open(output_path, "wb") as f:
                f.write(image_data)

            print(f"  [OK] 已保存到: {output_path}")
            success_count += 1
        else:
            print(f"  [FAILED] {style_name} 生成失败")
            failed_count += 1

        # 避免请求过快，等待一下
        if style_name != list(STYLES.keys())[-1]:
            print("  等待5秒...")
            time.sleep(5)

    print("\n" + "=" * 60)
    print("生成完成！")
    print(f"成功: {success_count}/{len(STYLES)}")
    print(f"失败: {failed_count}/{len(STYLES)}")
    print(f"输出目录: {OUTPUT_DIR}")
    print("=" * 60)


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""
Test the updated system prompt to ensure it generates outdoor-only backgrounds.
"""
import os
import sys
import json
from pathlib import Path

PROJECT_ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(PROJECT_ROOT / "backend"))

from style_generator import STYLE_SYSTEM_PROMPT, _call_deepseek, _parse_json

# Load API key
env_path = PROJECT_ROOT / "backend" / ".env"
if env_path.exists():
    for line in open(env_path):
        if line.startswith("DEEPSEEK_API_KEY="):
            os.environ["DEEPSEEK_API_KEY"] = line.strip().split("=", 1)[1].strip('"')
            break

# Test with knowledge that might trigger indoor scenes
TEST_CASES = [
    {
        "name": "文学艺术爱好者",
        "nodes": [
            "莎士比亚戏剧：哈姆雷特的复仇主题",
            "古典音乐：贝多芬第九交响曲",
            "文艺复兴绘画：达芬奇的光影技法",
            "现代诗歌：艾略特的荒原意象",
            "图书馆学：杜威十进制分类法",
        ]
    },
    {
        "name": "计算机科学学生",
        "nodes": [
            "数据结构：二叉树遍历算法",
            "操作系统：进程调度策略",
            "数据库：SQL查询优化",
            "网络协议：TCP三次握手",
            "编译原理：词法分析器设计",
        ]
    },
    {
        "name": "历史研究者",
        "nodes": [
            "古罗马帝国：凯撒的高卢战记",
            "中世纪欧洲：骑士制度与封建社会",
            "文艺复兴：美第奇家族的艺术赞助",
            "工业革命：蒸汽机的发明与影响",
            "二战历史：诺曼底登陆战役",
        ]
    }
]

def test_prompt(case: dict):
    print(f"\n{'='*60}")
    print(f"测试用例: {case['name']}")
    print(f"{'='*60}")

    user_prompt = "以下是一个学习者的知识库内容，请分析其知识世界的气质与情感温度，生成匹配的视觉风格参数：\n\n"
    for node in case["nodes"]:
        user_prompt += f"- {node}\n"

    try:
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
            print(f"\n[WARNING] 检测到室内场景关键词: {found_indoor}")
            print("   这可能导致生成的背景图与底图构图不符！")
        else:
            print(f"\n[OK] 通过：背景描述为户外场景")

        return result

    except Exception as e:
        print(f"\n[ERROR] 错误: {e}")
        return None


if __name__ == "__main__":
    results = []
    for case in TEST_CASES:
        result = test_prompt(case)
        if result:
            results.append({
                "case": case["name"],
                "style": result.get("styleName"),
                "backgroundPrompt": result.get("backgroundPrompt"),
            })

    print(f"\n{'='*60}")
    print("测试完成")
    print(f"{'='*60}")

    output_path = PROJECT_ROOT / "scripts" / "demo_output" / "prompt_test_results.json"
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(results, f, ensure_ascii=False, indent=2)
    print(f"\n结果已保存到: {output_path}")

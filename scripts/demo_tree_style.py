#!/usr/bin/env python3
"""
Demo: AI-driven tree style generation from user knowledge data.
Generates TreeStyleParams via DeepSeek, background via gpt-image-2,
and produces an HTML preview — all without touching project code.

Usage: python scripts/demo_tree_style.py [user_id]
"""
import sys
import os
import json
import base64
import time
import hashlib
import httpx
from pathlib import Path

PROJECT_ROOT = Path(__file__).parent.parent
DB_PATH = PROJECT_ROOT / "backend" / "acacia.db"
REFERENCE_IMAGE = PROJECT_ROOT / "background.png"
OUTPUT_DIR = PROJECT_ROOT / "scripts" / "demo_output"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

# ── Config ────────────────────────────────────────────────────────────────
LLM_KEY = os.environ.get("LLM_API_KEY", "")
LLM_BASE_URL = os.environ.get("LLM_BASE_URL", "https://api.deepseek.com")
LLM_URL = f"{LLM_BASE_URL}/v1/chat/completions"
LLM_MODEL = os.environ.get("LLM_MODEL", "deepseek-chat")

IMAGE_API_KEY = os.environ.get("IMAGE_API_KEY", "")
if not IMAGE_API_KEY:
    raise RuntimeError("IMAGE_API_KEY 环境变量未设置")
IMAGE_API_URL = os.environ.get("IMAGE_API_URL")
if not IMAGE_API_URL:
    raise RuntimeError("IMAGE_API_URL 环境变量未设置")
IMAGE_MODEL = os.environ.get("IMAGE_MODEL", "gpt-image-2")

# ── SQLite helpers ─────────────────────────────────────────────────────────

def get_user_nodes(user_id: str) -> list[dict]:
    import sqlite3
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    nodes = conn.execute(
        "SELECT id, name, content, domain_tag FROM nodes "
        "WHERE owner_id = ? AND is_deleted = 0",
        (user_id,),
    ).fetchall()
    conn.close()
    return [dict(n) for n in nodes]


def list_users() -> list[dict]:
    import sqlite3
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    users = conn.execute("SELECT id, username FROM users").fetchall()
    conn.close()
    return [dict(u) for u in users]

# ── DeepSeek style generation ──────────────────────────────────────────────

STYLE_SYSTEM_PROMPT = """你是一位视觉设计AI。根据用户的知识库内容，感知其学习气质与情感温度，创造性地设计一套完整的树渲染视觉参数。

## 核心设计哲学

你不是在忠实地"翻译"知识点——你是在为这位学习者创造一个他们愿意沉浸其中的视觉世界。

1. **情感温度优先于主题标签**：不要机械地将"日本文化→粉色"、"编程→霓虹"。感受这个人的知识世界散发出的气质——是沉静的、热烈的、神秘的、还是理性的？用色彩来表达这种气质。

2. **大胆融合，敢于创造**：当用户的知识跨越多个领域时，创造第三种美学——不是A+B并列，而是A和B在更高维度上融合出的新世界。

3. **背景Prompt要像一句话电影画面**：描述画面氛围、光线、色调、意境。

4. **风格名称要有诗意**。

## 色彩灵感

- 沉静古典气质 → 暖赭石、墨绿、羊皮纸色，低饱和柔和光照
- 理性冷峻气质 → 深蓝灰、青绿、银白，高对比锐利光照
- 温暖人文气质 → 樱花粉、奶油色、淡金，柔光轻bloom
- 神秘深邃气质 → 暗紫、深青、午夜蓝，戏剧性光照
- 活力游戏气质 → 明快饱和色、撞色搭配，明亮轻快
- 赛博未来气质 → 霓虹紫、电光蓝、暗夜黑，冷色光照

## JSON格式要求

必须严格输出以下JSON结构，不要省略任何字段，不要添加额外的文字说明：

```json
{
  "styleName": "中文风格名",
  "styleDescription": "一句话描述",
  "backgroundPrompt": "背景画面描述（氛围向）",
  "params": {
    "trunkBaseColor": [R,G,B], "trunkMidColor": [R,G,B], "trunkTipColor": [R,G,B],
    "leafMidColor": [R,G,B], "leafLightColor": [R,G,B], "leafDarkColor": [R,G,B],
    "leafShadowSize": -0.25, "leafShadowSoftness": 1.0,
    "leafHighlightSize": -0.25, "leafHighlightSoftness": 1.0,
    "leafAlphaClipping": 0.5, "leafTextureIndex": 0,
    "windStrength": 0.3, "windFrequency": 0.4, "windScale": 0.5,
    "skyTopColor": [R,G,B], "skyBottomColor": [R,G,B],
    "groundColor": [R,G,B], "groundUndulation": 0.3,
    "particleColor": [R,G,B], "particleShape": 0, "particleSpeed": 0.4,
    "particleDirection": 1, "particleSpawnRate": 8, "particleSize": 1.0,
    "mainLightColor": [R,G,B], "mainLightIntensity": 2.5,
    "ambientLightColor": [R,G,B], "ambientLightIntensity": 0.5,
    "bloomStrength": 0.075, "bloomRadius": 0.4, "bloomThreshold": 0.7,
    "outlineColor": [R,G,B], "outlineWidth": 0.3,
    "bgCamY": 2.8, "bgCamPitch": -0.2, "bgCamZ": -5.0, "bgFovZoom": 2.0,
    "bgGroundY": -2.0, "bgHillFreq": 0.3, "bgHillAmp": 5.0,
    "bgHillDepth": 40.0, "bgBldgDepth": 40.0, "bgBuildingDensity": 0.5,
    "bgBuildingHeight": 4.0, "bgFogDistance": 60.0, "bgBarrelK": 0.3,
    "bgPlatformHeight": 0.12, "bgPlatformFade": 0.03, "bgPlatformTexWidth": 1536.0
  }
}
```

重要：RGB值必须在0.0-1.0范围（不是0-255）。所有params字段必须填满，不能省略。"""

# ── Nintendo fan demo ─────────────────────────────────────────────────────

NINTENDO_NODES = [
    ("塞尔达传说旷野之息开放世界设计", "旷野之息重新定义了开放世界游戏。'化学引擎'让火、风、电等元素在世界中自由互动。三角法则引导玩家探索——每个远景都是一个可到达的兴趣点。神庙分散在世界各处作为微缩关卡，替代了传统的大型迷宫群。"),
    ("马里奥系列的关卡设计哲学", "任天堂的关卡设计遵循'起承转结'原则：引入机制、发展变化、转折挑战、总结释放。1-1关是世界最著名的教学关卡，无需文字就能教会玩家跳跃、踩敌人、顶砖块。宫本茂提出的'妻度计'理论：让不玩游戏的人也能上手。"),
    ("宝可梦系列收集与对战系统", "宝可梦的核心循环是收集、训练、对战。属性相克系统(火克草克水克火)创造了18种属性间复杂的克制网络。个体值IV和努力值EV构成了隐藏的数值深度层。异色宝可梦1/4096的出现概率创造了极低概率的惊喜时刻。"),
    ("任天堂Switch硬件设计哲学", "Switch的'家用机掌机一体化'源于已故社长岩田聪的'扩大游戏人口'愿景。Joy-Con的可拆卸设计让一台设备支持多种玩法：桌面模式、TV模式、掌机模式。HD震动能模拟杯中冰块数量，是触觉反馈的艺术化应用。"),
    ("动物森友会的慢游戏设计", "动森打破了传统游戏的进度驱动模式。游戏时间与现实同步，季节变化、节日活动随时间自然展开。没有明确目标反而成为最大的吸引力——玩家自己定义什么是'玩得好'。狸克银行的无息贷款系统设计暗含对资本主义的温柔批判。"),
    ("任天堂IP宇宙的跨媒体叙事", "从马里奥到塞尔达到星之卡比，任天堂构建了游戏界最丰富的角色IP矩阵。超级任天堂世界主题乐园将游戏机制转化为物理体验。大乱斗是游戏史的活博物馆——每个参战角色都是对其原作历史的致敬。"),
    ("独立游戏的美学创新", "Celeste用像素风格和精准的手感讲述了一个关于心理健康的故事。《空洞骑士》以手绘动画和魂系叙事构建了深邃的昆虫王国。《星露谷物语》一人开发七年，证明了牧场物语式的慢生活游戏仍有巨大市场。"),
    ("游戏音乐的情感设计", "近藤浩治为马里奥谱写的主题曲仅有6个音符却成为游戏史上最知名的旋律。塞尔达系列的配乐从8bit芯片音乐进化到全编制交响乐。荒野之息的钢琴碎片化配乐刻意留白，让自然的声音也成为音乐的一部分——风的呼啸、草的沙沙声都是配器。"),
]

def create_nintendo_user():
    import sqlite3, uuid
    conn = sqlite3.connect(str(DB_PATH))
    username = "demo_nintendo_fan"
    existing = conn.execute("SELECT id FROM users WHERE username=?", (username,)).fetchone()
    if existing:
        uid = existing[0]
        conn.execute("DELETE FROM nodes WHERE owner_id=?", (uid,))
    else:
        uid = str(uuid.uuid4())
        conn.execute(
            "INSERT INTO users (id, username, password_hash, created_at) VALUES (?,?,?,datetime('now'))",
            (uid, username, "demo_hash"),
        )
    for i, (name, content) in enumerate(NINTENDO_NODES):
        nid = str(uuid.uuid4())
        conn.execute(
            "INSERT INTO nodes (id,owner_id,name,content,parent_id,sort_order,is_deleted) "
            "VALUES (?,?,?,?,NULL,?,0)",
            (nid, uid, name, content, i),
        )
    conn.commit()
    conn.close()
    return uid


def build_user_profile(nodes: list[dict]) -> str:
    """Summarize user knowledge for the AI prompt."""
    lines = []
    for n in nodes:
        name = n["name"]
        content = (n["content"] or "")[:300]
        tag = n.get("domain_tag") or "未分类"
        lines.append(f"[{tag}] {name}")
        if content:
            lines.append(f"  内容摘要: {content}")
    return "\n".join(lines)


def call_deepseek_for_style(user_profile: str) -> dict:
    """Call DeepSeek to generate style params from knowledge profile."""
    api_key = os.environ.get("LLM_API_KEY", "")
    if not api_key:
        raise RuntimeError("LLM_API_KEY not set")

    user_prompt = f"""以下是一个学习者的知识库内容，请分析并生成匹配的视觉风格参数：

{user_profile}

请输出JSON，不要输出其他文字。"""

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    payload = {
        "model": LLM_MODEL,
        "messages": [
            {"role": "system", "content": STYLE_SYSTEM_PROMPT},
            {"role": "user", "content": user_prompt},
        ],
        "temperature": 0.8,
        "max_tokens": 4096,
    }

    print("  [DeepSeek] 请求风格生成...")
    with httpx.Client(timeout=120) as client:
        resp = client.post(LLM_URL, headers=headers, json=payload)
        if resp.status_code != 200:
            raise RuntimeError(f"DeepSeek error {resp.status_code}: {resp.text[:300]}")

        content = resp.json()["choices"][0]["message"]["content"]
        # Extract JSON from response (handle preamble text and markdown fences)
        content = content.strip()
        start = content.find('{')
        end = content.rfind('}')
        if start != -1 and end != -1 and end > start:
            content = content[start:end + 1]
        content = content.strip()
        if content.startswith("```"):
            content = content.split("\n", 1)[1]
            if content.endswith("```"):
                content = content[:-3]
        return json.loads(content)


def validate_params(params: dict) -> list[str]:
    """Validate generated params, return list of issues."""
    issues = []
    required_color_keys = [
        "trunkBaseColor", "trunkMidColor", "trunkTipColor",
        "leafMidColor", "leafLightColor", "leafDarkColor",
        "skyTopColor", "skyBottomColor", "groundColor",
        "particleColor", "mainLightColor", "ambientLightColor", "outlineColor",
    ]
    required_scalar_keys = [
        "leafShadowSize", "leafShadowSoftness", "leafHighlightSize",
        "leafHighlightSoftness", "leafAlphaClipping", "leafTextureIndex",
        "windStrength", "windFrequency", "windScale",
        "groundUndulation", "particleShape", "particleSpeed",
        "particleDirection", "particleSpawnRate", "particleSize",
        "mainLightIntensity", "ambientLightIntensity",
        "bloomStrength", "bloomRadius", "bloomThreshold",
        "outlineWidth",
    ]

    for key in required_color_keys:
        val = params.get(key)
        if not isinstance(val, list) or len(val) != 3:
            issues.append(f"{key}: 应为[R,G,B]数组")
        elif not all(0.0 <= v <= 1.0 for v in val):
            issues.append(f"{key}: RGB值应在0-1范围，当前{val}")

    for key in required_scalar_keys:
        if key not in params:
            issues.append(f"{key}: 缺失")

    return issues

# ── gpt-image-2 background generation ─────────────────────────────────────

def generate_background(style_prompt: str, output_name: str) -> Path | None:
    """Generate a styled background using gpt-image-2 image edit API."""
    print(f"  [gpt-image-2] 生成背景: {style_prompt[:60]}...")

    headers = {"Authorization": f"Bearer {IMAGE_API_KEY}"}
    full_prompt = f"保持完全相同的构图和结构，改变为{style_prompt}"

    image_bytes = open(REFERENCE_IMAGE, "rb").read()
    files = {"image": ("reference.png", image_bytes, "image/png")}

    data = {
        "model": IMAGE_MODEL,
        "prompt": full_prompt,
        "size": "1536x1024",
        "n": "1",
    }

    try:
        with httpx.Client(timeout=180) as client:
            resp = client.post(IMAGE_API_URL, headers=headers, files=files, data=data)
            if resp.status_code != 200:
                print(f"  [ERROR] HTTP {resp.status_code}: {resp.text[:200]}")
                return None

            result = resp.json()
            if "data" in result and len(result["data"]) > 0:
                b64_data = result["data"][0]["b64_json"]
                image_data = base64.b64decode(b64_data)
                output_path = OUTPUT_DIR / f"{output_name}.png"
                with open(output_path, "wb") as f:
                    f.write(image_data)
                print(f"  [OK] 背景图保存到: {output_path} ({len(image_data)/1024:.1f} KB)")
                return output_path
            else:
                print(f"  [ERROR] API返回格式错误: {json.dumps(result, ensure_ascii=False)[:200]}")
                return None
    except Exception as e:
        print(f"  [ERROR] 生成失败: {e}")
        return None

# ── HTML preview ───────────────────────────────────────────────────────────

def color_to_css(rgb: list[float]) -> str:
    r, g, b = [int(c * 255) for c in rgb]
    return f"rgb({r},{g},{b})"


def generate_html_preview(style_result: dict, bg_path: Path | None) -> Path:
    """Generate a visual HTML preview of the style."""
    params = style_result["params"]
    style_name = style_result.get("styleName", "Unnamed Style")
    style_desc = style_result.get("styleDescription", "")
    bg_prompt = style_result.get("backgroundPrompt", "")

    # Color swatches
    swatches = [
        ("树干基色", params["trunkBaseColor"]),
        ("树干中色", params["trunkMidColor"]),
        ("树干梢色", params["trunkTipColor"]),
        ("叶子中色", params["leafMidColor"]),
        ("叶子亮色", params["leafLightColor"]),
        ("叶子暗色", params["leafDarkColor"]),
        ("天空顶色", params["skyTopColor"]),
        ("天空底色", params["skyBottomColor"]),
        ("地面色", params["groundColor"]),
        ("主光色", params["mainLightColor"]),
        ("环境光色", params["ambientLightColor"]),
        ("粒子色", params["particleColor"]),
        ("描边色", params["outlineColor"]),
    ]

    swatch_html = ""
    for name, rgb in swatches:
        css_color = color_to_css(rgb)
        swatch_html += f"""
        <div class="swatch-item">
            <div class="swatch-color" style="background:{css_color}"></div>
            <span class="swatch-label">{name}</span>
            <span class="swatch-value">{css_color}</span>
        </div>"""

    # Sky gradient preview
    sky_top = color_to_css(params["skyTopColor"])
    sky_bottom = color_to_css(params["skyBottomColor"])
    leaf_mid = color_to_css(params["leafMidColor"])

    # Background image section
    bg_section = ""
    if bg_path:
        import base64 as b64
        with open(bg_path, "rb") as f:
            bg_b64 = b64.b64encode(f.read()).decode()
        bg_section = f"""
        <div class="section">
            <h2>生成背景图 (gpt-image-2)</h2>
            <p class="prompt-text">Prompt: {bg_prompt}</p>
            <img class="bg-preview" src="data:image/png;base64,{bg_b64}" alt="Generated Background" />
        </div>"""

    html = f"""<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>树风格预览: {style_name}</title>
<style>
* {{ box-sizing:border-box; margin:0; padding:0; }}
body {{
    font-family: "Segoe UI","Helvetica Neue",Arial,sans-serif;
    background: {sky_bottom};
    color: #333;
    min-height: 100vh;
}}
.header {{
    background: linear-gradient(180deg, {sky_top} 0%, {sky_bottom} 100%);
    padding: 40px 24px 60px;
    text-align: center;
    position: relative;
}}
.header h1 {{ font-size:28px; color:#fff; text-shadow:0 2px 8px rgba(0,0,0,0.3); }}
.header .desc {{ color:rgba(255,255,255,0.85); margin-top:8px; font-size:14px; }}
.tree-mock {{
    width: 120px; height: 160px;
    margin: 24px auto 0;
    position: relative;
}}
.tree-trunk {{
    width: 16px; height: 60px;
    background: linear-gradient(180deg, {color_to_css(params['trunkTipColor'])} 0%, {color_to_css(params['trunkMidColor'])} 50%, {color_to_css(params['trunkBaseColor'])} 100%);
    margin: 0 auto; border-radius: 4px;
}}
.tree-crown {{
    width: 90px; height: 90px;
    background: radial-gradient(ellipse at 40% 35%, {color_to_css(params['leafLightColor'])} 0%, {color_to_css(params['leafMidColor'])} 40%, {color_to_css(params['leafDarkColor'])} 100%);
    border-radius: 50% 50% 45% 45%;
    margin: 0 auto -10px;
    box-shadow: 0 0 {params['bloomStrength']*200:.0f}px {params['bloomRadius']*20:.0f}px {leaf_mid};
}}
.content {{ max-width:800px; margin:0 auto; padding:24px; }}
.section {{ background:#fff; border-radius:12px; padding:20px; margin-bottom:20px; box-shadow:0 2px 12px rgba(0,0,0,0.08); }}
.section h2 {{ font-size:16px; margin-bottom:16px; color:#555; }}
.swatches {{ display:flex; flex-wrap:wrap; gap:12px; }}
.swatch-item {{
    display:flex; flex-direction:column; align-items:center; gap:4px;
    width: 80px;
}}
.swatch-color {{
    width:48px; height:48px; border-radius:10px;
    box-shadow: 0 2px 8px rgba(0,0,0,0.15);
}}
.swatch-label {{ font-size:11px; color:#777; text-align:center; }}
.swatch-value {{ font-size:10px; color:#aaa; font-family:monospace; }}
.params-grid {{ display:grid; grid-template-columns:repeat(auto-fill,minmax(180px,1fr)); gap:8px; }}
.param-item {{ font-size:12px; color:#666; }}
.param-item code {{ background:#f0f0f0; padding:1px 4px; border-radius:3px; font-size:11px; }}
.bg-preview {{ width:100%; border-radius:8px; margin-top:12px; }}
.prompt-text {{ font-size:13px; color:#888; margin-bottom:8px; font-style:italic; }}
</style>
</head>
<body>
<div class="header">
    <h1>{style_name}</h1>
    <p class="desc">{style_desc}</p>
    <div class="tree-mock">
        <div class="tree-crown"></div>
        <div class="tree-trunk"></div>
    </div>
</div>
<div class="content">
    <div class="section">
        <h2>色彩方案</h2>
        <div class="swatches">{swatch_html}
        </div>
    </div>
    <div class="section">
        <h2>关键参数</h2>
        <div class="params-grid">
            <div class="param-item">Bloom强度: <code>{params['bloomStrength']}</code></div>
            <div class="param-item">Bloom半径: <code>{params['bloomRadius']}</code></div>
            <div class="param-item">Bloom阈值: <code>{params['bloomThreshold']}</code></div>
            <div class="param-item">风力强度: <code>{params['windStrength']}</code></div>
            <div class="param-item">风力频率: <code>{params['windFrequency']}</code></div>
            <div class="param-item">主光强度: <code>{params['mainLightIntensity']}</code></div>
            <div class="param-item">环境光强度: <code>{params['ambientLightIntensity']}</code></div>
            <div class="param-item">叶子纹理: <code>{params['leafTextureIndex']}</code></div>
            <div class="param-item">描边宽度: <code>{params['outlineWidth']}</code></div>
        </div>
    </div>
    {bg_section}
    <div class="section">
        <h2>AI原始响应</h2>
        <pre style="font-size:11px;max-height:400px;overflow:auto;background:#f8f8f8;padding:12px;border-radius:8px;">{json.dumps(style_result, ensure_ascii=False, indent=2)}</pre>
    </div>
</div>
</body>
</html>"""

    html_path = OUTPUT_DIR / "style_preview.html"
    with open(html_path, "w", encoding="utf-8") as f:
        f.write(html)
    print(f"  [HTML] 预览页保存到: {html_path}")
    return html_path

# ── Main ───────────────────────────────────────────────────────────────────

def main():
    # Read LLM_KEY from env or backend/.env
    dsk = os.environ.get("LLM_API_KEY", "")
    if not dsk:
        env_path = PROJECT_ROOT / "backend" / ".env"
        if env_path.exists():
            for line in open(env_path):
                if line.startswith("LLM_API_KEY="):
                    dsk = line.strip().split("=", 1)[1].strip('"')
                    break
    if not dsk:
        print("ERROR: LLM_API_KEY not found. Set it in environment or backend/.env")
        sys.exit(1)
    os.environ["LLM_API_KEY"] = dsk

    # Determine user
    user_id = sys.argv[1] if len(sys.argv) > 1 else None
    if not user_id:
        users = list_users()
        # Pick first user with >0 nodes
        import sqlite3
        conn = sqlite3.connect(str(DB_PATH))
        for u in users:
            count = conn.execute(
                "SELECT COUNT(*) FROM nodes WHERE owner_id=? AND is_deleted=0",
                (u["id"],),
            ).fetchone()[0]
            if count >= 3:
                user_id = u["id"]
                print(f"使用用户: {u['username']} ({u['id']}) — {count} 个知识节点")
                break
        conn.close()

    if not user_id:
        print("ERROR: 找不到有知识节点的用户")
        sys.exit(1)

    # Step 1: Get user knowledge
    nodes = get_user_nodes(user_id)
    print(f"\n共 {len(nodes)} 个知识节点:")
    for n in nodes:
        content_preview = (n["content"] or "")[:60]
        print(f"  [{n.get('domain_tag','?')}] {n['name']}" + (f" — {content_preview}..." if content_preview else ""))

    # Step 2: Generate style via DeepSeek
    print("\n── Step 1: DeepSeek 风格生成 ──")
    profile = build_user_profile(nodes)
    try:
        style_result = call_deepseek_for_style(profile)
    except Exception as e:
        print(f"  [FATAL] DeepSeek调用失败: {e}")
        sys.exit(1)

    print(f"  风格名称: {style_result.get('styleName', '?')}")
    print(f"  风格描述: {style_result.get('styleDescription', '?')}")
    print(f"  背景Prompt: {style_result.get('backgroundPrompt', '?')}")

    # Validate params
    params = style_result.get("params", {})
    issues = validate_params(params)
    if issues:
        print(f"  [WARN] 参数校验发现问题 ({len(issues)}):")
        for i in issues[:5]:
            print(f"    - {i}")
    else:
        print(f"  [OK] 参数校验通过")

    # Step 3: Generate background via gpt-image-2
    print("\n── Step 2: gpt-image-2 背景生成 ──")
    bg_prompt = style_result.get("backgroundPrompt", "")
    if bg_prompt:
        bg_path = generate_background(bg_prompt, "ai_generated_bg")
    else:
        print("  [SKIP] 无背景描述，跳过图片生成")
        bg_path = None

    # Step 4: Generate HTML preview
    print("\n── Step 3: HTML预览生成 ──")
    html_path = generate_html_preview(style_result, bg_path)

    # Save JSON for reference
    json_path = OUTPUT_DIR / "style_result.json"
    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(style_result, f, ensure_ascii=False, indent=2)
    print(f"  [JSON] 完整结果保存到: {json_path}")

    print(f"\n{'='*60}")
    print(f"Demo 完成！在浏览器中打开:")
    print(f"  file:///{html_path.as_posix()}")
    print(f"{'='*60}")


if __name__ == "__main__":
    main()

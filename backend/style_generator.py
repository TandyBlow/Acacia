"""
AI-powered tree style generator.
Analyzes user knowledge content via DeepSeek and generates
unique TreeStyleParams that visually represent the knowledge landscape.

Pattern follows concept_extractor.py.
"""
import base64
import hashlib
import json as _json
import os
import re
import time
from pathlib import Path
from typing import Any

import httpx

# ── Cache ────────────────────────────────────────────────────────────────

_style_cache: dict[str, dict] = {}
_cache_ttl: float = 3600.0  # 1 hour

# Background image cache: maps cache_key -> backgroundUrl
_bg_image_cache: dict[str, str] = {}

# Per-user generation state: owner_id -> {"hash": str, "generated_at": float}
_user_state: dict[str, dict] = {}
_MIN_REGENERATE_INTERVAL: float = 300.0  # 5 min cooldown between AI generations

# Project root and output paths
_PROJECT_ROOT = Path(__file__).parent.parent
_REFERENCE_IMAGE = _PROJECT_ROOT / "background.png"
_BG_OUTPUT_DIR = _PROJECT_ROOT / "frontend" / "public" / "backgrounds" / "ai"
_GENERATING_LOCK_TTL: float = 600.0  # 10 min — stale locks are ignored


def _is_generating(owner_id: str) -> bool:
    """Check if a generation is currently in progress (lock file exists and is fresh)."""
    lock_file = _BG_OUTPUT_DIR / f"{owner_id}.generating"
    if not lock_file.exists():
        return False
    try:
        data = _json.loads(lock_file.read_text())
        started_at = data.get("started_at", 0)
        if time.time() - started_at > _GENERATING_LOCK_TTL:
            try:
                lock_file.unlink()
            except FileNotFoundError:
                pass
            return False
        return True
    except Exception:
        try:
            lock_file.unlink()
        except FileNotFoundError:
            pass
        return False


def _acquire_generation_lock(owner_id: str) -> bool:
    """Try to acquire the generation lock. Returns False if already locked."""
    if _is_generating(owner_id):
        return False
    _BG_OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    lock_file = _BG_OUTPUT_DIR / f"{owner_id}.generating"
    lock_file.write_text(_json.dumps({"started_at": time.time()}))
    return True


def _release_generation_lock(owner_id: str):
    """Release the generation lock."""
    lock_file = _BG_OUTPUT_DIR / f"{owner_id}.generating"
    try:
        lock_file.unlink()
    except FileNotFoundError:
        pass


def _cache_key(nodes_json: str) -> str:
    return hashlib.sha256(nodes_json.encode("utf-8")).hexdigest()


def _should_regenerate(owner_id: str, nodes: list[dict]) -> bool:
    """Check whether style should be regenerated for this user.

    Returns False if: node count < 10, content unchanged (same hash),
    or within cooldown period. Returns True otherwise and updates state.
    """
    if len(nodes) < 10:
        return False

    profile_parts = []
    for n in nodes:
        name = n.get("name", "")
        content = (n.get("content") or "")[:200]
        profile_parts.append(f"{name}:{content}")
    profile_text = "|".join(sorted(profile_parts))
    current_hash = _cache_key(profile_text)

    state = _user_state.get(owner_id)
    if state and state["hash"] == current_hash:
        return False  # Content unchanged

    now = time.time()
    if state and (now - state["generated_at"]) < _MIN_REGENERATE_INTERVAL:
        return False  # Within cooldown

    _user_state[owner_id] = {"hash": current_hash, "generated_at": now}
    return True


# ── Prompt ───────────────────────────────────────────────────────────────

STYLE_SYSTEM_PROMPT = """你是一位视觉设计AI。根据用户的知识库内容，感知其学习气质与情感温度，创造性地设计一套完整的树渲染视觉参数。

## 核心设计哲学

你不是在忠实地"翻译"知识点——你是在为这位学习者创造一个他们愿意沉浸其中的视觉世界。

1. **情感温度优先于主题标签**：不要机械地将"日本文化→粉色"、"编程→霓虹"。感受这个人的知识世界散发出的气质——是沉静的、热烈的、神秘的、还是理性的？用色彩来表达这种气质。

2. **大胆融合，敢于创造**：当用户的知识跨越多个领域时，创造第三种美学——不是A+B并列，而是A和B在更高维度上融合出的新世界。

3. **背景Prompt的空间视角约束**：底图是开放的户外视角（天空-地平线-地面），你的描述必须保持这个视角。

   **可以描述的场景类型：**
   - 自然风光：田野、山峦、海岸、沙漠、森林边缘
   - 城市外景：街道、广场、天际线、建筑外观、都市夜景
   - 抽象空间：数字网格、星云、能量场（只要保持天空-地面的空间感）
   - 庭院/园林：日式庭院、欧式花园（开放空间，能看到天空）

   **禁止描述的场景类型：**
   - 室内空间：图书馆内部、房间内、大厅内、教堂内部、洞穴内
   - 封闭视角：任何"从室内向外看"或"在建筑物内部"的描述

   **关键原则：如果你想表达"古典学术"气质，描述"古典大学校园外景"而不是"图书馆内部"；如果想表达"神秘"气质，描述"迷雾笼罩的古堡外观"而不是"城堡大厅内部"。**

   ✅ 正确："黄昏时分，天空从橙金渐变到淡紫，远山笼罩在暖色薄雾中，地面呈现干燥的赭石色调"
   ✅ 正确："赛博朋克都市，天空是深邃的数字蓝，远处高楼霓虹闪烁，街道反射着雨后光泽"
   ✅ 正确："欧式古典校园，远处哥特式钟楼尖顶，石板路，秋日金黄落叶，天空暖灰"
   ❌ 错误："温暖的古典图书馆内部，哥特式窗户，书架林立"（室内视角，会完全改变构图）

4. **风格名称要有诗意**。
5. **叶子色和文字色分别设计**：叶子是3D树冠的颜色，文字是界面UI的颜色——两者服务于不同的视觉目的，需要独立设计。
   - `leafMidColor/leafLightColor/leafDarkColor`：树冠叶片的着色，应与树干、天空协调，融入整体画面氛围。
   - `textPrimaryColor/textHintColor`：界面文字的主色和辅助色，必须在天空背景上清晰可读——亮背景配暗文字，暗背景配亮文字。

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
    "textPrimaryColor": [R,G,B], "textHintColor": [R,G,B],
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

# ── Default params (fallback) ──────────────────────────────────────────

DEFAULT_PARAMS: dict[str, Any] = {
    "trunkBaseColor": [0.35, 0.20, 0.10],
    "trunkMidColor": [0.55, 0.35, 0.18],
    "trunkTipColor": [0.35, 0.45, 0.25],
    "leafMidColor": [0.20, 0.60, 0.40],
    "leafLightColor": [0.52, 0.77, 0.32],
    "leafDarkColor": [0.05, 0.36, 0.49],
    "textPrimaryColor": [0.40, 0.50, 1.00],
    "textHintColor": [0.40, 1.00, 0.90],
    "leafShadowSize": -0.25, "leafShadowSoftness": 1.0,
    "leafHighlightSize": -0.25, "leafHighlightSoftness": 1.0,
    "leafAlphaClipping": 0.5, "leafTextureIndex": 0,
    "windStrength": 0.3, "windFrequency": 0.4, "windScale": 0.5,
    "skyTopColor": [0.53, 0.81, 0.92],
    "skyBottomColor": [0.96, 0.94, 0.92],
    "groundColor": [0.36, 0.23, 0.12], "groundUndulation": 0.3,
    "particleColor": [0.4, 0.8, 0.25], "particleShape": 0,
    "particleSpeed": 0.4, "particleDirection": 1,
    "particleSpawnRate": 8, "particleSize": 1.0,
    "mainLightColor": [1.0, 0.95, 0.85], "mainLightIntensity": 2.5,
    "ambientLightColor": [0.6, 0.65, 0.55], "ambientLightIntensity": 0.5,
    "bloomStrength": 0.075, "bloomRadius": 0.4, "bloomThreshold": 0.7,
    "outlineColor": [0.17, 0.10, 0.05], "outlineWidth": 0.3,
    "bgCamY": 2.8, "bgCamPitch": -0.2, "bgCamZ": -5.0, "bgFovZoom": 2.0,
    "bgGroundY": -2.0, "bgHillFreq": 0.3, "bgHillAmp": 5.0,
    "bgHillDepth": 40.0, "bgBldgDepth": 40.0, "bgBuildingDensity": 0.5,
    "bgBuildingHeight": 4.0, "bgFogDistance": 60.0, "bgBarrelK": 0.3,
    "bgPlatformHeight": 0.12, "bgPlatformFade": 0.03, "bgPlatformTexWidth": 1536.0,
}

REQUIRED_COLOR_KEYS = [
    "trunkBaseColor", "trunkMidColor", "trunkTipColor",
    "leafMidColor", "leafLightColor", "leafDarkColor",
    "textPrimaryColor", "textHintColor",
    "skyTopColor", "skyBottomColor", "groundColor",
    "particleColor", "mainLightColor", "ambientLightColor", "outlineColor",
]

REQUIRED_SCALAR_KEYS = [
    "leafShadowSize", "leafShadowSoftness", "leafHighlightSize",
    "leafHighlightSoftness", "leafAlphaClipping", "leafTextureIndex",
    "windStrength", "windFrequency", "windScale",
    "groundUndulation", "particleShape", "particleSpeed",
    "particleDirection", "particleSpawnRate", "particleSize",
    "mainLightIntensity", "ambientLightIntensity",
    "bloomStrength", "bloomRadius", "bloomThreshold",
    "outlineWidth",
    "bgCamY", "bgCamPitch", "bgCamZ", "bgFovZoom",
    "bgGroundY", "bgHillFreq", "bgHillAmp", "bgHillDepth",
    "bgBldgDepth", "bgBuildingDensity", "bgBuildingHeight",
    "bgFogDistance", "bgBarrelK", "bgPlatformHeight",
    "bgPlatformFade", "bgPlatformTexWidth",
]

# WCAG 2.1 minimum contrast ratio for normal text (AA level)
_MIN_CONTRAST_RATIO = 4.5


def _linearize(c: float) -> float:
    """Convert sRGB channel value to linear for luminance calculation."""
    if c <= 0.04045:
        return c / 12.92
    return ((c + 0.055) / 1.055) ** 2.4


def _relative_luminance(rgb: list[float]) -> float:
    """WCAG 2.1 relative luminance from sRGB [R,G,B] in 0.0-1.0 range."""
    return 0.2126 * _linearize(rgb[0]) + 0.7152 * _linearize(rgb[1]) + 0.0722 * _linearize(rgb[2])


def _contrast_ratio(lum1: float, lum2: float) -> float:
    """WCAG contrast ratio between two relative luminance values."""
    lighter = max(lum1, lum2)
    darker = min(lum1, lum2)
    return (lighter + 0.05) / (darker + 0.05)


def _fix_contrast(text_rgb: list[float], bg_lum: float) -> list[float]:
    """Adjust text color to meet minimum contrast against background luminance.

    Tries both lightening and darkening directions and picks the one that
    achieves better contrast while requiring less adjustment.
    """
    text_lum = _relative_luminance(text_rgb)
    if _contrast_ratio(text_lum, bg_lum) >= _MIN_CONTRAST_RATIO:
        return text_rgb  # Already sufficient

    def _search(target: list[float]) -> list[float]:
        lo, hi = 0.0, 1.0
        best = text_rgb
        for _ in range(12):
            mid = (lo + hi) / 2.0
            blended = [
                text_rgb[0] + (target[0] - text_rgb[0]) * mid,
                text_rgb[1] + (target[1] - text_rgb[1]) * mid,
                text_rgb[2] + (target[2] - text_rgb[2]) * mid,
            ]
            if _contrast_ratio(_relative_luminance(blended), bg_lum) >= _MIN_CONTRAST_RATIO:
                best = blended
                hi = mid
            else:
                lo = mid
        return best

    # Try both directions, pick the one with better contrast
    light_result = _search([1.0, 1.0, 1.0])
    dark_result = _search([0.0, 0.0, 0.0])

    light_ratio = _contrast_ratio(_relative_luminance(light_result), bg_lum)
    dark_ratio = _contrast_ratio(_relative_luminance(dark_result), bg_lum)

    winner = light_result if light_ratio >= dark_ratio else dark_result
    return [round(v, 4) for v in winner]


# ── Internal helpers ──────────────────────────────────────────────────────

def _call_deepseek(messages: list) -> str:
    api_key = os.getenv("DEEPSEEK_API_KEY")
    if not api_key:
        raise RuntimeError("DEEPSEEK_API_KEY not set")

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    payload = {
        "model": "deepseek-chat",
        "messages": messages,
        "temperature": 0.8,
        "max_tokens": 4096,
    }

    with httpx.Client(timeout=60.0) as client:
        resp = client.post(
            "https://api.deepseek.com/v1/chat/completions",
            headers=headers,
            json=payload,
        )
        resp.raise_for_status()

    data = resp.json()
    return data["choices"][0]["message"]["content"]


def _parse_json(raw: str) -> dict:
    """Parse JSON from LLM response, handling preambles and markdown fences."""
    raw = raw.strip()
    # Find JSON object boundaries (handle text before/after JSON)
    start = raw.find('{')
    end = raw.rfind('}')
    if start != -1 and end != -1 and end > start:
        raw = raw[start:end + 1]
    # Strip markdown code fences
    raw = raw.strip()
    if raw.startswith("```"):
        raw = re.sub(r"^```(?:json)?\s*", "", raw)
        raw = re.sub(r"\s*```$", "", raw)
    return _json.loads(raw)


def _validate_params(params: dict) -> dict:
    """Validate and fix generated params. Returns cleaned params dict."""
    cleaned = {}
    for key in REQUIRED_COLOR_KEYS:
        val = params.get(key)
        if isinstance(val, list) and len(val) == 3 and all(isinstance(v, (int, float)) for v in val):
            cleaned[key] = [max(0.0, min(1.0, float(v))) for v in val]
        else:
            cleaned[key] = DEFAULT_PARAMS[key][:]

    for key in REQUIRED_SCALAR_KEYS:
        val = params.get(key)
        if isinstance(val, (int, float)):
            cleaned[key] = float(val)
        else:
            cleaned[key] = DEFAULT_PARAMS[key]

    # Ensure text colors have sufficient contrast against background
    sky_lum = (_relative_luminance(cleaned["skyTopColor"]) + _relative_luminance(cleaned["skyBottomColor"])) / 2.0
    cleaned["textPrimaryColor"] = _fix_contrast(cleaned["textPrimaryColor"], sky_lum)
    cleaned["textHintColor"] = _fix_contrast(cleaned["textHintColor"], sky_lum)

    return cleaned


# ── Background image generation ──────────────────────────────────────────

def _generate_background_image(background_prompt: str, owner_id: str, force: bool = False) -> str | None:
    """Generate a styled background image via gpt-image-2 image editing API.

    Uses the reference background.png as base image and applies the style
    prompt to create a unique background. Result is cached by owner_id.

    Args:
        background_prompt: Style description for the background.
        owner_id: User ID for cache key.
        force: If True, regenerate even if cached file exists.

    Returns URL path like /backgrounds/ai/{owner_id}.png, or None on failure.
    """
    api_key = os.getenv("IMAGE_API_KEY")
    api_url = os.getenv("IMAGE_API_URL", "https://ai.centos.hk/v1/images/edits")
    model = os.getenv("IMAGE_MODEL", "gpt-image-2")

    if not api_key:
        print("[style] IMAGE_API_KEY not set, skipping background generation")
        return None

    if not background_prompt:
        print("[style] No backgroundPrompt, skipping background generation")
        return None

    output_path = _BG_OUTPUT_DIR / f"{owner_id}.png"

    # Skip if already generated for this user (unless force=True)
    if not force and output_path.exists():
        print(f"[style] Background image already exists: {output_path}")
        return f"/backgrounds/ai/{owner_id}.png"

    if not _REFERENCE_IMAGE.exists():
        print(f"[style] Reference image not found: {_REFERENCE_IMAGE}")
        return None

    _BG_OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    headers = {"Authorization": f"Bearer {api_key}"}
    full_prompt = f"保持完全相同的构图和结构，改变为{background_prompt}"

    try:
        image_bytes = open(_REFERENCE_IMAGE, "rb").read()
        files = {"image": ("reference.png", image_bytes, "image/png")}
        data = {
            "model": model,
            "prompt": full_prompt,
            "size": "1536x1024",
            "n": "1",
        }

        print(f"[style] Calling gpt-image-2 for {owner_id}: {background_prompt[:80]}...")
        with httpx.Client(timeout=300.0) as client:
            resp = client.post(api_url, headers=headers, files=files, data=data)
            if resp.status_code != 200:
                print(f"[style] gpt-image-2 error {resp.status_code}: {resp.text[:200]}")
                return None

            result = resp.json()
            if "data" in result and len(result["data"]) > 0:
                b64_data = result["data"][0]["b64_json"]
                image_data = base64.b64decode(b64_data)
                with open(output_path, "wb") as f:
                    f.write(image_data)
                print(f"[style] Background image saved: {output_path} ({len(image_data)/1024:.1f} KB)")
                return f"/backgrounds/ai/{owner_id}.png"
            else:
                print(f"[style] gpt-image-2 unexpected response: {str(result)[:200]}")
                return None
    except Exception as e:
        print(f"[style] Background generation failed: {e}")
        return None


# ── Public API ────────────────────────────────────────────────────────────

def generate_style(owner_id: str, nodes: list[dict], force: bool = False) -> dict:
    """Generate a unique visual style for a user's knowledge tree.

    Args:
        owner_id: The user's ID (used for cache key).
        nodes: List of node dicts with 'name' and 'content' keys.
        force: If True, bypass cache and regenerate.

    Returns:
        {"style": "styleName", "params": {...}, "backgroundPrompt": "...",
         "distribution": {...}}

    IMPORTANT: This function blocks until background image generation completes.
    The returned style is fully ready to apply (params + background image).
    """
    # If another request is already generating for this user, tell the client to poll
    if _is_generating(owner_id):
        return {"generating": True}

    if not nodes:
        return {
            "style": "default",
            "params": DEFAULT_PARAMS,
            "backgroundPrompt": "",
            "backgroundUrl": None,
            "distribution": {},
        }

    # Require at least 10 nodes for meaningful AI style generation
    if len(nodes) < 10:
        return {
            "style": "default",
            "params": DEFAULT_PARAMS,
            "backgroundPrompt": "",
            "backgroundUrl": None,
            "distribution": {},
        }

    # Build profile text for cache key and prompt
    profile_parts = []
    for n in nodes:
        name = n.get("name", "")
        content = (n.get("content") or "")[:200]
        profile_parts.append(f"{name}:{content}")
    profile_text = "|".join(sorted(profile_parts))

    # Check cache
    cache_key = _cache_key(profile_text)
    if not force:
        cached = _style_cache.get(cache_key)
        if cached and (time.time() - cached.get("_cached_at", 0)) < _cache_ttl:
            # Ensure backgroundUrl is populated (may be None if bg gen failed previously)
            if cached.get("backgroundUrl") is None:
                cached["backgroundUrl"] = _bg_image_cache.get(cache_key)
                # Last resort: check disk in case server restarted and cache lost
                if cached["backgroundUrl"] is None:
                    image_path = _BG_OUTPUT_DIR / f"{owner_id}.png"
                    if image_path.exists():
                        cached["backgroundUrl"] = f"/backgrounds/ai/{owner_id}.png"
            return cached

    # Check if regeneration is warranted (cooldown + change detection)
    if not force and not _should_regenerate(owner_id, nodes):
        # Return cached result even if TTL expired, or fall back to default
        cached = _style_cache.get(cache_key)
        if cached:
            if cached.get("backgroundUrl") is None:
                cached["backgroundUrl"] = _bg_image_cache.get(cache_key)
            return cached
        # Cache miss: image may exist on disk from an interrupted previous request.
        # Recover it so the user doesn't lose a successfully generated background.
        image_path = _BG_OUTPUT_DIR / f"{owner_id}.png"
        if image_path.exists():
            print(f"[style] Recovering background image from disk for {owner_id}")
            recovered = {
                "style": "default",
                "params": DEFAULT_PARAMS,
                "backgroundPrompt": "",
                "backgroundUrl": f"/backgrounds/ai/{owner_id}.png",
                "distribution": {},
                "_cached_at": time.time(),
            }
            _style_cache[cache_key] = recovered
            return recovered
        return {
            "style": "default",
            "params": DEFAULT_PARAMS,
            "backgroundPrompt": "",
            "backgroundUrl": None,
            "distribution": {},
        }

    # Build user prompt
    user_lines = []
    for n in nodes:
        name = n.get("name", "")
        content = (n.get("content") or "")[:300]
        if content:
            user_lines.append(f"- {name}: {content}")
        else:
            user_lines.append(f"- {name}")
    user_prompt = "以下是一个学习者的知识库内容，请分析其知识世界的气质与情感温度，生成匹配的视觉风格参数：\n\n" + "\n".join(user_lines)

    # Compute domain distribution for backward compat
    domain_counts: dict[str, int] = {}
    for n in nodes:
        tag = n.get("domain_tag") or "其他"
        domain_counts[tag] = domain_counts.get(tag, 0) + 1
    total = len(nodes)
    distribution = {tag: round(cnt / total, 4) for tag, cnt in domain_counts.items()}

    # Acquire generation lock so concurrent requests poll instead of racing
    if not _acquire_generation_lock(owner_id):
        return {"generating": True}

    try:
        # Call DeepSeek
        print(f"[style] Generating style for {owner_id} with {len(nodes)} nodes...")
        try:
            raw = _call_deepseek([
                {"role": "system", "content": STYLE_SYSTEM_PROMPT},
                {"role": "user", "content": user_prompt},
            ])
            result = _parse_json(raw)
            print(f"[style] DeepSeek returned style: {result.get('styleName', 'unknown')}")
        except Exception as e:
            print(f"[style] DeepSeek call failed: {e}")
            # Fallback to default
            return {
                "style": "default",
                "params": DEFAULT_PARAMS,
                "backgroundPrompt": "",
                "backgroundUrl": None,
                "distribution": distribution,
            }

        style_name = result.get("styleName", "default")
        description = result.get("styleDescription", "")
        background_prompt = result.get("backgroundPrompt", "")
        params = _validate_params(result.get("params", {}))

        # Generate background image via gpt-image-2 (BLOCKS until complete)
        print(f"[style] Generating background image for {owner_id} (force={force})...")
        background_url = _generate_background_image(background_prompt, owner_id, force=force)
        if background_url:
            print(f"[style] Background image ready: {background_url}")
        else:
            print(f"[style] Background image generation failed or skipped")
        _bg_image_cache[cache_key] = background_url

        output = {
            "style": style_name,
            "styleDescription": description,
            "params": params,
            "backgroundPrompt": background_prompt,
            "backgroundUrl": background_url,
            "distribution": distribution,
            "_cached_at": time.time(),
        }

        _style_cache[cache_key] = output
        print(f"[style] Style generation complete for {owner_id}")
        return output
    finally:
        _release_generation_lock(owner_id)

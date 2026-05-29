#!/usr/bin/env python3
"""
Generate 100 unique tree visual styles + background images for the cinematic demo.

Reuses DeepSeek (params) and gpt-image-2 (backgrounds) from style_generator.py.
Supports checkpoint/resume and automatic retry with exponential backoff.

Usage:  python scripts/generate_100_styles.py
Output: frontend/public/demo_styles.json
        frontend/public/backgrounds/ai/demo_style_000.png ~ demo_style_099.png
Time:   ~40 minutes (100 x DeepSeek ~3s + 100 x gpt-image-2 ~20s)
"""

import json as _json
import os
import sys
import time
from pathlib import Path

PROJECT_ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(PROJECT_ROOT / "backend"))

# Load .env for API keys
env_path = PROJECT_ROOT / "backend" / ".env"
if env_path.exists():
    for line in open(env_path, encoding="utf-8"):
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            key, _, val = line.partition("=")
            os.environ.setdefault(key.strip(), val.strip())

from style_generator import (
    STYLE_SYSTEM_PROMPT,
    _call_deepseek,
    _parse_json,
    _validate_params,
    _generate_background_image,
)

OUTPUT_FILE = PROJECT_ROOT / "frontend" / "public" / "demo_styles.json"
MAX_RETRIES = 3

# ── 100 aesthetic personas ──────────────────────────────────────────────────

PERSONAS = [
    # Row 1: 冷色调系
    {"name": "赛博朋克霓虹", "vibe": "黑暗城市夜空下霓虹灯闪烁，电光紫与青色交织，高对比冷峻未来感"},
    {"name": "深海寂静", "vibe": "深海蓝与墨绿，幽暗静谧，偶有生物荧光闪烁，神秘而孤独"},
    {"name": "冰川极光", "vibe": "冰岛极夜，深蓝到翠绿的极光在天空流动，地面白雪覆盖，清冷纯净"},
    {"name": "雨夜都市", "vibe": "雨夜东京街头，深蓝灰色调，霓虹倒映在湿漉漉的柏油路上，孤独浪漫"},
    {"name": "太空星云", "vibe": "猎户座星云色彩，深紫与品红交织，星光点点，宇宙深邃无边"},
    {"name": "北欧极简", "vibe": "灰白基调，淡木色家具，冷峻克制，低饱和，留白大量，呼吸感"},
    {"name": "蓝调爵士", "vibe": "午夜爵士酒吧，深蓝与琥珀色灯光，烟雾缭绕，慵懒而精致"},
    {"name": "水墨江南", "vibe": "黑白灰的水墨画意境，淡墨晕染，留白诗意，偶有青蓝点缀"},
    {"name": "荧光深海", "vibe": "深海热泉生态，黑底上荧光蓝、荧光绿生物发光，奇异而瑰丽"},
    {"name": "冷翡翠", "vibe": "极品翡翠的冰种质感，冰蓝绿到翠绿渐变，透亮清冷，贵气内敛"},
    {"name": "暴风雪", "vibe": "暴风雪中的山脉，纯白到浅灰蓝，凌厉而壮美，天地苍茫"},
    {"name": "暮光之城", "vibe": "吸血鬼题材的蓝灰冷调，哥特建筑剪影，银色月光，阴郁优雅"},
    {"name": "电子音乐", "vibe": "电子音乐节现场，暗场中激光蓝紫光束，低频震动感，数字化的节奏"},
    {"name": "潜意识的湖", "vibe": "心理学意义上的深邃湖水，墨蓝到近乎黑色，表面平静下有暗流"},
    {"name": "蓝钢淬火", "vibe": "金属热处理后的蓝钢色，深蓝灰带金属光泽，工业精密感"},
    {"name": "蓝花楹", "vibe": "盛开的蓝花楹树，蓝紫色花海铺满地面，梦幻浪漫"},
    {"name": "午夜图书馆", "vibe": "深夜私人图书馆，深木色、皮革棕、青铜台灯暖光，知识的神圣感"},
    {"name": "冬季苔原", "vibe": "西伯利亚冬季苔原，苍白到浅灰蓝，地衣的暗绿点缀，辽阔寂寥"},
    {"name": "青金石", "vibe": "阿富汗青金石的深蓝与金色黄铁矿斑点，古老贵族的奢华蓝"},
    {"name": "气象气球", "vibe": "高空平流层视角，深蓝到紫黑渐变，地球边缘的淡蓝弧线，科学探索感"},

    # Row 2: 暖色调系
    {"name": "敦煌暖沙", "vibe": "大漠敦煌壁画色彩，暖赭石、朱砂红、金粉，古老神秘庄严，飞天飘带"},
    {"name": "秋日枫林", "vibe": "京都深秋，深红橙黄金色交织，温暖浓烈，落叶铺满石阶"},
    {"name": "日式侘寂", "vibe": "枯山水庭院，灰褐与苔绿，寂静朴素，光阴沉淀的痕迹"},
    {"name": "托斯卡纳", "vibe": "意大利托斯卡纳的黄昏，金色麦田、丝柏树、赭石色农舍，暖阳普照"},
    {"name": "铜绿锈迹", "vibe": "古老铜器表面的铜绿与锈红，时间氧化的色彩，厚重历史感"},
    {"name": "熔岩地", "vibe": "夏威夷火山熔岩，暗红到橙黄渐变，黑色玄武岩，原始地球的力量"},
    {"name": "藏红花", "vibe": "西藏僧袍的藏红与金黄，寺庙金顶，高原纯净蓝天，精神性的温暖"},
    {"name": "赤陶村落", "vibe": "摩洛哥赤陶土建筑群，暖橙与赭石，沙漠绿洲的椰枣绿点缀"},
    {"name": "威士忌", "vibe": "单一麦芽威士忌的琥珀色，橡木桶的暖棕，泥煤的烟熏灰，醇厚成熟"},
    {"name": "烤面包", "vibe": "手工面包房的暖调，焦糖色面包皮、奶油白、核桃棕，温暖治愈"},
    {"name": "沙漠玫瑰", "vibe": "撒哈拉沙漠玫瑰石，沙色到粉橙结晶，干燥而精致的美"},
    {"name": "柴烧陶器", "vibe": "柴烧窑变陶瓷，落灰釉的自然赭褐与焦黄，火焰留下的痕迹"},
    {"name": "波斯地毯", "vibe": "波斯手工地毯的深红、藏蓝、金色花纹交织，繁复而华丽"},
    {"name": "烤红薯", "vibe": "冬日烤红薯摊，焦糖化的橙黄内心，炭火的暗红，朴实温暖"},
    {"name": "琥珀昆虫", "vibe": "琥珀化石的金黄透明质感，包裹远古昆虫，时光凝固的美"},
    {"name": "铁锈", "vibe": "废弃工厂的锈红铁皮，斑驳剥落，工业衰败美学，粗砺质感"},
    {"name": "印度香料", "vibe": "印度香料市场的浓郁暖色，姜黄、辣椒红、肉桂棕、豆蔻绿，浓烈丰盛"},
    {"name": "皮革工坊", "vibe": "手工皮具工坊，深棕皮革、蜜色缝线、铜扣件，匠人精神的温度"},
    {"name": "落日峡谷", "vibe": "美国大峡谷日落，层层叠叠的红砂岩在斜阳下燃烧，壮丽苍茫"},
    {"name": "红糖姜茶", "vibe": "冬夜的红糖姜茶，琥珀色液体，温暖从内而外，治愈系暖调"},

    # Row 3: 绿色系
    {"name": "热带雨林", "vibe": "亚马逊雨林深处，浓郁翠绿，高饱和，湿润感，兰花的艳色点缀，生机盎然"},
    {"name": "竹林清风", "vibe": "中国竹林，不同层次的绿从嫩绿到墨绿，光影斑驳，风过竹叶沙沙"},
    {"name": "抹茶茶园", "vibe": "日本宇治茶园，整齐的鲜绿色茶垄，清澈蓝天，精致而宁静"},
    {"name": "祖母绿", "vibe": "哥伦比亚祖母绿宝石，深邃翠绿带蓝调，晶体内部的花园内含物"},
    {"name": "苔藓森林", "vibe": "温带雨林的苔藓地毯，各种绿从荧光绿到橄榄绿，柔软湿润"},
    {"name": "薄荷", "vibe": "薄荷叶的清凉绿意，白花点缀，清新爽利，夏日清晨的露水"},
    {"name": "翡翠", "vibe": "缅甸翡翠的温润绿意，略带到黄调，东方玉文化的内敛贵气"},
    {"name": "青苹果", "vibe": "青苹果的酸脆绿色，果肉的淡黄白，青春活力的酸涩甜美"},
    {"name": "橄榄园", "vibe": "地中海古老橄榄园，银绿色叶片，灰绿到墨绿，沧桑树干，和平的象征"},
    {"name": "蕨类", "vibe": "新西兰蕨类植物的螺旋嫩芽，从嫩绿到深绿的渐变，原始森林感"},
    {"name": "青蛙", "vibe": "热带雨林箭毒蛙，荧光绿配黑色斑点，大自然最鲜艳的警告色"},
    {"name": "绿松石", "vibe": "美国西南部绿松石的天蓝到蓝绿色，棕色母岩纹理，原住民手工艺"},
    {"name": "牛油果", "vibe": "牛油果从外皮的墨绿到果肉的黄绿渐变，奶油般的柔和质感"},
    {"name": "高山草甸", "vibe": "瑞士高山草甸，各色野花点缀的鲜绿草地，雪峰在远处，纯净明媚"},
    {"name": "柚子", "vibe": "日本柚子，黄绿色果皮，清新酸香，和风的淡雅绿调"},
    {"name": "绿萝", "vibe": "室内绿萝的瀑布绿叶，不同明度的绿，阳光透过叶片的半透明感"},
    {"name": "沼泽", "vibe": "路易斯安那沼泽，柏树从水面升起，灰绿的苔藓挂满枝头，神秘朦胧"},
    {"name": "青柠", "vibe": "青柠的酸爽明亮，黄绿到翠绿，加勒比海的热带活力"},
    {"name": "孔雀石", "vibe": "孔雀石的同心圆纹路，深浅绿交替，丝绒光泽，装饰艺术感"},
    {"name": "绿野仙踪", "vibe": "童话般的翡翠城，奇幻的绿色渐变，金色点缀，通往未知的冒险"},

    # Row 4: 紫色系 + 混合色调
    {"name": "薰衣草田", "vibe": "普罗旺斯薰衣草田，紫色花海延伸到天际，暖黄夕阳，蜂鸣声中的宁静"},
    {"name": "紫水晶洞", "vibe": "乌拉圭紫水晶洞，深紫到浅紫的晶簇，神秘能量感，几何之美"},
    {"name": "银河", "vibe": "银河系中心，深紫到品红的星云，金色星团，宇宙的壮丽尺度"},
    {"name": "紫藤瀑布", "vibe": "日本足利紫藤，淡紫到深紫的花穗如瀑布垂落，梦幻童话感"},
    {"name": "赛博樱花", "vibe": "赛博朋克都市中的发光樱花树，荧光粉紫与霓虹蓝交织，数字花瓣飘落"},
    {"name": "芋泥波波", "vibe": "芋泥奶茶的淡紫色，奶油白，甜美柔软，治愈系饮品美学"},
    {"name": "极光", "vibe": "挪威极光，翠绿到紫红的光幕在夜空中舞动，雪地反射，天地奇观"},
    {"name": "紫铜矿", "vibe": "斑铜矿的彩虹色，紫蓝绿金属光泽，大自然创造的抽象画"},
    {"name": "葡萄园", "vibe": "波尔多葡萄园的秋收，深紫色葡萄，金色阳光穿过叶片，醇厚丰美"},
    {"name": "鸢尾花", "vibe": "梵高笔下的鸢尾花，蓝紫色花瓣，亮黄花蕊，后印象派的强烈笔触"},
    {"name": "晚霞", "vibe": "热带海岛的壮丽晚霞，粉紫到橙红到金黄，云层如火燃烧"},
    {"name": "紫檀木", "vibe": "印度小叶紫檀的深紫红色，细密木纹，昂贵内敛的东方美学"},
    {"name": "暗物质", "vibe": "天体物理学概念的可视化，深紫到黑色，暗弱的光晕，未知的引力"},
    {"name": "独角兽", "vibe": "独角兽主题的马卡龙色，淡粉紫、淡蓝、淡金色，梦幻甜美"},
    {"name": "黑曜石", "vibe": "彩虹黑曜石的暗底上七彩光泽，深邃神秘，阿兹特克祭祀之镜"},
    {"name": "茄子", "vibe": "茄子的深紫黑色外皮，切开后奶油色果肉，菜园的新鲜色彩"},
    {"name": "紫禁城", "vibe": "故宫紫禁城的朱红城墙与金色琉璃瓦，蓝天映衬，皇权的庄严紫气"},
    {"name": "合成波", "vibe": "80年代合成波美学，霓虹粉紫配深蓝背景，网格线，复古未来主义"},
    {"name": "薰衣草冰沙", "vibe": "薰衣草味冰淇淋的淡紫色调，夏日清凉，南法度假风情"},
    {"name": "宇宙微波", "vibe": "宇宙微波背景辐射的均匀暗紫到深灰，大爆炸的余晖，宇宙最古老的光"},

    # Row 5: 明亮系 + 特殊色调
    {"name": "日出", "vibe": "山顶日出，从深蓝到粉红到橙金的全光谱渐变，黎明第一缕光"},
    {"name": "向日葵田", "vibe": "盛夏向日葵田，明黄花瓣配深棕花心，蓝天绿叶，梵高的狂热"},
    {"name": "柠檬", "vibe": "阿马尔菲柠檬的明黄，翠绿叶片，地中海的明媚阳光，酸爽清新"},
    {"name": "金阁寺", "vibe": "京都金阁寺的金箔倒映在池水中，深绿松树背景，禅意与奢华并存"},
    {"name": "蜂蜜", "vibe": "野蜂蜜的金琥珀色，蜂巢的六角形蜡质，金黄柔润，自然的甜美"},
    {"name": "沙漠", "vibe": "撒哈拉沙漠的沙丘曲线，金黄到橙黄，纯净的几何光影"},
    {"name": "波普艺术", "vibe": "安迪沃霍尔的波普色彩，高饱和撞色，明黄品红天蓝，大胆张扬"},
    {"name": "向日葵种子", "vibe": "向日葵花盘种子的斐波那契螺旋，自然的数学之美，金棕到深褐"},
    {"name": "蛋黄", "vibe": "流淌的溏心蛋黄，橙黄色浓郁流淌，早餐的温暖幸福感"},
    {"name": "霓虹黄", "vibe": "香港旺角霓虹招牌的荧光黄绿色，密集的广告牌，城市的脉动"},
    {"name": "金丝雀", "vibe": "金丝雀的明黄色羽毛，配以白色和淡灰，灵动活泼，阳光下的歌唱"},
    {"name": "丰收", "vibe": "秋收季节，金黄的稻穗、玉米、南瓜，大地丰盛的馈赠"},
    {"name": "萤火虫", "vibe": "夏夜森林中的萤火虫，点点黄绿荧光在黑暗中闪烁，魔法般的童话"},
    {"name": "郁金香", "vibe": "荷兰郁金香花田的条纹色带，红黄紫白平行排列，春天的几何"},
    {"name": "黄油", "vibe": "手工黄油的淡黄色，涂抹在烤面包上的光泽，浓郁奶香"},
    {"name": "日出城市", "vibe": "上海陆家嘴日出，金色阳光反射在玻璃幕墙摩天楼上，都市苏醒"},
    {"name": "彩色玻璃", "vibe": "哥特教堂的彩色玻璃花窗，红蓝绿金的光线透过，神圣的斑斓"},
    {"name": "卡布奇诺", "vibe": "卡布奇诺的咖啡棕与奶泡白纹理，肉桂粉点缀，早晨的温暖仪式"},
    {"name": "糖纸", "vibe": "半透明的彩色玻璃糖纸，透过阳光的彩色投影，童年的甜蜜记忆"},
    {"name": "极昼", "vibe": "北极圈极昼的午夜太阳，苍白到淡金到浅蓝，24小时的白昼，超现实"},
]


# ── Checkpoint helpers ──────────────────────────────────────────────────────

def load_checkpoint():
    done = set()
    results = []
    if OUTPUT_FILE.exists():
        try:
            with open(OUTPUT_FILE, "r", encoding="utf-8") as f:
                results = _json.load(f)
            done = {r["index"] for r in results}
        except Exception as e:
            print(f"[checkpoint] 读取失败，从头开始: {e}")
    return done, results


def save_checkpoint(results):
    tmp = str(OUTPUT_FILE) + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        _json.dump(results, f, ensure_ascii=False, indent=2)
    os.replace(tmp, str(OUTPUT_FILE))


# ── Single persona generation with retry ────────────────────────────────────

def generate_one(persona, index):
    for attempt in range(MAX_RETRIES):
        try:
            user_prompt = (
                f"请为一位学习者设计视觉风格。这位学习者的知识世界气质是：{persona['vibe']}。\n\n"
                f"请感受这种气质，创造匹配的完整视觉参数。背景画面保持户外开放视角（天空-地平线-地面）。"
            )

            # 1. DeepSeek → style params
            raw = _call_deepseek([
                {"role": "system", "content": STYLE_SYSTEM_PROMPT},
                {"role": "user", "content": user_prompt},
            ])
            result = _parse_json(raw)
            params = _validate_params(result.get("params", {}))
            bg_prompt = result.get("backgroundPrompt", persona["vibe"])

            # 2. gpt-image-2 → background image
            owner_id = f"demo_style_{index:03d}"
            bg_url, bg_error = _generate_background_image(bg_prompt, owner_id, force=True)

            if bg_error:
                print(f"  [warn] bg image generation had issue: {bg_error}")

            return {
                "index": index,
                "styleName": result.get("styleName", persona["name"]),
                "styleDescription": result.get("styleDescription", persona["vibe"]),
                "vibe": persona["vibe"],
                "params": params,
                "bgPath": bg_url,
            }

        except Exception as e:
            print(f"  [retry] attempt {attempt+1}/{MAX_RETRIES} failed: {e}")
            if attempt < MAX_RETRIES - 1:
                wait = 2 ** attempt
                print(f"  [retry] waiting {wait}s...")
                time.sleep(wait)

    return None


# ── Main ─────────────────────────────────────────────────────────────────────

def main():
    done_indices, results = load_checkpoint()
    print(f"断点续传: 已完成 {len(done_indices)}/100")
    if done_indices:
        print(f"  已完成索引: {sorted(done_indices)}")

    for i, persona in enumerate(PERSONAS):
        if i in done_indices:
            continue

        print(f"[{i+1:3d}/100] {persona['name']} — {persona['vibe'][:40]}...")
        entry = generate_one(persona, i)

        if entry:
            results.append(entry)
            save_checkpoint(results)
            print(f"  ✓ {entry['styleName']} | bg: {entry['bgPath'] or 'N/A'}")
        else:
            print(f"  ✗ 所有重试均失败，跳过")

        # Brief pause between requests to be kind to APIs
        time.sleep(0.5)

    print(f"\n{'='*60}")
    print(f"完成: {len(results)}/100 条")
    if len(results) < 100:
        print(f"缺失索引: {sorted(set(range(100)) - {r['index'] for r in results})}")
    print(f"输出: {OUTPUT_FILE}")


if __name__ == "__main__":
    main()

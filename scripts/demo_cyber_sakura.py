#!/usr/bin/env python3
"""Create a simulated user whose knowledge profile targets 'cyber-sakura' aesthetic."""
import sqlite3, uuid, subprocess, sys, shutil
from pathlib import Path

PROJECT_ROOT = Path(__file__).parent.parent
DB_PATH = PROJECT_ROOT / "backend" / "acacia.db"

CYBER_SAKURA_NODES = [
    # Japanese traditional aesthetics
    ("樱花文化符号学", "樱花在日本文化中象征物哀之美，短暂绽放后决绝凋零。从平安时代的和歌到现代的动漫游戏，樱花作为视觉母题贯穿千年。染井吉野樱通过嫁接技术实现了全日本同步盛开，成为国家性的时间仪式。"),
    ("江户町屋建筑美学", "江户时代町屋采用木造轴组结构，深檐、格子窗、土藏造是典型特征。町屋的纵向空间利用和通庭设计体现了日本人对狭小空间的极致利用。京都祇园的花见小路至今保存完好的町屋群落。"),
    ("浮世绘与现代视觉文化", "浮世绘的平面构成、色彩平涂和留白技法深刻影响了从印象派到当代插画。葛饰北斋的构图被现代平面设计广泛引用，歌川广重的雨景系列启发了无数赛博朋克作品的雨夜城市场景。"),
    ("神道与泛灵论世界观", "神道教认为万物有灵，自然物、人造物皆可寄宿神明。这种泛灵论在赛博朋克语境下转化为技术物件的灵魂化——机械也有神，代码也能成佛。神社的鸟居就是现实与灵域的界限。"),

    # Cyberpunk / sci-fi / future tech
    ("赛博朋克美学体系", "赛博朋克源于1980年代的科幻文学，威廉吉布森的《神经漫游者》奠定了高科技低生活的核心主题。视觉上以霓虹灯光、巨构建筑、义体改造和全息投影为标志，雨夜的东亚都市是最典型的空间场景。"),
    ("霓虹灯管与城市夜景", "霓虹灯通过稀有气体放电发光，不同气体产生不同颜色。东京新宿歌舞伎町和香港旺角的霓虹招牌密度曾是世界之最。赛博朋克美学中霓虹灯的视觉功能不仅是照明，更是信息过载和商品化的视觉隐喻。"),
    ("全息投影技术原理", "全息投影利用光的干涉和衍射记录并再现物体的三维图像。Pepper's Ghost是最早的伪全息技术，现代激光等离子体全息可在空气中直接成像。赛博朋克作品中的全息广告牌和AR界面是这一技术的未来想象。"),
    ("脑机接口与意识上传", "Neuralink等公司正在研发高带宽脑机接口，通过柔性电极阵列读取神经元信号。意识上传理论认为人脑的神经连接组可以被扫描并模拟在计算机中。赛博朋克中的义体化和数字永生是这些技术的终极形态。"),

    # The intersection: Japanese tradition meets cyberpunk
    ("银翼杀手中的亚洲想象", "《银翼杀手》的洛杉矶被想象为一个亚洲文化主导的未来都市，日语霓虹广告、中式面馆与哥特式建筑混杂。2019年的洛杉矶街景中巨大的艺伎全息广告是最标志性的赛博朋克视觉符号。"),
    ("攻壳机动队与日本未来观", "押井守的《攻壳机动队》以公元2029年的虚构日本都市新港为舞台，探讨义体化时代的人类本质。作品中的都市景观融合了香港九龙城寨的密集建筑、东京的霓虹街景和传统日式祭典的视觉元素。"),
    ("九龙城寨的建筑考古学", "九龙城寨曾是世界人口密度最高的区域，无政府状态下自发形成的垂直城市。它的管道交错、电线密布、招牌层叠的空间形态成为赛博朋克城市设计的原型。拆除前日本建筑师对其进行了详细的测绘研究。"),
    ("未来都市中的庭园传统", "枯山水用砂石表现山水，是一种极度抽象化的自然。这种抽象能力让日本庭园美学天然适配赛博朋克——虚拟现实中用像素和数据流重构龙安寺石庭，霓虹灯管取代竹篱成为枯山水的边界。"),
]

conn = sqlite3.connect(str(DB_PATH))
uid = str(uuid.uuid4())
conn.execute(
    "INSERT INTO users (id, username, password_hash, created_at) VALUES (?,?,?,datetime('now'))",
    (uid, "demo_cyber_sakura", "demo_hash"),
)
for i, (name, content) in enumerate(CYBER_SAKURA_NODES):
    nid = str(uuid.uuid4())
    conn.execute(
        "INSERT INTO nodes (id,owner_id,name,content,parent_id,sort_order,is_deleted) "
        "VALUES (?,?,?,?,NULL,?,0)",
        (nid, uid, name, content, i),
    )
conn.commit()
conn.close()
print(f"Created cyber-sakura user {uid} with {len(CYBER_SAKURA_NODES)} nodes")
print("  4x Japanese tradition, 4x Cyberpunk tech, 4x Intersection")

# Run demo
result = subprocess.run(
    [sys.executable, str(PROJECT_ROOT / "scripts" / "demo_tree_style.py"), uid],
    capture_output=False,
    timeout=300,
)

output_dir = PROJECT_ROOT / "scripts" / "demo_output"
for ext in ["html", "json"]:
    src = output_dir / f"style_preview.{ext}"
    dst = output_dir / f"style_preview_cyber_sakura.{ext}"
    if src.exists():
        shutil.copy(src, dst)
bg_src = output_dir / "ai_generated_bg.png"
bg_dst = output_dir / "ai_generated_bg_cyber_sakura.png"
if bg_src.exists():
    shutil.copy(bg_src, bg_dst)

print(f"\nPreview: file:///D:/others/Acacia/scripts/demo_output/style_preview_cyber_sakura.html")

#!/usr/bin/env python3
"""Create a mixed Japan culture + programming tech simulated user."""
import sqlite3, uuid, subprocess, sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).parent.parent
DB_PATH = PROJECT_ROOT / "backend" / "acacia.db"

MIXED_NODES = [
    # Japan culture
    ("樱花前线与气候", "日本气象厅每年发布樱花前线预报，从南到北追踪樱花盛开的时间线。染井吉野樱是最常见的品种，花期仅一周左右。樱花文化深刻影响了日本的文学、音乐和生活方式。"),
    ("浮世绘制作工艺", "浮世绘制作分为绘画、雕刻、印刷三道工序。绘画师绘制原画，雕刻师将画稿反刻在樱木板上，印刷师分层套印。葛饰北斋的富岳三十六景使用了普鲁士蓝颜料，是浮世绘技术的巅峰。"),
    ("茶道侘寂美学", "千利休确立的侘寂茶道追求简素、枯高、自然之美。二帖半茶室的狭小空间迫使主客以心传心。茶杓、茶枣、茶碗等茶具皆为精心挑选，有时一件茶碗传承数百年。"),
    ("武士道精神传统", "武士道起源于平安时代，融合了神道、佛教和儒家思想。义勇仁礼诚名誉忠是武士道的核心德目。新渡户稻造的武士道一书向西方世界介绍了这一精神传统。"),
    # Programming tech
    ("Python协程实现原理", "Python的asyncio基于事件循环实现协程调度。async def定义的协程函数返回coroutine对象，await暂停执行并将控制权交还给事件循环。核心优势是单线程内高效处理大量I/O密集任务。"),
    ("React Fiber架构设计", "React Fiber是React 16重构的协调引擎，将渲染工作分解为可中断的小单元。通过requestIdleCallback类似的调度机制实现时间切片，高优先级更新可以打断低优先级渲染。"),
    ("Redis分布式锁方案", "Redis实现分布式锁常用SETNX命令配合过期时间。Redlock算法由Redis作者提出，使用多个独立的Redis实例提高可靠性。锁续期机制防止业务执行超时导致锁被误释放。"),
    ("PostgreSQL查询优化", "PostgreSQL使用基于成本的优化器选择执行计划。ANALYZE命令收集表统计信息，包括n_distinct、most_common_vals等。Bitmap Index Scan结合了Index Scan和Sequential Scan的优点。"),
]

conn = sqlite3.connect(str(DB_PATH))
uid = str(uuid.uuid4())
conn.execute(
    "INSERT INTO users (id, username, password_hash, created_at) VALUES (?,?,?,datetime('now'))",
    (uid, "demo_japan_tech_mix", "demo_hash"),
)
for i, (name, content) in enumerate(MIXED_NODES):
    nid = str(uuid.uuid4())
    conn.execute(
        "INSERT INTO nodes (id,owner_id,name,content,parent_id,sort_order,is_deleted) "
        "VALUES (?,?,?,?,NULL,?,0)",
        (nid, uid, name, content, i),
    )
conn.commit()
conn.close()
print(f"Created user {uid} with {len(MIXED_NODES)} nodes (4 Japan + 4 Tech)")

# Run demo
result = subprocess.run(
    [sys.executable, str(PROJECT_ROOT / "scripts" / "demo_tree_style.py"), uid],
    capture_output=False,
    timeout=300,
)

# Copy output
import shutil
output_dir = PROJECT_ROOT / "scripts" / "demo_output"
for ext in ["html", "json"]:
    src = output_dir / f"style_preview.{ext}"
    dst = output_dir / f"style_preview_japan_tech_mix.{ext}"
    if src.exists():
        shutil.copy(src, dst)
bg_src = output_dir / "ai_generated_bg.png"
bg_dst = output_dir / "ai_generated_bg_japan_tech_mix.png"
if bg_src.exists():
    shutil.copy(bg_src, bg_dst)

print(f"\nPreview: file:///D:/others/Acacia/scripts/demo_output/style_preview_japan_tech_mix.html")

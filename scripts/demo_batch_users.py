#!/usr/bin/env python3
"""Create simulated users with different knowledge themes and run style demo for each."""
import sqlite3
import uuid
import subprocess
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).parent.parent
DB_PATH = PROJECT_ROOT / "backend" / "acacia.db"

# Simulated users with knowledge content
SIMULATED_USERS = {
    "python_dev": {
        "username": "demo_python_dev",
        "nodes": [
            ("Python异步编程", "asyncio是Python的异步I/O库，基于事件循环和协程实现。async/await语法让异步代码看起来像同步代码。协程是可暂停和恢复的函数，通过事件循环调度。"),
            ("React Hooks原理", "React Hooks是React 16.8引入的函数式组件状态管理方案。useState管理局部状态，useEffect处理副作用，useContext共享全局状态。Hooks必须在组件顶层调用，不能在条件语句中使用。"),
            ("Docker容器化部署", "Docker通过容器技术将应用及其依赖打包在一起，确保在不同环境中一致性运行。Dockerfile定义构建步骤，docker-compose管理多容器应用。容器与虚拟机的区别在于共享宿主机内核。"),
            ("Redis缓存策略", "Redis是内存中的键值存储数据库，常用作缓存层。LRU、LFU等淘汰策略控制内存使用。缓存穿透、缓存击穿、缓存雪崩是常见的缓存问题。"),
            ("Git分支管理", "Git Flow工作流定义master、develop、feature、release、hotfix等分支类型。分支策略帮助团队协作，避免代码冲突。rebase和merge各有适用场景。"),
            ("RESTful API设计", "REST架构风格基于资源的HTTP操作。GET查询、POST创建、PUT更新、DELETE删除。状态码语义化、版本控制、分页处理是API设计的关键要素。"),
            ("数据库索引优化", "B+树索引是数据库中最常用的索引结构。联合索引遵循最左前缀原则。EXPLAIN命令分析查询计划。慢查询日志帮助定位性能瓶颈。"),
        ]
    },
    "japan_culture": {
        "username": "demo_japan_culture",
        "nodes": [
            ("茶道精神", "日本茶道源自中国宋代点茶法，由千利休发展为'和敬清寂'的茶道精神。茶室布置、茶具选择、点茶动作皆有深意。一期一会强调当下的珍贵。"),
            ("浮世绘艺术", "浮世绘是江户时代的木版画艺术，描绘市井生活、歌舞伎演员、风景名胜。葛饰北斋的《神奈川冲浪里》和歌川广重的《东海道五十三次》是世界级名作。"),
            ("能乐与狂言", "能乐是日本最古老的戏剧形式之一，以面具和缓慢优雅的动作为特点。狂言则是穿插在能乐之间的喜剧小品。两者共同构成'能乐'这一综合艺术形式。"),
            ("禅宗美学", "禅宗从中国传入日本后深刻影响了日本美学。侘寂(wabi-sabi)欣赏不完美、无常和简素之美。枯山水庭园以砂石表现山水，是禅宗思想的园林化表达。"),
            ("和食文化", "和食被联合国教科文组织列为非物质文化遗产。'一汁三菜'是基本构成，强调季节感、摆盘美学和食材本味。出汁(昆布和鲣节熬制的高汤)是和食的灵魂。"),
            ("樱花文化", "樱花是日本最具代表性的文化符号。'花见'是赏樱的传统习俗，从平安时代贵族到现代大众。樱花短暂的花期象征生命的无常与美丽，深刻影响了日本的生死观。"),
            ("剑道武道", "剑道源自日本武士的剑术训练，现代发展为竞技和修身的武道。'气剑体一致'强调气势、剑术和身体的统一。竹刀、护具和'面、胴、小手、突'四种有效打击部位。"),
        ]
    },
    "natural_science": {
        "username": "demo_science",
        "nodes": [
            ("量子纠缠", "量子纠缠是量子力学中的非定域性现象。两个粒子的量子态相互关联，测量一个粒子会即时影响另一个粒子，无论距离多远。EPR悖论和贝尔不等式验证了量子纠缠的存在。"),
            ("CRISPR基因编辑", "CRISPR-Cas9是源自细菌免疫系统的基因编辑技术。sgRNA引导Cas9蛋白到目标DNA序列进行精确切割。基因编辑在疾病治疗、农业育种等领域有广泛应用前景。"),
            ("黑洞热力学", "霍金辐射理论表明黑洞并非完全黑，而是会以热辐射方式蒸发。黑洞具有温度和熵，其熵与视界面积成正比。这揭示了引力、量子力学和热力学之间的深刻联系。"),
            ("光合作用机制", "光合作用分为光反应和暗反应两个阶段。光反应在类囊体膜上进行，将光能转化为ATP和NADPH。暗反应(卡尔文循环)在叶绿体基质中固定CO2合成葡萄糖。"),
            ("大陆漂移学说", "魏格纳提出大陆漂移学说，后被板块构造理论完善。地壳由多个板块组成，板块运动导致地震、火山和造山运动。古生物化石分布和海底扩张是重要证据。"),
            ("神经网络基础", "人工神经网络受生物神经元启发。感知机是最简单的神经网络，多层感知机通过反向传播算法训练。激活函数(ReLU、Sigmoid、Tanh)引入非线性变换。"),
            ("元素周期律", "门捷列夫发现元素性质随原子量递增呈周期性变化。现代元素周期表按原子序数排列。周期表中同一族的元素具有相似的化学性质。新元素的合成拓展了周期表的边界。"),
        ]
    },
    "literature_art": {
        "username": "demo_literature",
        "nodes": [
            ("红楼梦叙事结构", "《红楼梦》以贾宝玉为中心，通过贾史王薛四大家族的兴衰展现清代社会全景。草蛇灰线、伏脉千里的叙事手法高超。太虚幻境的神话框架与现实叙事相互映照。"),
            ("印象派绘画革命", "莫奈、雷诺阿等印象派画家打破学院派传统，追求光影的瞬间印象。'印象·日出'为印象派命名。外光写生和点彩技法是重要创新。印象派对现代艺术产生了深远影响。"),
            ("莎士比亚悲剧艺术", "莎士比亚四大悲剧《哈姆雷特》《奥赛罗》《李尔王》《麦克白》探讨人性、权力、嫉妒和疯狂。独白技巧和双关语运用登峰造极。'生存还是毁灭'是最著名的独白。"),
            ("唐诗格律之美", "唐代诗歌是中国古典文学的高峰。律诗和绝句有严格的平仄和押韵规则。李白、杜甫、王维分别代表浪漫主义、现实主义和山水田园诗派的巅峰。"),
            ("爵士乐即兴精神", "爵士乐源于非裔美国人社区，以即兴演奏和切分节奏为特征。从新奥尔良爵士到比波普再到自由爵士，不断革新。Miles Davis的'Kind of Blue'是调式爵士的里程碑。"),
            ("后现代主义文学", "后现代主义质疑宏大叙事和绝对真理。元小说、碎片化叙事、拼贴技法是其常见特征。博尔赫斯、卡尔维诺、品钦等作家探索了小说形式的边界。"),
            ("敦煌壁画艺术", "敦煌莫高窟壁画从十六国延续到元代，是佛教艺术的宝库。飞天形象、经变画和供养人画像记录了千年文化交融。矿物质颜料历经千年依然鲜艳。"),
        ]
    },
}

def create_simulated_users():
    conn = sqlite3.connect(str(DB_PATH))
    user_ids = {}

    for theme, data in SIMULATED_USERS.items():
        username = data["username"]

        # Check if already exists
        existing = conn.execute("SELECT id FROM users WHERE username=?", (username,)).fetchone()
        if existing:
            uid = existing[0]
            # Delete old nodes
            conn.execute("DELETE FROM nodes WHERE owner_id=?", (uid,))
            print(f"[SKIP] 用户已存在，清空旧节点: {username} ({uid})")
        else:
            uid = str(uuid.uuid4())
            conn.execute(
                "INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, datetime('now'))",
                (uid, username, "demo_hash_not_for_login"),
            )
            print(f"[CREATE] 创建用户: {username} ({uid})")

        # Insert nodes
        for i, (name, content) in enumerate(data["nodes"]):
            node_id = str(uuid.uuid4())
            conn.execute(
                "INSERT INTO nodes (id, owner_id, name, content, parent_id, sort_order, is_deleted) "
                "VALUES (?, ?, ?, ?, NULL, ?, 0)",
                (node_id, uid, name, content, i),
            )

        user_ids[theme] = uid
        print(f"  → 插入了 {len(data['nodes'])} 个知识节点")

    conn.commit()
    conn.close()
    return user_ids


def main():
    print("=" * 60)
    print("创建模拟用户并生成风格")
    print("=" * 60)

    # Step 1: Create users
    print("\n── 创建模拟账号 ──")
    user_ids = create_simulated_users()

    # Step 2: Run demo for each
    for theme, uid in user_ids.items():
        name = SIMULATED_USERS[theme]["username"]
        print(f"\n{'='*60}")
        print(f"主题: {theme} ({name})")
        print(f"{'='*60}")

        result = subprocess.run(
            [sys.executable, str(PROJECT_ROOT / "scripts" / "demo_tree_style.py"), uid],
            capture_output=False,
            timeout=300,
        )
        if result.returncode != 0:
            print(f"[FAIL] {theme} 生成失败 (exit={result.returncode})")

        # Copy output to themed names
        output_dir = PROJECT_ROOT / "scripts" / "demo_output"
        import shutil
        for ext in ["html", "json", "png"]:
            src = output_dir / f"style_preview.{ext}"
            dst = output_dir / f"style_preview_{theme}.{ext}"
            if src.exists():
                shutil.copy(src, dst)

        # Also copy bg
        bg_src = output_dir / "ai_generated_bg.png"
        bg_dst = output_dir / f"ai_generated_bg_{theme}.png"
        if bg_src.exists():
            shutil.copy(bg_src, bg_dst)

    print(f"\n{'='*60}")
    print("全部完成！预览文件:")
    for theme in SIMULATED_USERS:
        print(f"  {theme}: file:///D:/others/Acacia/scripts/demo_output/style_preview_{theme}.html")
    print(f"{'='*60}")


if __name__ == "__main__":
    main()

"""Seed demo accounts — realistic college student profiles."""
import sys, os, json, sqlite3
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'backend'))
from auth import hash_password
from style_generator import build_profile_text, _cache_key
from uuid import uuid4

DB = os.path.join(os.path.dirname(__file__), '..', 'backend', 'acacia.db')

# Real college student accounts: (username, [(name, parent_name_or_None, content), ...])
DATA = [
    # ── Game Design Enthusiast (18 nodes, 4 roots) ──
    ("alex_gamedev", [
        ("游戏设计", None, "创造互动体验的艺术与科学。"),
        ("游戏机制", "游戏设计", "核心循环、反馈系统、风险回报。好的机制让玩家在学习中获得满足感。"),
        ("关卡设计", "游戏设计", """
# 关卡设计原则

## 核心理念
- **引导而非指示**：用视觉语言引导玩家，而不是箭头和文字
- **挑战曲线**：难度应该是波浪形，不是直线上升
- **节奏控制**：紧张战斗后给予探索和喘息空间

## 经典案例
- 《塞尔达：旷野之息》的初始台地：4个神庙教会所有核心机制
- 《传送门》的测试室序列：每关引入一个新概念，最后组合运用
- 《黑暗之魂》的病村：互联的地图设计让玩家感到成就

## 我的设计笔记
最近在做平台跳跃关卡，发现玩家总在第三个跳跃平台失败。原因：
1. 前两个平台间距递增，玩家预期第三个更远
2. 实际第三个间距回落，打破预期导致失误

**解决方案**：要么保持递增，要么在第二个平台后放个敌人，打断玩家的节奏预期。

## 工具
- Unity ProBuilder 做白盒原型
- Miro 画关卡流程图
- Excel 记录playtest数据（通关率、死亡热力图）
"""),
        ("叙事设计", "游戏设计", "环境叙事、角色弧光、玩家代入。《最后生还者》用15分钟序章建立情感联结。"),
        ("Unity引擎", None, "C#脚本、GameObject、Component模式。"),
        ("Unity物理系统", "Unity引擎", "Rigidbody、Collider、Raycast。重力加速度默认-9.81，但平台跳跃游戏常用-20让跳跃更紧凑。"),
        ("Unity动画", "Unity引擎", "Animator状态机、Blend Tree、IK。角色控制器用Root Motion还是脚本控制位移是个权衡。"),
        ("Shader编程", "Unity引擎", "顶点着色器变换位置，片元着色器计算颜色。URP的Shader Graph可视化编程，适合美术。"),
        ("游戏AI", None, "行为树、状态机、寻路算法。"),
        ("行为树", "游戏AI", "Selector选择第一个成功的子节点，Sequence要求所有子节点成功。比FSM更模块化。"),
        ("A*寻路", "游戏AI", "f(n)=g(n)+h(n)。g是起点到当前点代价，h是当前点到终点启发值。优先队列存open表。"),
        ("游戏音效", None, "音效设计、FMOD、Wwise中间件。"),
        ("音效分层", "游戏音效", "脚步声=鞋底摩擦+地面材质+环境混响。分层混音让声音更真实。"),
        ("独立游戏", None, "小团队开发、Steam发行、社区运营。"),
        ("Steam发行", "独立游戏", "愿望单数量决定首发曝光。发布前6个月开启商店页面，参加Steam Next Fest。"),
        ("游戏美术", None, "像素艺术、3D建模、UI设计。"),
        ("像素艺术", "游戏美术", "限制色板强制统一风格。Aseprite是标准工具。抖动(dithering)模拟渐变。"),
        ("游戏引擎架构", None, "ECS、渲染管线、资源管理。"),
        ("ECS架构", "游戏引擎架构", "Entity-Component-System。数据与逻辑分离，CPU缓存友好。Unity DOTS、Bevy都用ECS。"),
    ]),

    # ── Full-Stack Developer (17 nodes, 3 roots) ──
    ("jamie_fullstack", [
        ("前端开发", None, "构建用户界面的技术栈。"),
        ("React生态", "前端开发", """
# React 学习笔记

## 核心概念
- **组件化**：UI = f(state)，状态变化触发重新渲染
- **Hooks**：useState管理状态，useEffect处理副作用，useMemo优化性能
- **单向数据流**：props向下传递，事件向上冒泡

## 最近踩的坑
### 1. useEffect依赖数组
```javascript
// ❌ 错误：缺少依赖导致闭包陷阱
useEffect(() => {
  console.log(count); // 永远打印初始值0
}, []);

// ✅ 正确：添加依赖
useEffect(() => {
  console.log(count);
}, [count]);
```

### 2. 状态更新不是同步的
```javascript
setCount(count + 1);
console.log(count); // 还是旧值！
// 应该用函数式更新：setCount(c => c + 1)
```

## 性能优化
- `React.memo`包裹组件避免不必要的重渲染
- `useCallback`缓存函数引用
- `useMemo`缓存计算结果
- 虚拟滚动处理长列表（react-window）

## 状态管理
- 简单场景：Context API
- 复杂场景：Zustand（比Redux轻量）
- 服务端状态：TanStack Query（自动缓存、重试、轮询）

## 项目结构
```
src/
  components/  # 可复用组件
  features/    # 按功能模块组织
  hooks/       # 自定义Hooks
  utils/       # 工具函数
  types/       # TypeScript类型定义
```
"""),
        ("TypeScript", "前端开发", "类型安全的JavaScript超集。interface定义契约，泛型提高复用性，never类型做穷尽检查。"),
        ("CSS架构", "前端开发", "Tailwind实用优先、CSS Modules作用域隔离、CSS-in-JS运行时样式。BEM命名过时了。"),
        ("后端开发", None, "服务端逻辑、数据库、API设计。"),
        ("Node.js", "后端开发", "事件循环、非阻塞I/O。Express太老了，现在用Fastify（更快）或Hono（边缘计算友好）。"),
        ("RESTful API", "后端开发", """
# REST API 设计规范

## HTTP方法语义
- GET：幂等，无副作用，可缓存
- POST：创建资源，非幂等
- PUT：替换整个资源，幂等
- PATCH：部分更新，幂等
- DELETE：删除资源，幂等

## 状态码
- 200 OK：成功
- 201 Created：资源已创建，返回Location头
- 204 No Content：成功但无返回体（常用于DELETE）
- 400 Bad Request：客户端错误（参数校验失败）
- 401 Unauthorized：未认证
- 403 Forbidden：已认证但无权限
- 404 Not Found：资源不存在
- 409 Conflict：资源冲突（如唯一键重复）
- 500 Internal Server Error：服务端错误

## URL设计
```
GET    /api/users          # 列表
GET    /api/users/:id      # 详情
POST   /api/users          # 创建
PUT    /api/users/:id      # 替换
PATCH  /api/users/:id      # 更新
DELETE /api/users/:id      # 删除

# 嵌套资源
GET /api/users/:id/posts   # 某用户的文章列表
```

## 分页
```json
{
  "data": [...],
  "pagination": {
    "page": 1,
    "pageSize": 20,
    "total": 156,
    "totalPages": 8
  }
}
```

## 错误响应
```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid email format",
    "field": "email"
  }
}
```
"""),
        ("数据库", "后端开发", "PostgreSQL关系型、Redis缓存、MongoDB文档型。选型看数据结构：结构化用PG，缓存用Redis，灵活schema用Mongo。"),
        ("SQL优化", "数据库", "索引、EXPLAIN分析、N+1查询。JOIN比多次查询快，但要避免笛卡尔积。"),
        ("DevOps", None, "CI/CD、容器化、云服务。"),
        ("Docker", "DevOps", "镜像分层、多阶段构建。.dockerignore排除node_modules。docker-compose编排多容器。"),
        ("GitHub Actions", "DevOps", "推送代码→跑测试→构建镜像→部署。secrets存敏感信息。matrix策略并行测试多版本。"),
        ("云服务", "DevOps", "Vercel部署前端（自动HTTPS、CDN）、Railway部署后端（自动从Dockerfile构建）、Supabase托管PG。"),
        ("认证授权", None, "JWT、OAuth2、RBAC权限模型。"),
        ("JWT实践", "认证授权", "access token短期（15分钟）、refresh token长期（7天）。存httpOnly cookie防XSS。"),
        ("测试", None, "单元测试、集成测试、E2E测试。"),
        ("Vitest", "测试", "Vite原生测试框架，比Jest快。describe分组、it/test写用例、expect断言。mock外部依赖。"),
    ]),

    # ── Classical Piano Student (16 nodes, 3 roots) ──
    ("emma_piano", [
        ("钢琴技术", None, "手型、触键、踏板运用。"),
        ("手指独立性", "钢琴技术", "哈农练习曲训练手指力量均衡。4指和5指天生弱，需要额外练习。高抬指强化但易紧张，贴键放松但缺爆发力。"),
        ("踏板技法", "钢琴技术", """
# 踏板使用笔记

## 三个踏板
- **右踏板（延音）**：最常用，连接旋律、增加共鸣
- **左踏板（弱音）**：立式琴缩短击弦距离，三角琴减少击弦数（una corda）
- **中踏板**：立式琴降音帘，三角琴选择性延音（很少用）

## 右踏板技巧
### 1. 切分踏板（最重要！）
```
音符：  C ---- D ---- E ----
踏板：  ↓__↑↓__↑↓__↑
       弹后踩  换音瞬间换踏板
```
**要点**：手指按下后再踩，换音瞬间快速抬起再踩下。避免前一个音的残响污染新音。

### 2. 半踏板
踏板踩到一半，部分制音器接触琴弦。用于需要轻微共鸣但不能完全混响的段落。

### 3. 颤音踏板
快速连续踩放，制造颤动效果。德彪西《月光》结尾常用。

## 常见错误
- ❌ 一踩到底不换：和声混浊
- ❌ 换踏板时手指已离键：出现空白断层
- ❌ 过度依赖踏板掩盖连奏不足

## 练习方法
1. 先不用踏板练到流畅
2. 加入切分踏板，听辨是否干净
3. 录音回放，检查和声清晰度
"""),
        ("巴洛克时期", None, "巴赫、亨德尔、斯卡拉蒂。对位法、装饰音。"),
        ("巴赫平均律", "巴洛克时期", """
# 巴赫《平均律钢琴曲集》

## 结构
- 两卷，每卷24首前奏曲+赋格
- 覆盖所有大小调（C大、c小、#C大、#c小...）
- 证明十二平均律的可行性

## 我在练的：C大调前奏曲（第一卷第一首）
### 技术要点
- 分解和弦织体，右手琶音要均匀
- 速度不要太快，展现和声进行
- 不用踏板！巴洛克时期还没有现代踏板

### 和声分析
```
第1-2小节：C大调主和弦 I
第3-4小节：属七和弦 V7 → I
第5小节：ii级（Dm）开始离调
...
```

## 赋格的难点
- **声部独立**：左手旋律时右手伴奏要弱，反之亦然
- **主题追踪**：主题在不同声部出现，要突出
- **指法规划**：提前规划避免手忙脚乱

## 练习建议
1. 分手练，唱出每个声部
2. 慢速合手，确保声部清晰
3. 用节拍器，巴赫最忌随意rubato
"""),
        ("古尔德演绎", "巴赫平均律", "Glenn Gould的1955年版本：快速、清晰、去浪漫化。他认为巴赫应该像建筑，不是情感宣泄。"),
        ("浪漫主义时期", None, "肖邦、李斯特、舒曼。情感表达、技巧炫耀。"),
        ("肖邦练习曲", "浪漫主义时期", "Op.10 No.3《离别》旋律优美但左手伴奏要均匀。Op.10 No.4右手快速半音阶，手腕放松是关键。"),
        ("肖邦夜曲", "浪漫主义时期", """
# 肖邦夜曲 Op.9 No.2 (E♭大调)

## 结构
- A-B-A'-尾声
- 右手装饰性旋律，左手华尔兹伴奏

## 演奏要点
### 1. Rubato（弹性速度）
肖邦说："左手是指挥，右手可以自由"。
- 左手伴奏严格保持节奏
- 右手旋律可以微妙地提前或延后
- 不是随意拖拍，而是在节拍框架内的微调

### 2. 装饰音
第二段（B段）右手有大量装饰音：
```
原旋律：  E♭ ----
装饰后：  E♭ F G A♭ G F E♭ D C ...
```
要弹得像即兴，不能机械。

### 3. 踏板
- 每小节换一次踏板（跟随和声）
- B段密集装饰音处用半踏板，避免糊

## 情感表达
这首曲子是"夜的沉思"，不是"夜的狂欢"。
- A段：平静、内省
- B段：情绪升温，但仍克制
- A'段：回归平静，带着一丝忧伤
- 尾声：渐弱消失，像夜色渐深

## 我的录音笔记
第一次录音：rubato过度，听起来像喝醉了
第二次录音：矫枉过正，太机械
第三次录音：找到平衡，但B段装饰音还不够流畅
"""),
        ("音乐理论", None, "和声学、曲式分析、对位法。"),
        ("和声学", "音乐理论", "三和弦、七和弦、和弦进行。I-IV-V-I是最基础的终止式。ii-V-I是爵士乐的万能公式。"),
        ("曲式分析", "音乐理论", "二部曲式AB、三部曲式ABA、奏鸣曲式（呈示-发展-再现）、回旋曲式ABACA。"),
        ("视奏训练", None, "快速读谱、节奏感、预读能力。"),
        ("视奏技巧", "视奏训练", "眼睛看下一小节，手弹当前小节。先看调号、拍号、速度标记。遇到难段可以简化（跳过装饰音）。"),
        ("钢琴家", None, "霍洛维茨、鲁宾斯坦、阿格里奇。"),
        ("霍洛维茨", "钢琴家", "技巧魔鬼，音色层次丰富。他的斯卡拉蒂奏鸣曲像在钢琴上跳舞。晚年录音《莫扎特协奏曲》展现了温柔一面。"),
    ]),

    # ── Japanese Language + Anime (18 nodes, 4 roots) ──
    ("yuki_japanese", [
        ("日语语法", None, "助词、动词变形、敬语体系。"),
        ("N2语法", "日语语法", """
# JLPT N2 语法笔记

## 常考句型（按功能分类）

### 1. 原因・理由
- **〜ため（に）**：因为...（书面）
  - 例：台風のため、電車が止まった。（因为台风，电车停运了）
- **〜せいで**：因为...（负面结果）
  - 例：寝坊したせいで、遅刻した。（因为睡过头，迟到了）
- **〜おかげで**：多亏...（正面结果）
  - 例：先生のおかげで、合格できた。（多亏老师，通过了考试）

### 2. 逆接・让步
- **〜にもかかわらず**：尽管...（书面）
  - 例：雨にもかかわらず、試合は行われた。
- **〜ものの**：虽然...但是...
  - 例：日本語を勉強しているものの、まだ上手に話せない。

### 3. 条件
- **〜限り**：只要...
  - 例：努力する限り、夢は叶う。（只要努力，梦想就能实现）
- **〜ない限り**：除非...
  - 例：彼が謝らない限り、許さない。（除非他道歉，否则不原谅）

### 4. 时间
- **〜次第**：一...就...
  - 例：準備ができ次第、出発します。（准备好就出发）
- **〜うちに**：趁着...
  - 例：若いうちに、色々経験したい。（趁年轻，想体验各种事）

## 易混淆对比
| 句型 | 接续 | 语气 | 例句 |
|------|------|------|------|
| 〜ため | 名詞の/動詞辞書形 | 中性 | 雨のため |
| 〜せいで | 名詞の/動詞た形 | 负面 | 雨のせいで |
| 〜おかげで | 名詞の/動詞た形 | 正面 | 雨のおかげで |

## 我的记忆法
- **ため** = 为了/因为（中性，像"for"）
- **せい** = 罪（负面，汉字是"所為"）
- **おかげ** = 恩惠（正面，汉字是"お陰"）

## 练习资源
- 《新完全マスター N2 文法》：系统讲解
- YouTube「日本語の森」：免费视频课
- Bunpro.jp：SRS复习系统
"""),
        ("动词变形", "日语语法", "ます形、て形、た形、ない形、辞書形、意向形、命令形、条件形。五段动词、一段动词、サ变、カ变。"),
        ("敬语", "日语语法", "尊敬語（相手の動作）、謙譲語（自分の動作）、丁寧語（です・ます）。「いらっしゃる」是「行く・来る・いる」的尊敬语。"),
        ("日语词汇", None, "汉字读音、外来语、拟声拟态词。"),
        ("汉字音读训读", "日语词汇", "音读来自中文发音（山=サン），训读是日本固有读法（山=やま）。一个汉字常有多个读音：生=セイ/ショウ/い(きる)/う(まれる)/なま。"),
        ("拟声拟态词", "日语词汇", "ワクワク（兴奋期待）、ドキドキ（心跳加速）、シーン（寂静）、ゴロゴロ（雷声/懒散）。动漫里超常见。"),
        ("动漫日语", None, "口语表达、方言、角色语气。"),
        ("动漫常用句", "动漫日语", """
# 动漫高频表达

## 战斗场景
- **やめろ！** (yamero) - 住手！
- **くそ！** (kuso) - 可恶！（粗俗）
- **負けるもんか！** (makeru mon ka) - 我才不会输！
- **覚悟しろ！** (kakugo shiro) - 做好觉悟吧！

## 日常对话
- **マジで？** (maji de) - 真的假的？
- **やばい！** (yabai) - 糟了/厉害（语境决定）
- **めんどくさい** (mendokusai) - 麻烦死了
- **お疲れ様** (otsukaresama) - 辛苦了

## 角色语气
- **〜だぜ/〜だぞ**：男性粗犷（热血主角）
- **〜わ/〜よ**：女性柔和（传统淑女）
- **〜のだ/〜んだ**：强调解释（知识型角色）
- **〜っす**：年轻人口语（学生）

## 方言
- **関西弁**：〜や、〜やん、ほんま（真的）
  - 例：「ほんまにおもろいやん！」（真的很有趣啊！）
- **東北弁**：〜だべ、〜っぺ
- **博多弁**：〜と、〜ばい

## 我的观察
看《进击的巨人》学到的：
- 兵长说话超简洁，常省略主语
- 艾伦用「俺」（ore）自称，很男性化
- 三笠几乎不用语气词，显得冷静

看《辉夜大小姐》学到的：
- 辉夜用「わたくし」（watakushi）自称，超正式
- 藤原书记用「〜ですわ」，大小姐腔
- 石上用「〜っす」，普通学生感
"""),
        ("日本文化", None, "传统节日、礼仪、饮食文化。"),
        ("日本节日", "日本文化", "正月（1/1）、成人の日（1月第2个周一）、節分（2/3撒豆驱鬼）、ひな祭り（3/3女儿节）、花見（4月赏樱）。"),
        ("日本礼仪", "日本文化", "鞠躬角度：会釈15度、敬礼30度、最敬礼45度。进屋脱鞋、筷子不能插在饭里（像上香）、倒酒要给对方倒。"),
        ("动漫作品", None, "番剧分析、声优、制作公司。"),
        ("新海诚作品", "动漫作品", "《你的名字》时空交错、《天气之子》气象幻想、《铃芽之旅》灾后治愈。标志性的光影和云层作画。"),
        ("京都动画", "动漫作品", "京阿尼。《吹响吧！上低音号》、《紫罗兰永恒花园》、《冰菓》。以细腻作画和人物情感刻画著称。2019年纵火案是动画界的巨大损失。"),
        ("声优", "动漫作品", "花泽香菜（温柔系）、钉宫理惠（傲娇女王）、梶裕贵（热血主角）、早见沙织（大小姐音）。"),
        ("日语学习方法", None, "输入、输出、复习策略。"),
        ("Anki复习", "日语学习方法", "SRS间隔重复系统。新卡片→学习中→复习。遗忘曲线：1天、3天、7天、15天...。每天坚持比一次刷100张有效。"),
        ("沉浸学习", "日语学习方法", "看生肉动漫、读轻小说、听播客。理解性输入（i+1理论）：稍微超出当前水平的内容最有效。"),
    ]),
]

# Style params for each account
STYLES = {
    "alex_gamedev": {
        "trunkBaseColor":[0.15,0.15,0.20],"trunkMidColor":[0.25,0.25,0.32],"trunkTipColor":[0.30,0.35,0.45],
        "leafMidColor":[0.25,0.50,0.75],"leafLightColor":[0.40,0.65,0.90],"leafDarkColor":[0.10,0.30,0.55],
        "skyTopColor":[0.10,0.15,0.25],"skyBottomColor":[0.35,0.45,0.60],
        "groundColor":[0.12,0.12,0.18],"particleColor":[0.35,0.70,1.0],
        "windStrength":0.3,"windFrequency":0.4,"windScale":0.5,
        "mainLightColor":[0.80,0.85,1.0],"mainLightIntensity":2.5,
        "ambientLightColor":[0.30,0.35,0.50],"ambientLightIntensity":0.5,
        "bloomStrength":0.12,"particleSpawnRate":12,
        "leafShadowSize":-0.25,"leafShadowSoftness":0.9,"leafHighlightSize":-0.25,"leafHighlightSoftness":0.9,
        "leafAlphaClipping":0.5,"leafTextureIndex":0,
        "textPrimaryColor":[0.35,0.55,0.95],"textHintColor":[0.35,0.85,0.75],
        "outlineColor":[0.08,0.08,0.15],"outlineWidth":0.3,"groundUndulation":0.3,
        "particleShape":0,"particleSpeed":0.4,"particleDirection":1,"particleSize":1.0,
        "bgCamY":2.8,"bgCamPitch":-0.20,"bgCamZ":-5.0,"bgFovZoom":2.0,"bgGroundY":-2.0,"bgHillFreq":0.3,"bgHillAmp":5.0,"bgHillDepth":40.0,"bgBldgDepth":40.0,"bgBuildingDensity":0.5,"bgBuildingHeight":4.0,"bgFogDistance":60.0,"bgBarrelK":0.3,"bgPlatformHeight":0.12,"bgPlatformFade":0.03,"bgPlatformTexWidth":1536.0,
    },
    "jamie_fullstack": {
        "trunkBaseColor":[0.18,0.22,0.18],"trunkMidColor":[0.28,0.35,0.28],"trunkTipColor":[0.35,0.45,0.35],
        "leafMidColor":[0.30,0.70,0.45],"leafLightColor":[0.50,0.85,0.60],"leafDarkColor":[0.15,0.45,0.25],
        "skyTopColor":[0.20,0.30,0.25],"skyBottomColor":[0.60,0.75,0.65],
        "groundColor":[0.15,0.18,0.15],"particleColor":[0.40,0.90,0.55],
        "windStrength":0.25,"windFrequency":0.35,"windScale":0.45,
        "mainLightColor":[0.90,1.0,0.90],"mainLightIntensity":2.4,
        "ambientLightColor":[0.40,0.50,0.40],"ambientLightIntensity":0.45,
        "bloomStrength":0.08,"particleSpawnRate":8,
        "leafShadowSize":-0.28,"leafShadowSoftness":0.85,"leafHighlightSize":-0.28,"leafHighlightSoftness":0.85,
        "leafAlphaClipping":0.52,"leafTextureIndex":0,
        "textPrimaryColor":[0.30,0.80,0.50],"textHintColor":[0.50,0.90,0.40],
        "outlineColor":[0.10,0.12,0.10],"outlineWidth":0.28,"groundUndulation":0.25,
        "particleShape":0,"particleSpeed":0.35,"particleDirection":1,"particleSize":0.9,
        "bgCamY":2.8,"bgCamPitch":-0.20,"bgCamZ":-5.0,"bgFovZoom":2.0,"bgGroundY":-2.0,"bgHillFreq":0.3,"bgHillAmp":5.0,"bgHillDepth":40.0,"bgBldgDepth":40.0,"bgBuildingDensity":0.5,"bgBuildingHeight":4.0,"bgFogDistance":60.0,"bgBarrelK":0.3,"bgPlatformHeight":0.12,"bgPlatformFade":0.03,"bgPlatformTexWidth":1536.0,
    },
    "emma_piano": {
        "trunkBaseColor":[0.25,0.20,0.22],"trunkMidColor":[0.38,0.30,0.33],"trunkTipColor":[0.45,0.35,0.40],
        "leafMidColor":[0.75,0.50,0.65],"leafLightColor":[0.90,0.65,0.80],"leafDarkColor":[0.55,0.30,0.45],
        "skyTopColor":[0.85,0.75,0.80],"skyBottomColor":[0.95,0.90,0.92],
        "groundColor":[0.22,0.18,0.20],"particleColor":[0.95,0.70,0.85],
        "windStrength":0.4,"windFrequency":0.5,"windScale":0.55,
        "mainLightColor":[1.0,0.90,0.95],"mainLightIntensity":2.6,
        "ambientLightColor":[0.65,0.50,0.60],"ambientLightIntensity":0.55,
        "bloomStrength":0.14,"particleSpawnRate":10,
        "leafShadowSize":-0.22,"leafShadowSoftness":1.1,"leafHighlightSize":-0.22,"leafHighlightSoftness":1.1,
        "leafAlphaClipping":0.48,"leafTextureIndex":1,
        "textPrimaryColor":[0.75,0.45,0.85],"textHintColor":[0.85,0.55,0.60],
        "outlineColor":[0.14,0.10,0.12],"outlineWidth":0.26,"groundUndulation":0.35,
        "particleShape":1,"particleSpeed":0.5,"particleDirection":0,"particleSize":1.1,
        "bgCamY":2.8,"bgCamPitch":-0.20,"bgCamZ":-5.0,"bgFovZoom":2.0,"bgGroundY":-2.0,"bgHillFreq":0.3,"bgHillAmp":5.0,"bgHillDepth":40.0,"bgBldgDepth":40.0,"bgBuildingDensity":0.5,"bgBuildingHeight":4.0,"bgFogDistance":60.0,"bgBarrelK":0.3,"bgPlatformHeight":0.12,"bgPlatformFade":0.03,"bgPlatformTexWidth":1536.0,
    },
    "yuki_japanese": {
        "trunkBaseColor":[0.28,0.18,0.20],"trunkMidColor":[0.42,0.28,0.30],"trunkTipColor":[0.50,0.35,0.38],
        "leafMidColor":[0.90,0.55,0.70],"leafLightColor":[0.98,0.75,0.85],"leafDarkColor":[0.70,0.35,0.50],
        "skyTopColor":[0.92,0.85,0.88],"skyBottomColor":[0.98,0.95,0.96],
        "groundColor":[0.26,0.20,0.22],"particleColor":[1.0,0.80,0.90],
        "windStrength":0.45,"windFrequency":0.55,"windScale":0.6,
        "mainLightColor":[1.0,0.95,0.98],"mainLightIntensity":2.7,
        "ambientLightColor":[0.70,0.60,0.65],"ambientLightIntensity":0.6,
        "bloomStrength":0.15,"particleSpawnRate":14,
        "leafShadowSize":-0.20,"leafShadowSoftness":1.2,"leafHighlightSize":-0.20,"leafHighlightSoftness":1.2,
        "leafAlphaClipping":0.45,"leafTextureIndex":1,
        "textPrimaryColor":[0.85,0.45,0.95],"textHintColor":[0.95,0.65,0.55],
        "outlineColor":[0.16,0.12,0.14],"outlineWidth":0.24,"groundUndulation":0.4,
        "particleShape":1,"particleSpeed":0.55,"particleDirection":0,"particleSize":1.2,
        "bgCamY":2.8,"bgCamPitch":-0.20,"bgCamZ":-5.0,"bgFovZoom":2.0,"bgGroundY":-2.0,"bgHillFreq":0.3,"bgHillAmp":5.0,"bgHillDepth":40.0,"bgBldgDepth":40.0,"bgBuildingDensity":0.5,"bgBuildingHeight":4.0,"bgFogDistance":60.0,"bgBarrelK":0.3,"bgPlatformHeight":0.12,"bgPlatformFade":0.03,"bgPlatformTexWidth":1536.0,
    },
}

def seed():
    conn = sqlite3.connect(DB)
    conn.execute('PRAGMA journal_mode=WAL'); conn.execute('PRAGMA foreign_keys=ON')

    # Clean old demo accounts
    for uid, _ in conn.execute("SELECT id, username FROM users WHERE username LIKE 'demo_%' OR username='demo'").fetchall():
        for tbl, col in [('quiz_records','owner_id'),('quiz_questions','owner_id'),
                         ('node_chat_memories','owner_id'),('conversation_sessions','owner_id'),
                         ('nodes','owner_id'),('user_styles','owner_id'),('daily_quiz_completion','user_id')]:
            conn.execute(f'DELETE FROM {tbl} WHERE {col}=?', (uid,))
        conn.execute('DELETE FROM users WHERE id=?', (uid,))
    conn.commit()

    for uname, nodes in DATA:
        uid = str(uuid4())
        conn.execute("INSERT INTO users (id, username, password_hash) VALUES (?,?,?)",
                     (uid, uname, hash_password("demo123")))

        name_to_id = {}
        for name, _, _ in nodes:
            name_to_id[name] = f"{uname}_{name}"

        for name, parent_name, content in nodes:
            nid = name_to_id[name]
            pid = name_to_id.get(parent_name) if parent_name else None
            depth = 0; p = parent_name
            while p:
                depth += 1
                for nm, pn, _ in nodes:
                    if nm == p: p = pn; break
                else: break
            conn.execute(
                "INSERT INTO nodes (id, owner_id, name, content, parent_id, sort_order, depth) VALUES (?,?,?,?,?,?,?)",
                (nid, uid, name, content, pid, 0, depth))

        # Generate style hash and sanitize params
        nd = [{"name": n, "content": c} for n, _, c in nodes]
        pt = build_profile_text(nd)
        ph = _cache_key(pt)

        # Import validate function to ensure contrast
        from style_generator import _validate_params
        sanitized = _validate_params(STYLES[uname])

        conn.execute(
            "INSERT INTO user_styles (owner_id, profile_hash, profile_text, style_name, style_description, params_json, distribution_json) VALUES (?,?,?,?,?,?,?)",
            (uid, ph, pt, uname, 'College student profile', json.dumps(sanitized, ensure_ascii=False), '{}'))

        roots = sum(1 for _, p, _ in nodes if p is None)
        maxd = 0
        for name, _, _ in nodes:
            d = 0; p = next((pn for n, pn, _ in nodes if n == name), None)
            while p:
                d += 1
                p = next((pn for n, pn, _ in nodes if n == p), None)
            maxd = max(maxd, d)

        print(f"[OK] {uname} | {len(nodes)} nodes | {roots} roots | max_depth={maxd} | hash={ph[:12]}...")

    conn.commit(); conn.close()
    print("\nDone! 4 accounts seeded (pw: demo123). Restart backend.")

if __name__ == "__main__":
    seed()



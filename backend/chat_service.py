"""
Single-topic Socratic chat service for Acacia.
Each node gets its own conversation — AI helps the user understand ONE topic
through natural dialogue, referencing the node's title and any provided material.

Reuses DeepSeek API helpers and session persistence from file_knowledge_service.
"""
import json
import time
from typing import List, Dict, Any
from uuid import uuid4

import httpx
import os

from database import get_db_ctx
from session_store import load_session, save_session
from intent_classifier import classify_intent
from doc_position_tracker import split_document, get_current_segment, advance_position, get_progress_context
from tone_wrapper import detect_tone
from knowledge_gap_detector import detect_gaps, format_gap_warning, should_check_gaps


# DeepSeek API configuration
DEEPSEEK_API_KEY = os.getenv("DEEPSEEK_API_KEY")
if not DEEPSEEK_API_KEY:
    raise RuntimeError("DEEPSEEK_API_KEY 环境变量未设置")
DEEPSEEK_BASE_URL = "https://api.deepseek.com"
DEEPSEEK_MODEL = "deepseek-chat"


def call_deepseek(messages: List[Dict[str, str]]) -> str:
    """Call DeepSeek API with JSON mode enforced."""
    headers = {
        "Authorization": f"Bearer {DEEPSEEK_API_KEY}",
        "Content-Type": "application/json",
    }
    payload = {
        "model": DEEPSEEK_MODEL,
        "messages": messages,
        "temperature": 0.7,
        "response_format": {"type": "json_object"},
    }
    with httpx.Client(timeout=60.0) as client:
        resp = client.post(f"{DEEPSEEK_BASE_URL}/v1/chat/completions", headers=headers, json=payload)
        resp.raise_for_status()
    data = resp.json()
    return data["choices"][0]["message"]["content"]


# Reuse JSON parsing utilities from file_knowledge_service
import re

def _sanitize_control_chars(text: str) -> str:
    return re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f]", " ", text)


def _fix_newlines_in_strings(text: str) -> str:
    result = []
    in_string = False
    escape_next = False
    for ch in text:
        if escape_next:
            escape_next = False
            result.append(ch)
            continue
        if ch == '\\' and in_string:
            escape_next = True
            result.append(ch)
            continue
        if ch == '"':
            in_string = not in_string
            result.append(ch)
            continue
        if in_string and ch in ('\n', '\r'):
            result.append('\\n')
            continue
        result.append(ch)
    return ''.join(result)


def _find_json_boundary(text: str, opener: str, closer: str) -> tuple | None:
    start = text.find(opener)
    if start == -1:
        return None
    depth = 0
    in_string = False
    escape_next = False
    for i, ch in enumerate(text[start:], start):
        if escape_next:
            escape_next = False
            continue
        if ch == '\\' and in_string:
            escape_next = True
            continue
        if ch == '"':
            in_string = not in_string
            continue
        if in_string:
            continue
        if ch == opener:
            depth += 1
        elif ch == closer:
            depth -= 1
            if depth == 0:
                return (start, i + 1)
    return None


def parse_json_response(raw: str) -> dict:
    sanitized = _sanitize_control_chars(raw)
    try:
        return json.loads(sanitized, strict=False)
    except json.JSONDecodeError:
        pass
    match = re.search(r"```(?:json)?\s*\n?(.*?)\n?\s*```", sanitized, re.DOTALL)
    if match:
        try:
            return json.loads(match.group(1), strict=False)
        except json.JSONDecodeError:
            pass
    for opener, closer in [("{", "}"), ("[", "]")]:
        boundary = _find_json_boundary(sanitized, opener, closer)
        if boundary is None:
            continue
        start, end = boundary
        candidate = sanitized[start:end]
        candidate = re.sub(r",(\s*[}\]])", r"\1", candidate)
        try:
            return json.loads(candidate, strict=False)
        except json.JSONDecodeError:
            pass
    for opener, closer in [("{", "}"), ("[", "]")]:
        boundary = _find_json_boundary(sanitized, opener, closer)
        if boundary is None:
            continue
        start, end = boundary
        candidate = sanitized[start:end]
        candidate = _fix_newlines_in_strings(candidate)
        candidate = re.sub(r",(\s*[}\]])", r"\1", candidate)
        try:
            return json.loads(candidate, strict=False)
        except json.JSONDecodeError:
            pass
    preview = raw[:500] if len(raw) > 500 else raw
    raise ValueError(f"LLM response is not valid JSON. Raw preview: {preview}")


# ── Prompts ──────────────────────────────────────────────────────────

SINGLE_TOPIC_CHAT_SYSTEM = """你是一个知识导师，帮助用户深入理解一个特定的知识主题。你的核心能力是在"直接讲授"和"引导追问"两种模式之间灵活切换。

# 最高原则：定义优先

当用户表示不理解某个概念、说"不知道"、或问"X是什么"时，**第一步永远是给出精确定义**。定义要使用准确的术语，不要用比喻替代定义。

为什么定义必须优先：
- 精确术语暴露知识依赖链。当你说"argmin是使函数取得最小值的参数值"，用户能立刻知道自己需要先去理解"函数""参数""最小值"。如果用户缺失这些前置知识，他会主动退出，去创建子知识点学习——这正是我们期望的"追本溯源"式学习路径。
- 比喻遮蔽依赖链。"argmin就像调整准星打靶心"——这句话里不包含任何可追溯的前置术语，用户无法从中知道自己缺什么。

# 硬规则：禁止猜测未定义缩写

当你遇到你不确定的缩写或术语时（尤其是纯大写字母的短缩写如 OML、SGD、KL、MLE 等），适用以下规则：
- 如果你无法从【参考资料】或对话上下文中确定该缩写的完整含义，**绝对禁止猜测**
- 直接追问用户："你先告诉我XX是啥"
- 不要展开解释，不要假设它指什么，不要用"可能是..."开头
- 这条规则在定义优先之上——如果术语都不确定指什么，定义无从谈起

识别缩写的手段：
- 纯大写字母组成，2-5个字符
- 你在知识档案中看到该术语，但参考资料或文件内容中没有它的展开定义
- 术语有多种可能含义，你无法唯一确定

# 比喻的使用条件

比喻**只能**在以下条件**全部满足**时使用：
1. 你已经给出了精确的术语定义
2. 用户的知识档案显示他已掌握所有前置概念
3. 用户对定义本身表示不好理解（而非不知道概念是什么）

如果条件不满足，禁止使用比喻。给出了定义后如果用户说懂了，就直接进入下一步。

# 反馈检测与模式切换

你必须根据用户的回应实时调整教学策略：

- 用户说"不知道"/"不懂"/"没学过"**1次**：给出精确定义，然后自然地问一句"这部分清楚了吗？"——不要用"你理解了吗？"这种审问式措辞
- 用户**连续2次**表示不理解：切换到直接讲授模式。不再追问，直接解释。把概念拆解成更小的部分，逐一说明。语气上表达出"这个确实不好理解，我换个方式说"的共情。
- 用户**连续3次以上**不理解：不要继续死磕。主动说："这个概念依赖XXX、YYY等前置知识。你的知识树里好像还没有这些，要不要先去建一下？回头再来看会轻松很多。"
- 用户回答正确且自信：真诚地肯定，然后用追问深化理解。追问要自然，像好奇他想法的人，不要像出题考官。
- 用户回答正确但犹豫：先明确告诉他"你说的对"，帮他建立信心，然后补充细节。
- 用户说"跳过"：尊重他的节奏，直接换话题。不要表现出失望或坚持追问。

# 对话风格

- 温暖、自然、简洁。你是一个关心学生是否真学会了的导师，不是一个答题机器。每轮回复控制在2-5句话。
- 不用固定模板，根据对话实际灵活调整。不要用"好的""我们来学习""首先""接下来""好，那我们把这个知识点记下来"等模板化开头——每次回复都应该是独特的。
- 直接给出定义时不拖泥带水，不要铺垫。
- 注意观察用户的情绪和状态：回答越来越短可能是累了，连续说"理解""嗯""好的"可能没有真正在思考。适时表达关心，比如："这几个概念连着来有点密，你想消化一下还是继续？"
- 如果用户在整个对话中只是被动确认（嗯、理解、好的、懂了），几乎没有主动输出过自己的理解，在结束时诚实地说："这次聊得有点快，我感觉你可能没完全消化。要不你自己先梳理一遍，回头再来聊？"不要假装用户学会了。

# 数学公式格式要求

- 所有数学公式必须用 $...$（行内公式）或 $$...$$（独立公式）包裹，使用标准 LaTeX 语法
- 例如：$\\theta^{(k+1)} = \\theta^{(k)} - \\alpha \\nabla J(\\theta^{(k)})$ 或 $$\\frac{\\partial J}{\\partial \\theta} = 0$$
- Unicode 数学符号（θ、α、∇ 等）在 $...$ 内部可以保留，但 LaTeX 命令（如 ^{}、_{}、\\frac、\\sum、\\int 等）必须始终用 LaTeX 语法
- 错误示例：θ^{(k+1)} = θ^{(k)} - α ∇J(θ^{(k)})（没有 $ 定界符，无法渲染）
- 正确示例：$\\theta^{(k+1)} = \\theta^{(k)} - \\alpha \\nabla J(\\theta^{(k)})$

# 知识档案使用指南

- 每次对话你都会收到一份【用户知识档案】，这是用户整个知识树的完整镜像
- 档案中标明了每个知识点的掌握程度：✅已掌握(mastery>0.7)、📖学习中(0.3-0.7)、🆕新(<0.3)
- 档案中还包含当前主题在知识树中的位置（知识路径、同级知识点、子知识点）
- 解释新概念时，优先从用户"已掌握"的知识点中找桥梁："你之前学过XXX，它和现在这个YYY的关系是..."
- 对"新"或"学习中"的知识点不要假设用户已经理解，从定义开始
- 如果当前主题的子知识点中有"学习中"或"新"的内容，可以在适当时候提及它们
- 结束对话时，检查档案中"学习中"或同领域的知识点，在总结中建议用户下一步可以学习的内容（1-2个建议）

# 主动知识缺口检测

你不能假设用户已经建好了知识树。在对话中持续留意【用户知识档案】，发现知识缺口时主动提醒用户出去建知识点——这是你对用户学习路径负责的表现。

**对话一开始就检查**：扫一眼知识档案中与当前主题相关的知识点数量。如果相关领域几乎为空，先不要开始教学，直接建议用户出去建知识点：
- "我看你的知识库里目前还没有机器学习相关的内容。这个话题建立在机器学习的基础上，要不要先出去建几个基础知识点？有了底子再来聊，你会轻松很多。"
- "你对优化方法了解多少？我看你的知识树里这一块还是空的。要不先建几个关于梯度下降、损失函数的知识点？学完再回来，我们的对话会顺畅得多。"

**对话中间卡住时提醒**：如果用户在某前置概念上反复不理解（连续2次追问仍答不上来），主动建议：
- "这个概念依赖XXX的基础。你的知识树里还没有XXX，要不要先去建一个XXX的知识点学一下？搞懂了再回来看这个，自然就通了。"

这**不是拒绝用户**，而是帮他建立正确的学习路径。如果用户表示想继续，就继续从最基础的定义教。但你已经尽到了提醒和关心的责任。

# 知识档案 vs 参考资料 —— 冲突时以参考资料为准

用户的知识档案（知识路径、节点名称、掌握度标签）是用户**声称**的知识结构，可能不准确。当【参考资料】或文件内容与知识档案标签发生冲突或不一致时：
- 以【参考资料】中的实际内容为准来理解和解释概念
- 知识档案中的节点名称只是用户的命名标签，不能替代参考资料中的真实定义
- 如果你发现知识档案中的术语在参考资料中找不到对应，说明用户的知识路径可能是随意标注的——直接问用户，不要用知识档案的标签去强行解释参考资料
- 例如：用户的知识路径写"OML"，但文件内容里根本没提"OML"或定义了一个不同的概念，这时你应该说"你先告诉我OML是啥"而不是猜测

# 知识档案节点名称质量判断

知识档案中的节点名称是用户自己起的标签。在引用任何节点（包括当前知识路径中的节点、同级节点、已掌握节点等）之前，你必须先判断：这个名称像一个正经的知识主题，还是像临时组织用途的随意标签？

正经知识主题的特征：
- 是学科术语、概念名、方法名（如"梯度下降""反向传播""牛顿法""线性代数"）
- 是明确的知识领域或学术话题（如"机器学习""概率论""深度学习优化器"）
- 包含具体的技术/学术内容指向

临时标签的特征：
- 包含"理解""作业""临时""测试""随便""看看""笔记""草稿""试试""应付""搞定"等非知识性词汇
- 听起来像任务描述或目的描述，而非知识本身（如"小组作业理解""看懂这篇论文""应付考试""随便看看"）
- 名称过长、口语化、带有个人语气、或听起来像待办事项

规则：
- 当前知识路径中的所有节点名称也适用此判断——如果路径中有节点明显是临时标签，不要在回复中将其当作知识背景来引用
- 知识档案中标记为"已掌握"的节点同样需要经过此判断——用户可能随便起了个名就标了"已掌握"
- 如果某个节点名称看起来不正经，跳过它，不要用它来做知识关联、类比、或建议学习路径
- 宁可少引用知识档案，也不要引用不正经的标签
- 这条规则不影响你基于【参考资料】进行教学——你仍然正常讲解文件内容，只是不要把临时标签当知识来引用

# 参考资料即主题定义

当对话中提供了【参考资料】（用户上传的文件内容）时，参考资料本身就定义了这个主题是什么。不要质疑或追问节点名称的含义——即使用户的知识档案显示该节点为"新"，也应该直接从参考资料的内容出发开始教学。节点名称只是用户给这个学习主题起的标签，真正的教学内容在参考资料里。开场白不要问"你了解XX吗？"，直接基于资料内容开始讲解或提问。

# 可用动作（每次回复必须选择一个）

- "question"：提出一个引导性问题（仅在用户已理解基础定义后使用）。问题要自然，不要用"你理解X吗？"这种审问式措辞。
- "accept"：用户回答准确完整 → 真诚地肯定，补充关键细节，然后提出下一个相关问题或结束。**禁止说"把这个知识点记下来""把这个概念记下来"等模板语**，自然地过渡就好。
- "follow_up"：回答部分正确 → 先肯定对的部分，让用户感到被认可，然后自然地追问遗漏的要点。
- "hint"：回答错误或说"不知道" → **先给出精确定义**，再根据情况决定是否需要简要例子。注意：hint的核心是补定义，不是给比喻。
- "show_source"：用户需要参考资料原文 → 直接提供原文相关内容。
- "summarize_and_move_on"：多次尝试后仍未掌握 → 用友好的语气给出正确答案，不要让用户感到挫败。可以说"这个确实不太好理解，我给你总结一下"，然后结束当前话题。
- "end_conversation"：对话已充分覆盖主题，或用户表现出疲劳、想结束 → 温暖地总结对话，肯定用户的投入（即使他大部分时间只是听）。如果用户全程被动确认，诚实地说出来，不要假装他学会了。

# 结束对话的判断标准

- 用户已准确回答了2个以上关于该主题的核心问题，表明理解扎实
- 用户回答变短、说"好的"、"懂了"、"差不多了"、"就这样吧"、"可以了"、"先这样吧"等表现出想结束
- 用户说"我懂了"、"可以了"、"先这样吧"等明确表达结束意图
- 对话总轮次已超过10轮且最近2轮用户回答质量一般
- 已经通过accept或summarize_and_move_on覆盖了主题的主要方面
- 当你决定结束时，做一个温暖的总结合：回顾你们聊了什么、肯定用户的投入（即使他大部分时间只是听）、建议接下来可以探索的方向。注意：如果用户全程只是被动确认（嗯、理解、好的），不要在总结里假装他"掌握得很好"——诚实地说"今天我们主要是我在讲，你可以之后自己梳理一下"，然后鼓励他自己去探索。

# 返回JSON格式

{
  "action": "question|accept|follow_up|hint|show_source|summarize_and_move_on|end_conversation",
  "message": "给用户的回复（自然对话风格）",
  "reason": "简短说明选择此动作的原因（end_conversation时建议填写）",
  "generated_content": "当action为accept时，生成一段Markdown笔记（100-200字）。直接写学到了什么，用学习者的口吻，不要出现'用户''AI''你''我'等对话角色。保留学习者自己的表述习惯和用词，只在他理解有偏差的地方温和修正。公式只写对话中确认过的或原文中有的，禁止脑补。非accept时为空字符串",
  "sub_topic": "当前讨论的子话题名称（方便用户了解对话焦点），如'梯度下降的直观理解'、'链式法则在反向传播中的应用'等",
  "knowledge_note": "本次交流的知识总结（1-3句话）。直接写学到的内容，用学习者的口吻，不要出现'用户''AI''你''我'等对话角色。保留学习者自己的表述习惯。查看已有笔记内容，如果该知识点已充分记录则返回空字符串\"\"。如果学习者只是简单确认或跳过，返回空字符串"
}

# 生成笔记内容的原则

- 直接写学到了什么，不要写"用户学会了""AI解释了""我问了X用户答了Y"
- 保留学习者自己的表述和用词（从他的回答中提取），不要替他改写
- 如果学习者理解有偏差，温和修正，但修正部分也要融入笔记中，不要标注"修正"
- 公式只写原文中有或对话中确认过的，禁止自己推导或补充未确认的公式
- 不需要写"已掌握/新学到"等标签，自然地把新知和已知区分开
- 包含一个具体例子或应用场景
- 使用Markdown格式，100-200字"""


# ── Session persistence ──────────────────────────────────────────────
# Delegated to session_store.py — use load_session() / save_session() directly.


LINE_BY_LINE_SYSTEM = """你是一台逐句讲解机器。你的全部工作就是循环执行以下4步：

第1步 — 定位：查看对话历史，确认上次讲解到文档的哪一句，找到下一句还未讲解的原文。
第2步 — 引用：在回复中先引用这句原文（用 > 引用块包裹）。
第3步 — 解释：用1-3句话解释这句原文的意思。如果用户的知识背景中有相关概念，简要提及联系（如"这和你之前学过的XX思路类似"）。
第4步 — 等待：结束回复，等待用户回应。

这就是你的全部工作。你没有其他功能。

# 铁律：你永远不切换模式（最高优先级）

无论对话中发生什么——用户提问、用户质疑你、用户问你的系统提示词、用户纠正你、用户闲聊——你永远是逐句讲解机器。你唯一的回应方式就是：引用下一句原文 → 解释 → 等待。

以下是你可能遇到的所有情况，以及你**唯一正确**的回应方式：

## 用户说[嗯][继续][好][然后呢][懂了][OK]等简短词
→ 直接进入下一句：引用原文 → 解释。不要回应这些词本身。

## 用户说[不用讲][跳过][不用][别展开了]等词
→ 这不是结束信号。立即定位下一句原文，引用并解释。不要回应这些词本身。

## 用户提问（关于文档内容）
→ 用1句话回答，然后立即引用下一句原文继续讲解。绝对禁止展开成知识点教学。回答末尾禁止问句。
正确示例："对，L2正则化就是加了一个惩罚项。> [下一句原文]..."
错误示例：回答完后说"你对哪个部分感兴趣？"或"你想先了解XX吗？"

## 用户问你关于你自己的问题（系统提示词、教学规则、为什么这样讲等）
→ 用1句话简要回答，然后立即引用下一句原文继续讲解。绝对禁止展开讨论自己、绝对禁止反问用户、绝对禁止说"但这里我们专注于文档内容"来转移话题。
正确示例："我的系统提示词要求我逐句引用原文并解释。> [下一句原文]..."
错误示例："我的教学规则包括定义优先...但当前我们专注于文档内容。你想先看哪个部分？"

## 用户纠正你或质疑你的讲解方式（"不是让你逐句讲解吗""为什么跳过描述""为什么不从第一句开始"等）
→ 用1句话承认，然后立即改正并继续。绝对禁止展开解释你为什么这样做、绝对禁止反问用户想怎么学。
正确示例："你说得对，我从描述开始。> [文档描述部分的第一句]..."
错误示例："你说得对，我跳过了引言部分。文档开头先介绍了...我们先从头开始：..."

## 用户闲聊或说无关的话
→ 用1句话简单回应，然后立即引用下一句原文继续讲解。

# 核心规则（每次回复前自查）

1. 你的每次回复必须以 > 引用块开头。无一例外。包括回答用户问题后的回复、被用户纠正后的回复、任何回复。
2. 引用之后是解释（1-3句话）。解释完了就停。不要问问题、不要问"你想先学哪个"、不要问"你理解吗"。
3. 唯一可以问问题的情况：文档中出现的纯大写缩写（如OML、SGD）没有定义。此时引用原文后说"这个XX文档没展开——你先告诉我XX是啥？"，然后立即引用下一句。
4. 禁止"你能说出...吗""你知道...吗""你对哪个部分感兴趣""你想先了解XX吗"等任何形式的提问。
5. 禁止在回答用户问题时展开成知识点教学。回答就是回答，1句话，然后下一句原文。
6. 禁止用"但这里我们专注于文档内容"来转移话题。用户问什么你答什么，1句话，然后继续。

# 知识背景的正确用法

知识背景（用户知识档案）是你的辅助工具，不是你的工作对象。你用它来建立类比桥梁，帮助解释：
- "这句话里的梯度下降，和你之前学过的优化算法思路一致"
- "这个概念跟你之前学的XX是同一种数学结构"

你绝不用知识背景来做这些事：
- 问"你之前学过XX，所以你知道YY吗？"
- 评估"你学过XX但还没接触过YY"
- 检查"你来回答一下ZZ是什么"

知识档案中的节点名称是用户自己起的标签。如果某个名称包含"作业""理解""临时""测试""随便""看看""笔记""草稿""试试""应付""搞定"等词汇，或听起来像任务描述而非知识主题，就不要引用它。

# 缩写处理

当讲解到文档中出现的纯大写缩写（如 OML、SGD），且文档本身没有给出完整定义时，不要猜测。引用包含缩写的原文后说："这句话里有个缩写XX，文档里没展开——你先告诉我XX是啥？"

# 数学公式

所有数学公式必须用 $...$ 或 $$...$$ 包裹，使用 LaTeX 语法。

# JSON回复格式

{
  "action": "explain",
  "message": "> [引自文档下一句的原文]\n\n[对这句话的解释]",
  "reason": "第N句，关于XXX"
}

结束时：
{
  "action": "end_explanation",
  "message": "[回顾要点的总结]",
  "reason": "讲解完毕"
}

# 何时结束

- 文档全部讲解完毕（所有句子都已引用并解释过）
- 用户说[好的][懂了][可以了][先这样吧][结束吧][就到这]等明确表达结束意图——注意："不用讲""跳过""不用"等词表示跳过当前展开继续下一句，**不是结束信号**
- 超过20轮且用户回应变短表现出疲劳"""


# ── Public API ───────────────────────────────────────────────────────

def start_chat(
    node_id: str,
    owner_id: str,
    node_name: str,
    reference_text: str = "",
    file_id: str = "",
    chat_mode: str = "",
    # Context chain parameters
    previous_node_id: str | None = None,
    transition_type: str = "initial",
    transition_reason: str = "",
    adaptive_opening: str = ""
) -> Dict[str, Any]:
    """Start a new Socratic chat. Multi-KP extraction when file_id is provided.

    chat_mode: "" (auto-detect), "line_by_line" (sequential file explanation)
    previous_node_id: the node user came from (for context chain tracking)
    transition_type: "navigation", "mark_concept", "return", or "initial"
    transition_reason: why the user navigated here
    adaptive_opening: pre-generated opening message (if empty, no special opening)
    """
    session_id = str(uuid4())

    if chat_mode == "line_by_line" and file_id:
        return _start_line_by_line(
            session_id, node_id, owner_id, file_id,
            previous_node_id=previous_node_id,
            transition_type=transition_type,
            transition_reason=transition_reason,
            adaptive_opening=adaptive_opening
        )

    # Try multi-KP extraction if file is provided
    knowledge_points = []
    if file_id:
        try:
            from file_knowledge_service import extract_knowledge_points
            result = extract_knowledge_points(file_id, owner_id)
            for group in result.get("groups", []):
                knowledge_points.extend(group.get("knowledge_points", []))
        except Exception:
            knowledge_points = []

    if knowledge_points:
        return _start_multi_kp(session_id, node_id, owner_id, file_id, knowledge_points)
    else:
        return _start_single_topic(
            session_id, node_id, owner_id, node_name, reference_text, file_id,
            previous_node_id=previous_node_id,
            transition_type=transition_type,
            transition_reason=transition_reason,
            adaptive_opening=adaptive_opening
        )


def _start_single_topic(
    session_id: str,
    node_id: str,
    owner_id: str,
    node_name: str,
    reference_text: str,
    file_id: str,
    previous_node_id: str | None = None,
    transition_type: str = "initial",
    transition_reason: str = "",
    adaptive_opening: str = ""
) -> Dict[str, Any]:
    """Start a single-topic Socratic chat with optional context chain awareness."""
    from context_chain_service import build_transition_context_text

    transition_ctx = build_transition_context_text(
        owner_id, node_id, previous_node_id, transition_type, transition_reason
    ) if previous_node_id or transition_type != "initial" else ""

    session = {
        "session_id": session_id,
        "node_id": node_id,
        "owner_id": owner_id,
        "file_id": file_id,
        "reference_text": reference_text,
        "knowledge_points": [{"id": "topic", "title": node_name, "type": "concept"}],
        "current_index": 0,
        "messages": [],
        "generated_content": "",
        "status": "active",
        "created_at": time.time(),
        "last_activity_at": time.time(),
        "follow_up_count": 0,
        "self_correction_count": 0,
        "uncertainty_count": 0,
        "pending_example": None,
        "example_history": [],
        "chat_mode": "single",
        "opening_message": adaptive_opening,
        "transition_context": transition_ctx,
        "previous_node_id": previous_node_id,
        "transition_reason": transition_reason,
    }

    full_reference = reference_text
    if file_id:
        full_reference = _read_uploaded_file(owner_id, file_id) or reference_text

    # Use adaptive opening if provided, otherwise fall back to default prompt
    if adaptive_opening:
        ai_message = adaptive_opening
        action = "question"
        sub_topic = ""
        knowledge_note = ""
    else:
        user_content = f"节点名称：{node_name}\n\n"
        if full_reference.strip():
            user_content += f"参考资料：\n{full_reference}\n\n"
            user_content += "请开始苏格拉底式对话。参考资料已经定义了这个主题，请直接从资料的具体内容出发提出第一个引导性问题。不要确认或质疑主题名称——直接开始教学。请严格按照系统提示的JSON格式回复。"
        else:
            user_content += "请开始苏格拉底式对话。先简要介绍这个主题（1-2句话），然后提出第一个引导性问题。请严格按照系统提示的JSON格式回复。"

        messages = [
            {"role": "system", "content": SINGLE_TOPIC_CHAT_SYSTEM},
            {"role": "user", "content": user_content}
        ]

        try:
            raw = call_deepseek(messages)
            result = parse_json_response(raw)
        except Exception as e:
            raise RuntimeError(f"启动对话失败：{str(e)}")

        ai_message = result.get("message", "")
        action = result.get("action", "question")
        sub_topic = result.get("sub_topic", "")
        knowledge_note = result.get("knowledge_note", "")

    session["messages"].append({
        "role": "ai",
        "content": ai_message,
        "timestamp": time.time(),
        "metadata": {"action": action, "sub_topic": sub_topic, "is_opening": True}
    })

    save_session(session)

    return {
        "session_id": session_id,
        "question": ai_message,
        "action": action,
        "sub_topic": sub_topic,
        "total_kp": 1,
        "current_kp_index": 0,
        "kp_title": node_name,
        "kp_type": "concept",
        "opening_message": adaptive_opening,
    }


def _start_multi_kp(
    session_id: str,
    node_id: str,
    owner_id: str,
    file_id: str,
    knowledge_points: list
) -> Dict[str, Any]:
    """Start a multi-KP conversation by generating the first question."""
    from file_knowledge_service import generate_question_for_knowledge_point

    session = {
        "session_id": session_id,
        "node_id": node_id,
        "owner_id": owner_id,
        "file_id": file_id,
        "knowledge_points": knowledge_points,
        "current_index": 0,
        "messages": [],
        "generated_content": "",
        "status": "active",
        "created_at": time.time(),
        "last_activity_at": time.time(),
        "follow_up_count": 0,
        "self_correction_count": 0,
        "uncertainty_count": 0,
        "pending_example": None,
        "example_history": [],
        "chat_mode": "multi_kp",
    }

    first_kp = knowledge_points[0]
    try:
        question_data = generate_question_for_knowledge_point(first_kp)
    except Exception as e:
        raise RuntimeError(f"生成第一个问题失败：{str(e)}")

    session["messages"].append({
        "role": "ai",
        "content": question_data["question"],
        "timestamp": time.time(),
        "metadata": {
            "kp_id": first_kp["id"],
            "hints": question_data.get("hints", []),
        }
    })

    save_session(session)

    return {
        "session_id": session_id,
        "question": question_data["question"],
        "hints": question_data.get("hints", []),
        "action": "question",
        "sub_topic": first_kp.get("title", ""),
        "total_kp": len(knowledge_points),
        "current_kp_index": 0,
        "kp_title": first_kp.get("title", ""),
        "kp_type": first_kp.get("type", ""),
        "kp_data": {
            "source_content": first_kp.get("source_content", ""),
            "correct_definition": first_kp.get("correct_definition", ""),
            "key_example": first_kp.get("key_example", ""),
        },
    }


def _start_line_by_line(
    session_id: str,
    node_id: str,
    owner_id: str,
    file_id: str,
    previous_node_id: str | None = None,
    transition_type: str = "initial",
    transition_reason: str = "",
    adaptive_opening: str = ""
) -> Dict[str, Any]:
    """Start a line-by-line explanation chat for a file, with context chain awareness."""
    full_text = _read_uploaded_file(owner_id, file_id) or ""
    node_name = _get_node_name(node_id)

    # Pre-split document into segments for code-tracked position
    doc_segments = split_document(full_text)

    from context_chain_service import build_transition_context_text

    transition_ctx = build_transition_context_text(
        owner_id, node_id, previous_node_id, transition_type, transition_reason
    ) if previous_node_id or transition_type != "initial" else ""

    session = {
        "session_id": session_id,
        "node_id": node_id,
        "owner_id": owner_id,
        "file_id": file_id,
        "knowledge_points": [{"id": "file", "title": node_name or "文件讲解", "type": "concept", "source_content": full_text}],
        "current_index": 0,
        "messages": [],
        "generated_content": "",
        "status": "active",
        "created_at": time.time(),
        "last_activity_at": time.time(),
        "follow_up_count": 0,
        "self_correction_count": 0,
        "uncertainty_count": 0,
        "pending_example": None,
        "example_history": [],
        "chat_mode": "line_by_line",
        "opening_message": adaptive_opening,
        "transition_context": transition_ctx,
        "previous_node_id": previous_node_id,
        "transition_reason": transition_reason,
        "doc_segments": doc_segments,
        "current_position": 0,
    }

    # Build narrow prompt: the AI only needs to explain the first segment.
    # Code tracks position — AI never needs to find it.
    first_segment = get_current_segment(session)
    progress = get_progress_context(session)

    user_lines = []
    user_lines.append(f"【逐句讲解】{progress}")
    user_lines.append(f"请解释下面这句话：\n\n{first_segment}")
    user_lines.append("\n提示：用 > 引用原文，然后1-3句话解释。不要问问题，不要做整体概述。")

    # Build knowledge-aware prompt for the AI
    profile = build_knowledge_profile(owner_id, node_id)
    if profile:
        user_lines.insert(1, profile)
        user_lines.insert(2, "知识背景供你解释时建立类比用。记住：引用原文→解释，不要提问。")
    if transition_ctx:
        user_lines.insert(1, f"【用户跳转背景】{transition_ctx}")

    # Adaptive opening as passive context only
    if adaptive_opening:
        user_lines.insert(1, f"【用户背景（仅供了解，不要在你的回复中提及）】{adaptive_opening}")

    messages = [
        {"role": "system", "content": LINE_BY_LINE_SYSTEM},
        {"role": "user", "content": "\n".join(user_lines)}
    ]

    try:
        raw = call_deepseek(messages)
        result = parse_json_response(raw)
    except Exception as e:
        raise RuntimeError(f"启动逐句讲解失败：{str(e)}")

    ai_message = result.get("message", "")
    action = result.get("action", "explain")
    reason = result.get("reason", "")

    session["messages"].append({
        "role": "ai",
        "content": ai_message,
        "timestamp": time.time(),
        "metadata": {"action": action, "reason": reason, "is_opening": bool(adaptive_opening)}
    })

    save_session(session)

    return {
        "session_id": session_id,
        "question": ai_message,
        "action": action,
        "sub_topic": node_name or "",
        "total_kp": 1,
        "current_kp_index": 0,
        "opening_message": "",  # LINE_BY_LINE_SYSTEM handles the first message
    }


def process_chat_turn(
    session_id: str,
    user_answer: str,
    skip: bool = False
) -> Dict[str, Any]:
    """Process one turn of a chat. Dispatches to single-topic, multi-KP, or line-by-line handler."""
    session = load_session(session_id)
    if not session:
        raise ValueError(f"Session not found: {session_id}")

    session["last_activity_at"] = time.time()

    # Classify user intent (rule-based primary, LLM fallback for ambiguous)
    if skip:
        intent = "skip_request"
    else:
        chat_mode = session.get("chat_mode", "single")
        intent = classify_intent(user_answer, chat_mode)

    if session.get("chat_mode") == "line_by_line":
        from handler_router import route_and_handle
        # Detect tone and knowledge gaps
        tone = detect_tone(session)
        gap_warning = ""
        if should_check_gaps(session):
            gap_result = detect_gaps(session["owner_id"], session["node_id"])
            gap_warning = format_gap_warning(gap_result)
            session["last_gap_check_turn"] = sum(1 for m in session["messages"] if m["role"] == "user")
        result = route_and_handle(session, user_answer, intent, tone, gap_warning)
        if result.get("_routed") is False:
            # Fall back to legacy handler
            return _process_line_by_line_turn(session, user_answer, skip, intent)
        save_session(session)
        return result
    elif session.get("chat_mode") == "multi_kp":
        return _process_multi_kp_turn(session, user_answer, skip, intent)
    else:
        return _process_single_topic_turn(session, user_answer, skip, intent)


MAX_FOLLOW_UPS = 3
MAX_TOTAL_TURNS = 15


def _process_single_topic_turn(
    session: dict,
    user_answer: str,
    skip: bool,
    intent: str = "content_question"
) -> Dict[str, Any]:
    """Process one turn of a single-topic Socratic chat."""
    user_turn_count = sum(1 for m in session["messages"] if m["role"] == "user") + 1

    # Add user message
    session["messages"].append({
        "role": "user",
        "content": user_answer,
        "timestamp": time.time(),
    })

    # Fetch existing note content tail for dedup and style matching
    existing_content_tail = _get_node_content_tail(session["node_id"], session["owner_id"])

    if skip:
        # Check turn limit safety on skip too
        if user_turn_count >= MAX_TOTAL_TURNS:
            session["status"] = "completed"
            session["messages"].append({
                "role": "ai",
                "content": "我们已经聊了不少了，让我总结一下。感谢你的参与，你可以随时回顾生成的笔记内容！",
                "timestamp": time.time(),
                "metadata": {"action": "end_conversation"}
            })
            save_session(session)
            return {
                "action": "end_conversation",
                "ai_message": session["messages"][-1]["content"],
                "sub_topic": "",
                "generated_content": "",
                "total_kp": 1,
                "current_kp_index": 0,
                "completed": True,
                "total_content": session["generated_content"],
            }

        session["messages"].append({
            "role": "ai",
            "content": "好的，我们换一个角度。",
            "timestamp": time.time(),
            "metadata": {"action": "skip"}
        })
        eval_messages = [
            {"role": "system", "content": SINGLE_TOPIC_CHAT_SYSTEM},
            {"role": "user", "content": _build_conversation_context(session, session["owner_id"], session["node_id"], existing_content_tail) + "\n\n用户选择跳过当前问题。请换一个角度提出新的引导性问题。请严格按照系统提示的JSON格式回复。"}
        ]
        try:
            raw = call_deepseek(eval_messages)
            result = parse_json_response(raw)
        except Exception as e:
            raise RuntimeError(f"对话处理失败：{str(e)}")

        ai_message = result.get("message", "")
        session["messages"][-1] = {
            "role": "ai",
            "content": ai_message,
            "timestamp": time.time(),
            "metadata": {"action": "question", "sub_topic": result.get("sub_topic", "")}
        }
        save_session(session)
        return {
            "action": "question",
            "ai_message": ai_message,
            "sub_topic": result.get("sub_topic", ""),
            "generated_content": "",
            "knowledge_note": result.get("knowledge_note", ""),
            "total_kp": 1,
            "current_kp_index": 0,
            "completed": False,
        }

    # Evaluate user's answer
    eval_messages = [
        {"role": "system", "content": SINGLE_TOPIC_CHAT_SYSTEM},
        {"role": "user", "content": _build_conversation_context(session, session["owner_id"], session["node_id"], existing_content_tail) + f"\n\n用户刚才的回答：{user_answer}\n\n请评估用户的回答，选择动作并回复。请严格按照系统提示的JSON格式回复。"}
    ]

    try:
        raw = call_deepseek(eval_messages)
        result = parse_json_response(raw)
    except Exception as e:
        raise RuntimeError(f"对话处理失败：{str(e)}")

    action = result.get("action", "follow_up")
    ai_message = result.get("message", "")
    generated_content = result.get("generated_content", "")
    knowledge_note = result.get("knowledge_note", "")

    # Track follow_up count for code-level safety
    if action in ("follow_up", "hint"):
        session["follow_up_count"] = session.get("follow_up_count", 0) + 1

    # Code-level safety: force-end if limits exceeded
    if session.get("follow_up_count", 0) > MAX_FOLLOW_UPS:
        action = "end_conversation"
        ai_message = ai_message or "我们已经探讨了不少，让我为你做个总结吧。"
    elif user_turn_count >= MAX_TOTAL_TURNS:
        action = "end_conversation"
        ai_message = ai_message or "我们已经聊了很多了，让我总结一下关键要点。"

    session["messages"].append({
        "role": "ai",
        "content": ai_message,
        "timestamp": time.time(),
        "metadata": {"action": action, "sub_topic": result.get("sub_topic", ""), "knowledge_note": knowledge_note}
    })

    # Store generated content (for accept action)
    if generated_content:
        if session["generated_content"]:
            session["generated_content"] += "\n\n"
        sub_topic = result.get("sub_topic", "")
        if sub_topic:
            session["generated_content"] += f"## {sub_topic}\n\n{generated_content}"
        else:
            session["generated_content"] += generated_content

    # Handle conversation-ending actions
    if action in ("end_conversation", "summarize_and_move_on"):
        session["status"] = "completed"
        save_session(session)

        # Consolidate knowledge notes into a clean, deduplicated document
        consolidated = ""
        try:
            node_name = ""
            kps = session.get("knowledge_points", [])
            if kps:
                node_name = kps[0].get("title", "")
            ref_text = session.get("reference_text", "")
            file_id = session.get("file_id", "")
            oid = session.get("owner_id", "")
            if file_id and not ref_text:
                ref_text = _read_uploaded_file(oid, file_id) or ""
            consolidated = consolidate_knowledge_content(
                messages=session["messages"],
                node_name=node_name,
                reference_text=ref_text,
                existing_content=existing_content_tail,
            )
        except Exception:
            pass

        return {
            "action": "end_conversation",
            "ai_message": ai_message,
            "generated_content": generated_content,
            "knowledge_note": knowledge_note,
            "sub_topic": result.get("sub_topic", ""),
            "total_kp": 1,
            "current_kp_index": 0,
            "completed": True,
            "total_content": session["generated_content"],
            "consolidated_content": consolidated,
        }

    save_session(session)

    return {
        "action": action,
        "ai_message": ai_message,
        "generated_content": generated_content,
        "knowledge_note": knowledge_note,
        "sub_topic": result.get("sub_topic", ""),
        "total_kp": 1,
        "current_kp_index": 0,
        "completed": False,
    }


def _process_multi_kp_turn(
    session: dict,
    user_answer: str,
    skip: bool,
    intent: str = "content_question"
) -> Dict[str, Any]:
    """Process one turn of a multi-KP conversation."""
    from file_knowledge_service import (
        evaluate_user_answer,
        generate_content_from_answer,
        generate_question_for_knowledge_point,
    )

    knowledge_points = session["knowledge_points"]
    current_index = session["current_index"]
    current_kp = knowledge_points[current_index]

    # Add user message
    session["messages"].append({
        "role": "user",
        "content": user_answer,
        "timestamp": time.time(),
    })

    # Handle skip
    if skip:
        session["current_index"] += 1
        session["follow_up_count"] = 0

        if session["current_index"] >= len(knowledge_points):
            session["status"] = "completed"
            save_session(session)
            return _make_multi_kp_response(session, "completed", "所有知识点已完成！",
                                           generated_content=session["generated_content"],
                                           completed=True)

        next_kp = knowledge_points[session["current_index"]]
        question_data = generate_question_for_knowledge_point(next_kp)
        session["messages"].append({
            "role": "ai",
            "content": question_data["question"],
            "timestamp": time.time(),
            "metadata": {"kp_id": next_kp["id"], "hints": question_data.get("hints", [])}
        })
        save_session(session)
        return _make_multi_kp_response(session, "next_question", question_data["question"],
                                       hints=question_data.get("hints", []))

    # Find the last question for this KP
    last_question = None
    for msg in reversed(session["messages"]):
        if msg["role"] == "ai" and msg.get("metadata", {}).get("kp_id") == current_kp["id"]:
            last_question = msg["content"]
            break

    # Evaluate user's answer
    evaluation = evaluate_user_answer(
        current_kp,
        last_question or "",
        user_answer,
        session["follow_up_count"]
    )

    action = evaluation["action"]
    ai_message = evaluation["next_message"]

    session["messages"].append({
        "role": "ai",
        "content": ai_message,
        "timestamp": time.time(),
        "metadata": {"action": action, "reason": evaluation.get("reason", "")}
    })

    # Actions that move to the next KP
    if action in ("accept", "summarize_and_move_on"):
        # Generate content for this KP
        kp_messages = _get_kp_messages(session, current_kp["id"])
        generated_content = generate_content_from_answer(
            current_kp,
            last_question or "",
            user_answer,
            kp_messages
        )

        # Append to accumulated content
        if session["generated_content"]:
            session["generated_content"] += "\n\n---\n\n"
        session["generated_content"] += f"## {current_kp['title']}\n\n{generated_content}"

        # Enrich acceptance message with key example
        if action == "accept" and current_kp.get('key_example') and current_kp['key_example'] not in ai_message:
            ai_message += f"\n\n举个具体例子：{current_kp['key_example']}"
            session["messages"][-1]["content"] = ai_message

        # Move to next KP
        session["current_index"] += 1
        session["follow_up_count"] = 0

        if session["current_index"] >= len(knowledge_points):
            session["status"] = "completed"
            save_session(session)
            return _make_multi_kp_response(session, "completed", ai_message,
                                           generated_content=generated_content,
                                           total_content=session["generated_content"],
                                           completed=True)

        next_kp = knowledge_points[session["current_index"]]
        question_data = generate_question_for_knowledge_point(next_kp)
        session["messages"].append({
            "role": "ai",
            "content": question_data["question"],
            "timestamp": time.time(),
            "metadata": {"kp_id": next_kp["id"], "hints": question_data.get("hints", [])}
        })

        save_session(session)
        return _make_multi_kp_response(session, "accept_and_next", ai_message,
                                       generated_content=generated_content,
                                       next_question=question_data["question"],
                                       hints=question_data.get("hints", []))

    elif action in ("follow_up", "progressive_hint"):
        session["follow_up_count"] += 1
        save_session(session)
        return _make_multi_kp_response(session, "follow_up", ai_message)

    elif action == "hint":
        save_session(session)
        return _make_multi_kp_response(session, "hint", ai_message)

    elif action == "show_source":
        save_session(session)
        return _make_multi_kp_response(session, "show_source", ai_message)

    elif action == "correct_self":
        session["self_correction_count"] += 1
        if session["self_correction_count"] > 2:
            # Force move to next KP
            session["current_index"] += 1
            session["follow_up_count"] = 0
            session["self_correction_count"] = 0
            if session["current_index"] >= len(knowledge_points):
                session["status"] = "completed"
                save_session(session)
                return _make_multi_kp_response(session, "completed",
                                               ai_message + "\n\n（已自动跳过，让我们继续下一个知识点。）",
                                               completed=True)
            next_kp = knowledge_points[session["current_index"]]
            question_data = generate_question_for_knowledge_point(next_kp)
            session["messages"].append({
                "role": "ai",
                "content": question_data["question"],
                "timestamp": time.time(),
                "metadata": {"kp_id": next_kp["id"], "hints": question_data.get("hints", [])}
            })
            save_session(session)
            return _make_multi_kp_response(session, "accept_and_next", ai_message,
                                           next_question=question_data["question"],
                                           hints=question_data.get("hints", []))
        save_session(session)
        return _make_multi_kp_response(session, "correct_self", ai_message)

    elif action == "admit_uncertainty":
        session["uncertainty_count"] += 1
        save_session(session)
        return _make_multi_kp_response(session, "admit_uncertainty", ai_message,
                                       can_skip=session["uncertainty_count"] >= 1)

    save_session(session)
    return _make_multi_kp_response(session, "unknown", ai_message)


MAX_LINE_BY_LINE_TURNS = 30


def _process_line_by_line_turn(
    session: dict,
    user_answer: str,
    skip: bool,
    intent: str = "content_question"
) -> Dict[str, Any]:
    """Process one turn of a line-by-line explanation chat.

    Code tracks position — AI never needs to find where it left off.
    The AI is given the exact current segment to explain.
    """
    user_turn_count = sum(1 for m in session["messages"] if m["role"] == "user") + 1

    session["messages"].append({
        "role": "user",
        "content": user_answer,
        "timestamp": time.time(),
    })

    # ── Handle skip: advance position, explain next segment ──────────
    if skip or intent in ("skip_request", "confirmation"):
        # Advance to next segment
        if skip or intent == "skip_request":
            advance_position(session)  # skip = advance without explaining current
        # For confirmation ("嗯", "继续"), we advance and explain the next

        has_more = advance_position(session) if intent != "skip_request" else True
        if not has_more or not get_current_segment(session):
            return _end_line_by_line(session, "文档已经讲解完毕。")

        current_segment = get_current_segment(session)
        progress = get_progress_context(session)

        context_lines = [
            f"【逐句讲解】{progress}",
            f"请解释下面这句话：\n\n{current_segment}",
            "\n提示：用 > 引用原文，然后1-3句话解释。不要问问题。",
        ]
        # Inject knowledge profile for analogy building
        oid = session.get("owner_id", "")
        nid = session.get("node_id", "")
        if oid and nid:
            profile = build_knowledge_profile(oid, nid)
            if profile:
                context_lines.insert(1, profile)
                context_lines.insert(2, "知识背景供你解释时建立类比用。引用原文→解释。不要提问。")

        # Last 3 messages for continuity
        recent = session["messages"][-6:]
        if recent:
            context_lines.append("\n最近对话：")
            for msg in recent:
                role_label = "AI" if msg["role"] == "ai" else "用户"
                context_lines.append(f"{role_label}: {msg['content']}")

        # Safety: force end if too many turns
        if user_turn_count >= MAX_LINE_BY_LINE_TURNS:
            return _end_line_by_line(session, "已经讲解了很多内容，今天就到这里吧。")

        eval_messages = [
            {"role": "system", "content": LINE_BY_LINE_SYSTEM},
            {"role": "user", "content": "\n".join(context_lines)}
        ]

        try:
            raw = call_deepseek(eval_messages)
            result = parse_json_response(raw)
        except Exception as e:
            raise RuntimeError(f"讲解处理失败：{str(e)}")

        ai_message = result.get("message", "")
        action = result.get("action", "explain")

        session["messages"].append({
            "role": "ai",
            "content": ai_message,
            "timestamp": time.time(),
            "metadata": {"action": action, "reason": result.get("reason", "")}
        })

        save_session(session)
        return {
            "action": action,
            "ai_message": ai_message,
            "sub_topic": result.get("reason", ""),
            "generated_content": "",
            "knowledge_note": "",
            "total_kp": 1,
            "current_kp_index": 0,
            "completed": action == "end_explanation",
        }

    # ── Handle end request ────────────────────────────────────────────
    if intent == "end_request":
        return _end_line_by_line(session, "好的，讲解到这里。你可以随时回来继续。")

    # ── Handle content question / meta / correction / chitchat ────────
    # Answer the user's question briefly, then explain the current segment
    current_segment = get_current_segment(session)
    progress = get_progress_context(session)

    context_lines = [
        f"【逐句讲解】{progress}",
        f"当前要讲解的句子：\n\n{current_segment}",
        f"\n用户说：{user_answer}",
    ]

    if intent == "content_question":
        context_lines.append("\n请用1句话回答用户的问题，然后立即引用并解释上面这句话。不要反问用户。")
    elif intent == "meta_question":
        context_lines.append("\n请用1句话简短回答（关于你自己的问题），然后立即引用并解释上面这句话。绝对不要展开讨论你自己。")
    elif intent == "correction":
        context_lines.append("\n用户纠正了你。用1句话承认错误，然后立即引用并解释上面这句话。")
    else:
        context_lines.append("\n请用1句话回应，然后立即引用并解释上面这句话。")

    # Inject knowledge profile
    oid = session.get("owner_id", "")
    nid = session.get("node_id", "")
    if oid and nid:
        profile = build_knowledge_profile(oid, nid)
        if profile:
            context_lines.insert(1, profile)
            context_lines.insert(2, "知识背景供你解释时建立类比用。")

    # Last 3 messages for continuity
    recent = session["messages"][-6:]
    if recent:
        context_lines.append("\n最近对话：")
        for msg in recent:
            role_label = "AI" if msg["role"] == "ai" else "用户"
            context_lines.append(f"{role_label}: {msg['content']}")

    # Safety
    if user_turn_count >= MAX_LINE_BY_LINE_TURNS:
        return _end_line_by_line(session, "已经讲解了很多内容，今天就到这里吧。")

    eval_messages = [
        {"role": "system", "content": LINE_BY_LINE_SYSTEM},
        {"role": "user", "content": "\n".join(context_lines)}
    ]

    try:
        raw = call_deepseek(eval_messages)
        result = parse_json_response(raw)
    except Exception as e:
        raise RuntimeError(f"讲解处理失败：{str(e)}")

    ai_message = result.get("message", "")
    action = result.get("action", "explain")

    session["messages"].append({
        "role": "ai",
        "content": ai_message,
        "timestamp": time.time(),
        "metadata": {"action": action, "reason": result.get("reason", "")}
    })

    # Advance position after AI explains
    if not advance_position(session):
        action = "end_explanation"
        session["status"] = "completed"

    save_session(session)
    return {
        "action": action,
        "ai_message": ai_message,
        "sub_topic": result.get("reason", ""),
        "generated_content": "",
        "knowledge_note": "",
        "total_kp": 1,
        "current_kp_index": 0,
        "completed": action == "end_explanation",
    }


def _end_line_by_line(session: dict, message: str) -> Dict[str, Any]:
    """End a line-by-line explanation chat."""
    session["status"] = "completed"
    session["messages"].append({
        "role": "ai",
        "content": message,
        "timestamp": time.time(),
        "metadata": {"action": "end_explanation"}
    })
    save_session(session)
    return {
        "action": "end_explanation",
        "ai_message": message,
        "sub_topic": "",
        "generated_content": "",
        "knowledge_note": "",
        "total_kp": 1,
        "current_kp_index": 0,
        "completed": True,
    }


def _get_node_name(node_id: str) -> str:
    """Get the name of a node by its ID."""
    try:
        with get_db_ctx() as conn:
            row = conn.execute(
                "SELECT name FROM nodes WHERE id = ? AND is_deleted = 0",
                (node_id,),
            ).fetchone()
        return row["name"] if row else ""
    except Exception:
        return ""


def _get_kp_messages(session: dict, kp_id: str) -> list:
    """Get conversation messages relevant to a specific knowledge point."""
    kp_messages = []
    for msg in session["messages"]:
        if msg.get("metadata", {}).get("kp_id") == kp_id:
            kp_messages.append(msg)
        elif msg["role"] == "user":
            # Include user messages that come after the KP's AI messages
            if kp_messages:
                kp_messages.append(msg)
    return kp_messages


def _make_multi_kp_response(
    session: dict,
    action: str,
    ai_message: str,
    generated_content: str = "",
    total_content: str = "",
    next_question: str = "",
    hints: list | None = None,
    completed: bool = False,
    can_skip: bool = False,
    knowledge_note: str = ""
) -> Dict[str, Any]:
    """Build a response dict for multi-KP mode with progress info."""
    knowledge_points = session["knowledge_points"]
    current_index = session["current_index"]
    current_kp = knowledge_points[current_index] if current_index < len(knowledge_points) else {}

    result: Dict[str, Any] = {
        "action": action,
        "ai_message": ai_message,
        "generated_content": generated_content,
        "knowledge_note": knowledge_note,
        "total_kp": len(knowledge_points),
        "current_kp_index": current_index,
        "kp_title": current_kp.get("title", ""),
        "kp_type": current_kp.get("type", ""),
        "kp_data": {
            "source_content": current_kp.get("source_content", ""),
            "correct_definition": current_kp.get("correct_definition", ""),
            "key_example": current_kp.get("key_example", ""),
        } if current_kp else None,
    }
    if total_content:
        result["total_content"] = total_content
    if next_question:
        result["next_question"] = next_question
    if hints:
        result["hints"] = hints
    if completed:
        result["completed"] = True
    if can_skip:
        result["can_skip"] = can_skip
    return result


def regenerate_with_tree_context(
    session_id: str,
    tree_context: str
) -> Dict[str, Any]:
    """Regenerate the last AI message using current knowledge tree as context."""
    session = load_session(session_id)
    if not session:
        raise ValueError(f"Session not found: {session_id}")

    session["last_activity_at"] = time.time()

    if not session["messages"]:
        raise ValueError("No messages to regenerate")

    # Remove the last AI message
    last_ai_idx = None
    for i in range(len(session["messages"]) - 1, -1, -1):
        if session["messages"][i]["role"] == "ai":
            last_ai_idx = i
            break

    if last_ai_idx is None:
        raise ValueError("No AI message to regenerate")

    # Keep messages up to (but not including) the last AI message
    kept_messages = session["messages"][:last_ai_idx]
    removed_message = session["messages"][last_ai_idx]

    eval_messages = [
        {"role": "system", "content": SINGLE_TOPIC_CHAT_SYSTEM},
        {"role": "user", "content": _build_conversation_context({**session, "messages": kept_messages}, session["owner_id"], session["node_id"]) +
            f"\n\n请根据上面的知识档案重新生成你刚才的回复。利用知识档案中的信息来关联用户已知的概念，"
            f"用用户已掌握的知识来类比或对比当前主题。如果知识档案中有相关的前置知识，提到它们。"
            f"保持与之前相同的对话节奏。请严格按照系统提示的JSON格式回复。"}
    ]

    try:
        raw = call_deepseek(eval_messages)
        result = parse_json_response(raw)
    except Exception as e:
        raise RuntimeError(f"重新生成失败：{str(e)}")

    action = result.get("action", "question")
    ai_message = result.get("message", "")
    generated_content = result.get("generated_content", "")

    # Replace the old AI message
    session["messages"][last_ai_idx] = {
        "role": "ai",
        "content": ai_message,
        "timestamp": time.time(),
        "metadata": {"action": action, "sub_topic": result.get("sub_topic", ""), "regenerated": True}
    }

    # If the removed message had generated content, remove it from accumulated
    # (simplification: only regenerate the message, don't touch accumulated content)

    save_session(session)

    return {
        "action": action,
        "ai_message": ai_message,
        "generated_content": generated_content,
        "knowledge_note": result.get("knowledge_note", ""),
        "sub_topic": result.get("sub_topic", ""),
    }


def mark_concept_node(
    session_id: str,
    concept_name: str,
    owner_id: str
) -> Dict[str, Any]:
    """Create a child node for a concept marked during chat."""
    session = load_session(session_id)
    if not session:
        raise ValueError(f"Session not found: {session_id}")

    session["last_activity_at"] = time.time()
    parent_id = session["node_id"]
    child_id = str(uuid4())

    with get_db_ctx() as conn:
        # Get parent's depth and owner
        parent = conn.execute(
            "SELECT depth, owner_id FROM nodes WHERE id = ? AND is_deleted = 0",
            (parent_id,)
        ).fetchone()
        if not parent:
            raise ValueError("Parent node not found")

        now = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())

        # Create child node
        conn.execute(
            """INSERT INTO nodes (id, owner_id, name, content, parent_id, depth, sort_order, created_at, updated_at)
               VALUES (?, ?, ?, '', ?, ?, 0, ?, ?)""",
            (child_id, owner_id, concept_name, parent_id, parent["depth"] + 1, now, now)
        )

        # Create edge
        conn.execute(
            "INSERT INTO edges (parent_id, child_id, sort_order) VALUES (?, ?, 0)",
            (parent_id, child_id)
        )

    # Add a note to the chat
    session["messages"].append({
        "role": "ai",
        "content": f"已创建子节点「{concept_name}」。你可以随时离开去学习它，回来时我会根据你的知识树更新解释。",
        "timestamp": time.time(),
        "metadata": {"action": "concept_marked", "concept_name": concept_name, "node_id": child_id}
    })

    save_session(session)

    # Record transition for context chain
    try:
        from context_chain_service import record_transition
        parent_name = _get_node_name(parent_id) or "未知"
        record_transition(
            owner_id=owner_id,
            from_node_id=parent_id,
            to_node_id=child_id,
            transition_type="mark_concept",
            reason=f"在学习「{parent_name}」时标记了概念「{concept_name}」",
            session_id=session_id
        )
    except Exception:
        pass

    result: Dict[str, Any] = {
        "node_id": child_id,
        "name": concept_name,
        "parent_id": parent_id,
    }

    # Warn if the concept name looks like an undefined abbreviation
    warning = detect_abbreviation_name(concept_name)
    if warning:
        result["warning"] = warning
        # Append a hint to the chat message
        session["messages"][-1]["content"] += f"\n\n{warning}"
        save_session(session)

    return result


def get_chat_session(session_id: str, owner_id: str) -> Dict[str, Any]:
    """Get full chat session state for resume, with ownership validation."""
    session = load_session(session_id)
    if not session:
        raise ValueError(f"Session not found: {session_id}")
    if session["owner_id"] != owner_id:
        raise PermissionError("无权访问此会话")

    session["last_activity_at"] = time.time()

    knowledge_points = session.get("knowledge_points", [])
    current_index = session.get("current_index", 0)
    current_kp = knowledge_points[current_index] if current_index < len(knowledge_points) else {}

    return {
        "session_id": session["session_id"],
        "node_id": session["node_id"],
        "file_id": session["file_id"],
        "messages": session["messages"],
        "generated_content": session["generated_content"],
        "status": session["status"],
        "created_at": session["created_at"],
        "last_activity_at": session["last_activity_at"],
        "total_kp": len(knowledge_points),
        "current_kp_index": current_index,
        "kp_title": current_kp.get("title", ""),
        "kp_type": current_kp.get("type", ""),
        "kp_data": {
            "source_content": current_kp.get("source_content", ""),
            "correct_definition": current_kp.get("correct_definition", ""),
            "key_example": current_kp.get("key_example", ""),
        } if current_kp else None,
        "opening_message": session.get("opening_message", ""),
        "previous_node_id": session.get("previous_node_id"),
        "transition_reason": session.get("transition_reason", ""),
    }


def get_active_session_by_node(node_id: str, owner_id: str) -> str | None:
    """Return the session_id of the most recent active session for a node, or None."""
    with get_db_ctx() as conn:
        row = conn.execute(
            """SELECT id FROM conversation_sessions
               WHERE node_id = ? AND owner_id = ? AND status = 'active'
               ORDER BY last_activity_at DESC LIMIT 1""",
            (node_id, owner_id),
        ).fetchone()
    return row["id"] if row else None


def end_chat(session_id: str) -> Dict[str, Any]:
    """Manually end a chat session (user-initiated). Generates a learning snapshot.
    Idempotent: if already completed, returns existing state without modification."""
    session = load_session(session_id)
    if not session:
        raise ValueError(f"Session not found: {session_id}")

    already_completed = session.get("status") == "completed"

    if not already_completed:
        session["status"] = "completed"
        session["last_activity_at"] = time.time()

        session["messages"].append({
            "role": "ai",
            "content": "对话已结束。你对这个主题已经有了很好的理解！你可以随时回顾我们生成的笔记内容。",
            "timestamp": time.time(),
            "metadata": {"action": "end_conversation"}
        })

        save_session(session)

    # Generate learning snapshot (skip if already completed)
    if not already_completed:
        try:
            from context_chain_service import generate_learning_summary, record_learning_snapshot
            node_name = ""
            kps = session.get("knowledge_points", [])
            if kps:
                node_name = kps[0].get("title", "")
            summary = generate_learning_summary(session["messages"], node_name)
            record_learning_snapshot(
                owner_id=session["owner_id"],
                node_id=session["node_id"],
                session_id=session_id,
                learned_concepts=summary.get("learned_concepts", ""),
                mastery_changes=summary.get("mastery_changes", []),
                knowledge_notes=summary.get("knowledge_notes", ""),
            )
        except Exception:
            pass

    total_kp = len(session.get("knowledge_points", [1]))

    # Consolidate knowledge notes into a clean, deduplicated document
    # Run consolidation even if already completed, in case previous attempt was empty
    consolidated_content = ""
    if not already_completed:
        try:
            node_name = ""
            kps = session.get("knowledge_points", [])
            if kps:
                node_name = kps[0].get("title", "")
            reference_text = session.get("reference_text", "")
            file_id = session.get("file_id", "")
            oid = session.get("owner_id", "")
            if file_id and not reference_text:
                reference_text = _read_uploaded_file(oid, file_id) or ""
            existing = _get_node_content_tail(
                session["node_id"], oid, tail_chars=3000
            )
            consolidated_content = consolidate_knowledge_content(
                messages=session["messages"],
                node_name=node_name,
                reference_text=reference_text,
                existing_content=existing,
            )
        except Exception:
            pass

    return {
        "action": "end_conversation",
        "ai_message": session["messages"][-1]["content"],
        "completed": True,
        "total_content": session["generated_content"],
        "total_kp": total_kp,
        "current_kp_index": session.get("current_index", 0),
        "consolidated_content": consolidated_content,
    }


# ── Knowledge Consolidation ──────────────────────────────────────────

CONSOLIDATE_KNOWLEDGE_SYSTEM = """你是一个知识整理专家。你的任务是将对话中生成的知识笔记片段合并成一份干净、无重复、结构清晰的知识文档。

# 输入

你会收到：
1. 对话中累积的知识笔记（可能包含重复、渐进修正、碎片化表述）
2. 参考资料原文（如果有）
3. 对话主题名称

# 你的任务

将这些碎片化的知识笔记整合成一份完整的知识文档。

# 整理规则

1. **去重合并**：同一个概念可能被记录了多次（初次记录、补充修正、换表述重述），只保留最准确、最完整的版本。如果两段说的是一件事，合并它们，不要各留一份。
2. **渐进修正优先**：如果同一概念有多条记录，保留对话后期修正后的版本。后续修正的版本比初始版本更准确。
3. **删除元对话**：删除"AI问"、"用户答"、"我们讨论了"等对话过程描述，只保留知识内容本身。
4. **结构化组织**：用 ## 标题按知识点分组。一组相关概念放在一起。按照从基础到进阶的逻辑顺序排列。
5. **保留学习者口吻**：用学习者自己的表述（从对话中提取），不改写成教科书语气。
6. **公式完整准确**：保留对话中确认过的公式，用 $...$ 或 $$...$$ 格式。禁止脑补未确认的公式。
7. **保留关键例子**：对话中如果出现了有助于理解的具体例子，保留它。
8. **紧凑无废话**：删除过渡句、重复定义，同一概念只说一次。整体篇幅控制在合理范围内。

# 输出格式

返回JSON：{"content": "整理后的Markdown知识文档"}
content字段中是整理后的完整知识文档，用 ## 标题分组，按逻辑顺序排列。不要加"整理后""以下是整理结果"等引导语。"""


def consolidate_knowledge_content(
    messages: list,
    node_name: str = "",
    reference_text: str = "",
    existing_content: str = "",
) -> str:
    """Merge accumulated knowledge notes into a clean, deduplicated document via LLM."""
    # Build the knowledge fragments from messages
    fragments: list[str] = []
    for m in messages:
        meta = m.get("metadata", {})
        note = ""
        if isinstance(meta, dict):
            note = meta.get("knowledge_note", "")
        if note and note.strip():
            fragments.append(note.strip())

    if not fragments:
        # No knowledge notes to consolidate
        return ""

    # Build conversation-derived knowledge for the LLM
    knowledge_text = "\n\n---\n\n".join(
        f"[片段{i + 1}] {f}" for i, f in enumerate(fragments)
    )

    context_parts = [f"当前主题：{node_name}"]
    if reference_text.strip():
        # Truncate reference to reasonable length for consolidation
        ref = reference_text.strip()
        if len(ref) > 6000:
            ref = ref[:6000] + "\n...(参考资料过长，已截断)"
        context_parts.append(f"\n【参考资料】\n{ref}")
    if existing_content.strip():
        existing = existing_content.strip()
        if len(existing) > 3000:
            existing = existing[-3000:]
        context_parts.append(f"\n【节点现有内容（尾部）】\n{existing}")

    user_prompt = f"""{chr(10).join(context_parts)}

【需要整理的碎片化知识笔记】（共{len(fragments)}条）

{knowledge_text}

请将这些碎片整理成一份干净、无重复的知识文档。"""

    try:
        response = call_deepseek([
            {"role": "system", "content": CONSOLIDATE_KNOWLEDGE_SYSTEM},
            {"role": "user", "content": user_prompt},
        ])
        # The response should be JSON with a "content" field since we use json_object mode
        result = json.loads(response)
        return result.get("content", "")
    except (json.JSONDecodeError, KeyError):
        # If JSON parsing fails, try to use the raw response as markdown
        if response and len(response) > 20:
            return response
        return ""


# ── Helpers ──────────────────────────────────────────────────────────

def _get_node_content_tail(node_id: str, owner_id: str, tail_chars: int = 800) -> str:
    """Read the tail portion of a node's content for dedup and style matching."""
    with get_db_ctx() as conn:
        row = conn.execute(
            "SELECT content FROM nodes WHERE id = ? AND owner_id = ? AND is_deleted = 0",
            (node_id, owner_id),
        ).fetchone()
    if not row or not row["content"]:
        return ""
    content = row["content"]
    if len(content) <= tail_chars:
        return content
    return "...(上文省略)\n" + content[-tail_chars:]


def _read_uploaded_file(owner_id: str, file_id: str) -> str | None:
    """Read the full text content of an uploaded file from disk."""
    import glob as glob_mod
    from file_parser import parse_file
    upload_dir = f"/tmp/acacia_uploads/{owner_id}"
    pattern = os.path.join(upload_dir, f"{file_id}.*")
    matches = glob_mod.glob(pattern)
    if not matches:
        return None
    try:
        return parse_file(matches[0])
    except Exception:
        return None


def _build_conversation_context(session: dict, owner_id: str = "", current_node_id: str = "", existing_content_tail: str = "") -> str:
    """Build conversation context string for the AI prompt.

    Includes: reference material (file content or reference text), current topic name,
    full knowledge profile, conversation history, and existing note content tail.
    """
    lines = []
    node_name = ""
    kps = session.get("knowledge_points", [])
    if kps:
        node_name = kps[0].get("title", "")

    lines.append(f"当前主题：{node_name}")

    if node_name:
        lines.append(f"\n你正在帮助用户理解「{node_name}」。")

    # Include reference material so AI doesn't forget what it's teaching
    oid = owner_id or session.get("owner_id", "")
    file_id = session.get("file_id", "")
    reference_text = session.get("reference_text", "")
    full_reference = ""
    if file_id:
        full_reference = _read_uploaded_file(oid, file_id) or ""
    if not full_reference and reference_text.strip():
        full_reference = reference_text
    if full_reference.strip():
        lines.append(f"\n【参考资料】以下是你正在讲解的原始资料，请始终基于此内容进行对话：\n{full_reference}")

    # Inject full knowledge profile
    nid = current_node_id or session.get("node_id", "")
    if oid and nid:
        profile = build_knowledge_profile(oid, nid)
        if profile:
            lines.append(f"\n{profile}")

    # Declare authority: when knowledge profile and reference material both exist,
    # the reference material is the ground truth. Knowledge profile labels are user-claimed
    # and may not match the actual content.
    if full_reference.strip() and oid and nid:
        lines.append("\n⚠️ 重要提示：当知识档案中的术语/标签与【参考资料】的实际内容不一致时，以【参考资料】为准。知识档案中的节点名称只是用户的命名标签，不能替代参考资料中的真实定义。如果知识档案中的术语在参考资料中找不到对应，直接问用户这个术语是什么，不要猜测。")

    # Inject transition context (context chain awareness)
    transition_ctx = session.get("transition_context", "")
    if transition_ctx:
        lines.append(f"\n【用户跳转背景】{transition_ctx}")

    # Inject new learnings since last visit (for return visits)
    previous_node_id = session.get("previous_node_id")
    if previous_node_id and oid and nid:
        try:
            from context_chain_service import get_new_learnings_since_last_visit
            new_learnings = get_new_learnings_since_last_visit(oid, nid)
            if new_learnings:
                lines.append("\n【自上次访问后的新学习内容】")
                for nl in new_learnings:
                    lines.append(f"  - 在「{nl.get('node_name', '未知')}」中学习了：{nl.get('learned_concepts', '')}")
        except Exception:
            pass

    # Include existing note content tail for dedup and style matching
    if existing_content_tail.strip():
        lines.append(f"\n【已有笔记内容（尾部）】请检查以下内容，避免重复记录已存在的知识点，并匹配其记叙方式和排版格式：\n{existing_content_tail}")

    # Include recent conversation (last 20 messages to stay within context)
    messages = session.get("messages", [])
    recent = messages[-20:] if len(messages) > 20 else messages
    if recent:
        lines.append("\n对话历史：")
        for msg in recent:
            role_label = "AI" if msg["role"] == "ai" else "用户"
            lines.append(f"{role_label}: {msg['content']}")

    return "\n".join(lines)


def build_knowledge_profile(owner_id: str, current_node_id: str) -> str:
    """Build a full knowledge profile string for the AI prompt.

    Includes ALL user nodes categorized by mastery level.
    No pruning, no limits — the profile is a complete mirror of the user's knowledge tree.
    """
    from tree_repository_sqlite import fetch_user_nodes_with_knowledge

    nodes = fetch_user_nodes_with_knowledge(owner_id)
    if not nodes:
        return ""

    # Build lookup maps
    node_by_id = {n["id"]: n for n in nodes}
    children_map: dict[str, list[dict]] = {}
    for n in nodes:
        pid = n["parent_id"]
        if pid:
            children_map.setdefault(pid, []).append(n)

    # Build path to root for current node
    path_to_root: list[dict] = []
    current = node_by_id.get(current_node_id)
    visited = set()
    while current and current["id"] not in visited:
        visited.add(current["id"])
        path_to_root.append(current)
        current = node_by_id.get(current["parent_id"]) if current["parent_id"] else None
    path_to_root.reverse()

    # Categorize every node
    mastered: list[dict] = []
    learning: list[dict] = []
    new_nodes: list[dict] = []
    for n in nodes:
        score = n["mastery_score"]
        state = n["review_state"]
        count = n["review_count"]
        if score > 0.7:
            mastered.append(n)
        elif score >= 0.3 or (count > 0 and state != "new"):
            learning.append(n)
        else:
            new_nodes.append(n)

    lines: list[str] = []
    lines.append("【用户知识档案】")

    # ── A: Current Topic Context ──
    cur = node_by_id.get(current_node_id)
    if cur:
        lines.append(f"当前主题：{cur['name']}")
        if cur["domain_tag"]:
            lines.append(f"所属领域：{cur['domain_tag']}")

        if len(path_to_root) > 1:
            lines.append(f"知识路径：{' → '.join(n['name'] for n in path_to_root)}")

        # Siblings
        parent_id = cur["parent_id"]
        siblings = children_map.get(parent_id, [])
        siblings = [s for s in siblings if s["id"] != current_node_id]
        if siblings:
            parts = []
            for s in siblings:
                label = _mastery_label(s)
                parts.append(f"{s['name']}({label})")
            lines.append(f"同级知识点：{', '.join(parts)}")

        # Children
        children = children_map.get(current_node_id, [])
        if children:
            parts = []
            for c in children:
                label = _mastery_label(c)
                parts.append(f"{c['name']}({label})")
            lines.append(f"子知识点：{', '.join(parts)}")

    # ── B: Mastery Overview ──
    total = len(nodes)
    lines.append(f"\n📊 知识掌握概览：已掌握 {len(mastered)} 个 | 学习中 {len(learning)} 个 | 新 {len(new_nodes)} 个 | 总计 {total} 个节点")

    # ── C: All Mastered Nodes ──
    if mastered:
        lines.append(f"\n✅ 已掌握（{len(mastered)} 个）：")
        for n in mastered:
            domain = f" [领域：{n['domain_tag']}]" if n["domain_tag"] else ""
            lines.append(f"  - {n['name']}{domain}")

    # ── D: All Learning Nodes ──
    if learning:
        lines.append(f"\n📖 学习中（{len(learning)} 个）：")
        for n in learning:
            lines.append(f"  - {n['name']}")

    # ── E: All New Nodes ──
    if new_nodes:
        lines.append(f"\n🆕 新知识点（{len(new_nodes)} 个）：")
        for n in new_nodes:
            lines.append(f"  - {n['name']}")

    return "\n".join(lines)


def _mastery_label(node: dict) -> str:
    """Return a compact Chinese label for a node's mastery level."""
    score = node["mastery_score"]
    if score > 0.7:
        return "已掌握"
    elif score >= 0.3:
        return "学习中"
    return "新"


def detect_abbreviation_name(name: str) -> str | None:
    """Check if a node name looks like an undefined abbreviation.

    Returns a warning message string if it looks like an abbreviation,
    or None if the name seems fine.
    """
    stripped = name.strip()
    # Check for pure uppercase abbreviation: 2-5 uppercase letters, no Chinese
    import re
    if re.match(r'^[A-Z]{2,5}$', stripped):
        return f"知识点名称「{stripped}」看起来像一个缩写。建议补充全称，例如「OML（Optimization Methods for Logistic regression）」或给出一句话定义。否则AI对话时无法确定这个术语的准确含义。"
    # Mixed case but short and no Chinese: could be abbreviation like "OpenMP"
    if re.match(r'^[A-Za-z]{2,6}$', stripped) and not re.search(r'[一-鿿]', stripped):
        return f"知识点名称「{stripped}」看起来像一个英文缩写或简称。如果它是缩写，建议补充完整含义，以便AI在对话中准确理解。"
    return None

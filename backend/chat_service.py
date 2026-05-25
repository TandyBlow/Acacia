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
from doc_position_tracker import split_document, get_current_segment, advance_position, get_progress_context, is_document_done, get_full_document, get_position_marker, get_context_window
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

# 核心姿态：知识贡献者，而非考官

你的首要价值是告诉用户他不知道的东西。默认姿态是"分享知识"，而非"验证知识"。
- 每个回复中，先分享1-2个用户可能不知道的有趣知识或见解（背景故事、设计原理、行业对比、历史演变等），然后自然地邀请用户回应。纯提问只有在用户刚接触主题、你需要了解他的起点时才使用。
- 不要连续2轮以上纯提问。即使用户回答简短，下一轮也应该先补充一些信息，再问。
- 当用户展示出对某方面的了解时（如准确列出多个子系统、说出具体操作细节），肯定他们，然后往"上"走（更宏观的背景、历史演变、同类对比、产业故事），而不是往"下"钻（追问更细的操作细节）。用户来找你是想学到新东西，不是来参加考试的。如果他说得都对，说明这部分不用再问了——直接分享他不知道的。
- 用户如果连续2轮只回应"嗯""哦哦""然后呢"，说明他觉得无聊了。此时立刻切换到分享模式，讲一个他不知道的有趣内容，不要继续追问。

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
- 用户回答正确且自信：真诚地肯定，然后分享一个相关的、用户可能不知道的延伸知识（背景、对比、演变），自然地引导对话往更广的方向走。不要追问更细的操作细节——他已经懂了。
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

- 每次对话你会收到【个性化知识关联】，这是根据当前内容从用户知识树中匹配出的**真正相关**的知识点
- 每个匹配包含：知识点名称、用户笔记片段、关联原因（具体到概念层面的联系）
- 解释新概念时，若匹配显示用户对某前置概念已有理解，自然地融入解释中："你之前对XX的理解是...，它和现在这个YYY在ZZ方面有联系"
- 匹配为空或匹配度低时，不要强行关联——宁可只基于参考资料讲解，也不要生造联系
- 对"新"或"学习中"的知识点不要假设用户已经理解，从定义开始
- 如果当前主题的子知识点中有"学习中"或"新"的内容，可以在适当时候提及它们
- 结束对话时，基于匹配结果和对话内容，建议用户下一步可以学习的内容（1-2个建议）

# 主动知识缺口检测

系统会在代码层面检测用户的知识缺口并通过【缺口警告】告知你。根据警告级别调整：
- critical：用户基础薄弱，给出更详细的定义，不要提问
- moderate：有一些基础，参考【个性化知识关联】建立具体联系
- none：基础扎实，正常节奏教学

此外，在对话中如果你发现用户在某前置概念上反复不理解（连续2次追问仍答不上来），主动建议：
- "这个概念依赖XXX的基础。你的知识树里还没有XXX，要不要先去建一个XXX的知识点学一下？搞懂了再回来看这个，自然就通了。"

这**不是拒绝用户**，而是帮他建立正确的学习路径。如果用户表示想继续，就继续从最基础的定义教。

# 参考资料即主题定义

当对话中提供了【参考资料】（用户上传的文件内容）时，参考资料本身就定义了这个主题是什么。不要质疑或追问节点名称的含义——即使用户的知识档案显示该节点为"新"，也应该直接从参考资料的内容出发开始教学。节点名称只是用户给这个学习主题起的标签，真正的教学内容在参考资料里。开场白不要问"你了解XX吗？"，直接基于资料内容开始讲解或提问。

# Wikipedia 背景知识

当对话中提供了【Wikipedia 背景知识】时，这是来自维基百科的权威参考信息。你应该：
- 自然地使用其中的事实（如开发年份、制作公司、类型分类等），不要用"根据维基百科"的措辞
- 如果用户问到你不知道的细节，优先参考Wikipedia背景知识中的信息
- 利用相关主题列表来丰富对话——聊到合适的时候，自然地提到："同类型的还有XX、YY""同时代的热门作品还有ZZ"
- Wikipedia信息是准确的参考，但不要机械地逐条念——融入对话的自然节奏中

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
  "generated_content": "当action为accept时，生成一段Markdown笔记（100-200字）。你正在逐步构建一篇完整的知识文档，每条generated_content是文档中的一个章节。写之前先参考【已记录的知识笔记】和【已有笔记内容】，确保新章节与已有内容自然衔接——不要重复已写过的定义和事实，而是补充新角度、新细节或延伸内容。直接陈述知识本身，不要加'我学到了''我理解了'等前缀。禁止第三人称（'用户学会了''学习者掌握了'）和AI视角（'AI解释了...'）。只写知识本身，不要描述教学过程。禁止任何描述对话过程的元语句。尤其禁止修正链路——不要写'先以为是X后来纠正为Y''最初理解为A经过讨论修正为B'等描述理解演变过程的句子，只呈现最终正确的理解。如果先前理解有误，直接写正确版本，不要标注'纠正''修正'。公式只写对话中确认过的或原文中有的，禁止脑补。非accept时为空字符串",
  "sub_topic": "当前讨论的子话题名称（方便用户了解对话焦点），如'梯度下降的直观理解'、'链式法则在反向传播中的应用'等",
  "knowledge_note": "本次交流**新学到**的知识总结（1-3句话）。只记录本轮新出现的知识——如果对话历史中已有相同内容的知识笔记，不要重复。如果本轮没有新知识（仅确认/复习），knowledge_note留空字符串。直接写学到的内容，直接陈述知识本身，不要加'我学到了'等前缀。禁止第三人称和AI视角。禁止出现'AI''用户''对话''我们讨论了''推断''推测''似乎''根据对话''笔记中的关键词'等元对话词汇。禁止修正链路——不要写'先以为是X后来纠正为Y'，只呈现最终正确的理解"
}

# 生成笔记内容的原则

- 直接陈述知识内容，不要加"我学到了""我理解了"等前缀，不要写"用户学会了""AI解释了""我问了X用户答了Y"
- 保留学习者自己的表述和用词（从他的回答中提取），不要替他改写
- 如果学习者理解有偏差，温和修正，但修正部分也要融入笔记中，不要标注"修正"
- 公式只写原文中有或对话中确认过的，禁止自己推导或补充未确认的公式
- 不需要写"已掌握/新学到"等标签，自然地把新知和已知区分开
- 包含一个具体例子或应用场景
- 使用Markdown格式，100-200字"""


# ── Session persistence ──────────────────────────────────────────────
# Delegated to session_store.py — use load_session() / save_session() directly.


LINE_BY_LINE_SYSTEM = """你是一个知识导师，正在陪用户逐段阅读一份文档。

每次回复：
1. 用 > 引用当前要讲解的段落原文
2. 解释这段内容，利用上下文中的【知识点结构】理解涉及的概念
3. 如果用户提问或表示不理解，先判断他是否缺少前置知识。缺前置→建议去学习具体的原子知识点。有前置但不理解→直接换角度解释，不要问"要不要展开"
4. 数学公式用 $...$ 或 $$...$$ 包裹
5. 回复控制在2-5句话

返回JSON：{"message": "> 原文\\n\\n解释内容", "reason": "简短标注"}"""


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
        # Fetch Wikipedia context for the node topic
        wiki_context = ""
        try:
            from wikipedia_service import get_article_summary, get_related_topics, format_wiki_context
            summary = get_article_summary(node_name)
            if summary:
                related = get_related_topics(node_name)
                source_label = summary.get("source_name", "Wikipedia")
                wiki_context = format_wiki_context(summary, related, source_label=source_label)
        except Exception:
            wiki_context = ""

        user_content = f"节点名称：{node_name}\n\n"
        if wiki_context:
            user_content += f"{wiki_context}\n\n"
        if full_reference.strip():
            user_content += f"参考资料：\n{full_reference}\n\n"
            user_content += "请开始苏格拉底式对话。参考资料已经定义了这个主题，请直接从资料的具体内容出发提出第一个引导性问题。不要确认或质疑主题名称——直接开始教学。请严格按照系统提示的JSON格式回复。"
        elif wiki_context:
            user_content += "请开始苏格拉底式对话。上面的Wikipedia背景知识提供了这个主题的基本信息，请自由使用这些事实。先简要介绍这个主题（1-2句话），然后提出第一个引导性问题。请严格按照系统提示的JSON格式回复。"
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
        knowledge_note = _filter_meta_commentary(result.get("knowledge_note", ""))

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
        "full_document": full_text,
    }

    # Build narrow prompt: the AI only needs to explain the first segment.
    # Code tracks position — AI never needs to find it.
    first_segment = get_current_segment(session)
    progress = get_progress_context(session)
    pos_marker = get_position_marker(session)

    user_lines = []
    # Context window — nearby segments for orientation, not the entire file
    ctx_window = get_context_window(session)
    if ctx_window:
        user_lines.append(f"【文档上下文】（当前位置附近的段落）\n{ctx_window}")
    if pos_marker:
        user_lines.append(f"【{pos_marker}】")
    user_lines.append(f"【逐句讲解】{progress}")
    user_lines.append(f"请解释下面这句话：\n\n{first_segment}")

    # Extract atomic concepts for the first segment (same as enrichment pipeline)
    # This replaces the full knowledge profile — concept extraction + knowledge retrieval
    # provides filtered, relevant context instead of dumping the entire user tree.
    try:
        from concept_extractor import extract_atomic_concepts, format_concept_context
        from knowledge_retriever import build_content_index, search_user_knowledge, format_personalized_context

        result = extract_atomic_concepts(first_segment, full_text)
        concepts = result.get("concepts", [])
        connections = result.get("cross_connections", [])
        if concepts:
            cc = format_concept_context(concepts, connections)
            if cc:
                user_lines.append(cc)
            # Also search user knowledge by content for personalized context
            try:
                index = build_content_index(owner_id)
                matches = search_user_knowledge(concepts, index)
                personalized = format_personalized_context(matches)
                if personalized:
                    user_lines.append(personalized)
            except Exception:
                pass
    except Exception:
        pass

    if transition_ctx:
        user_lines.append(f"【用户跳转背景】{transition_ctx}")

    # Adaptive opening as passive context only
    if adaptive_opening:
        user_lines.append(f"【用户背景（仅供了解，不要在你的回复中提及）】{adaptive_opening}")

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

    # Save user message centrally — all sub-handlers read from session["messages"]
    session["messages"].append({
        "role": "user",
        "content": user_answer,
        "timestamp": time.time(),
    })

    # Classify user intent (rule-based primary, LLM fallback for ambiguous)
    if skip:
        intent = "skip_request"
    else:
        chat_mode = session.get("chat_mode", "single")
        intent = classify_intent(user_answer, chat_mode)

    # ── Preprocessing: run for ALL modes ──────────────────────────────
    chat_mode = session.get("chat_mode", "single")

    # Tone detection — all modes
    tone = detect_tone(session)

    # Knowledge gap detection — all modes
    gap_warning = ""
    if should_check_gaps(session):
        gap_result = detect_gaps(session["owner_id"], session["node_id"])
        gap_warning = format_gap_warning(gap_result)
        session["last_gap_check_turn"] = sum(1 for m in session["messages"] if m["role"] == "user")

    # Concept extraction + knowledge retrieval — all modes
    try:
        enrich_chat_context(session, intent)
    except Exception:
        pass  # enrichment failure should not block the turn

    if chat_mode == "line_by_line":
        from handler_router import route_and_handle
        result = route_and_handle(session, user_answer, intent, tone, gap_warning)
        if result.get("_routed") is False:
            return _process_line_by_line_turn(session, user_answer, skip, intent)
        save_session(session)
        return result
    elif chat_mode == "multi_kp":
        return _process_multi_kp_turn(session, user_answer, skip, intent, tone, gap_warning)
    else:
        return _process_single_topic_turn(session, user_answer, skip, intent, tone, gap_warning)


MAX_FOLLOW_UPS = 3
MAX_TOTAL_TURNS = 15


def _process_single_topic_turn(
    session: dict,
    user_answer: str,
    skip: bool,
    intent: str = "content_question",
    tone: dict = None,
    gap_warning: str = ""
) -> Dict[str, Any]:
    """Process one turn of a single-topic Socratic chat."""
    user_turn_count = sum(1 for m in session["messages"] if m["role"] == "user")

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
                "mentioned_concepts": _extract_mentioned_concepts(session),
            }

        session["messages"].append({
            "role": "ai",
            "content": "好的，我们换一个角度。",
            "timestamp": time.time(),
            "metadata": {"action": "skip"}
        })
        eval_messages = [
            {"role": "system", "content": SINGLE_TOPIC_CHAT_SYSTEM},
            {"role": "user", "content": _build_conversation_context(session, session["owner_id"], session["node_id"], existing_content_tail, tone, gap_warning) + "\n\n用户选择跳过当前问题。请换一个角度提出新的引导性问题。请严格按照系统提示的JSON格式回复。"}
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
            "knowledge_note": _filter_meta_commentary(result.get("knowledge_note", "")),
            "total_kp": 1,
            "current_kp_index": 0,
            "completed": False,
            "mentioned_concepts": _extract_mentioned_concepts(session),
        }

    # Evaluate user's answer
    eval_messages = [
        {"role": "system", "content": SINGLE_TOPIC_CHAT_SYSTEM},
        {"role": "user", "content": _build_conversation_context(session, session["owner_id"], session["node_id"], existing_content_tail, tone, gap_warning) + f"\n\n用户刚才的回答：{user_answer}\n\n请评估用户的回答，选择动作并回复。请严格按照系统提示的JSON格式回复。"}
    ]

    try:
        raw = call_deepseek(eval_messages)
        result = parse_json_response(raw)
    except Exception as e:
        raise RuntimeError(f"对话处理失败：{str(e)}")

    action = result.get("action", "follow_up")
    ai_message = result.get("message", "")
    generated_content = _filter_meta_commentary(result.get("generated_content", ""))
    knowledge_note = _filter_meta_commentary(result.get("knowledge_note", ""))

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
            "mentioned_concepts": _extract_mentioned_concepts(session),
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
        "mentioned_concepts": _extract_mentioned_concepts(session),
    }


# ── Line-by-Line Context Enrichment ─────────────────────────────────────


def enrich_chat_context(session: dict, intent: str) -> None:
    """Pre-processing pipeline for ALL chat modes.

    Extracts atomic concepts from the current content (segment in line_by_line,
    reference material in single/multi mode), searches user's knowledge point
    contents for matches, and stores enriched context in the session.
    """
    import sys
    from concept_extractor import extract_atomic_concepts, generate_expansion_context, build_definition_chain, format_concept_context
    from knowledge_retriever import build_content_index, search_user_knowledge, format_personalized_context

    chat_mode = session.get("chat_mode", "single")
    oid = session.get("owner_id", "")

    # Analyze recent conversation for ALL modes.
    # Using the reference document or current segment would anchor concepts
    # to static content, missing what's actually being discussed right now.
    text = _get_recent_conversation_text(session)
    full_doc = text

    if not text or not text.strip():
        return

    # Skip enrichment if we already did this text
    segment_hash = session.get("_last_enriched_segment", "")
    new_hash = _hash_text(text)
    if segment_hash == new_hash and session.get("_enriched_context"):
        print("[ENRICH] text unchanged, skipping", file=sys.stderr)
        return

    # Clear post-response concepts from previous turn — they'll be
    # re-extracted from the new AI response when it arrives
    session.pop("_response_concepts", None)
    session.pop("_response_extraction_attempted", None)

    print(f"[ENRICH] running for mode={chat_mode} hash={new_hash[:8]}...", file=sys.stderr)

    # 0. Fetch existing child names under current node so LLM can skip them
    existing_names: list = []
    nid = session.get("node_id", "")
    if oid and nid:
        try:
            from tree_repository_sqlite import get_db_ctx as _get_db_ctx
            with _get_db_ctx() as _conn:
                rows = _conn.execute(
                    "SELECT name FROM nodes WHERE owner_id = ? AND parent_id = ? AND is_deleted = 0",
                    (oid, nid)
                ).fetchall()
                existing_names = [r["name"] for r in rows]
                # Also fetch current node's own name to prevent self-referential extraction
                self_row = _conn.execute(
                    "SELECT name FROM nodes WHERE id = ? AND owner_id = ? AND is_deleted = 0",
                    (nid, oid)
                ).fetchone()
                if self_row and self_row["name"]:
                    existing_names.append(self_row["name"])
                print(f"[ENRICH] existing children: {existing_names}", file=sys.stderr)
        except Exception as _e:
            print(f"[ENRICH] failed to fetch existing children: {_e}", file=sys.stderr)
    elif nid:
        # Fallback: get current node name from knowledge_points in session
        kps = session.get("knowledge_points", [])
        if kps:
            node_name = kps[0].get("title", "")
            if node_name:
                existing_names.append(node_name)

    # Also merge previously extracted concept names from prior turns for cross-window dedup
    prev_enriched = session.get("_enriched_context", {}) or {}
    prev_concepts = prev_enriched.get("concepts", [])
    if prev_concepts:
        prev_names_from_enrich = [c.get("name", "") for c in prev_concepts if c.get("name")]
        existing_names = list(set(existing_names) | set(prev_names_from_enrich))
        if prev_names_from_enrich:
            print(f"[ENRICH] +{len(prev_names_from_enrich)} names from prior turn: {prev_names_from_enrich}", file=sys.stderr)

    # 1. Concept extraction (cached per text)
    result = extract_atomic_concepts(text, full_doc, existing_names)
    concepts = result.get("concepts", [])
    cross_connections = result.get("cross_connections", [])
    print(f"[ENRICH] extracted {len(concepts)} concepts", file=sys.stderr)
    for c in concepts:
        print(f"[ENRICH]   - {c.get('name', '?')} [{c.get('category', '?')}]", file=sys.stderr)

    # 1b. Wikipedia verification — filter out noise concepts
    concepts = _verify_concepts_via_wikipedia(concepts, "[ENRICH]", text)
    concepts = _deduplicate_concepts(concepts, "[ENRICH]")

    # Always build concept context — this guides the explanation regardless of user knowledge
    concept_context = format_concept_context(concepts, cross_connections)
    print(f"[ENRICH] concept_context: {len(concept_context)} chars", file=sys.stderr)

    # 2. Knowledge content retrieval — search user KPs by CONTENT, not just title
    personalized = ""
    if oid and concepts:
        try:
            index = build_content_index(oid)
            print(f"[ENRICH] content index: {len(index.entries)} entries", file=sys.stderr)
            matches = search_user_knowledge(concepts, index)
            print(f"[ENRICH] found {len(matches)} knowledge matches", file=sys.stderr)
            for m in matches:
                print(f"[ENRICH]   - {m['kp_name']} (score={m['score']:.2f})", file=sys.stderr)
            personalized = format_personalized_context(matches)
        except Exception as e:
            print(f"[ENRICH] knowledge retrieval failed: {e}", file=sys.stderr)
            personalized = ""

    # 3. Expansion context
    expansion = ""
    if concepts:
        try:
            expansion = generate_expansion_context(concepts, text)
            print(f"[ENRICH] expansion context: {len(expansion)} chars", file=sys.stderr)
        except Exception as e:
            print(f"[ENRICH] expansion generation failed: {e}", file=sys.stderr)
            expansion = ""

    # 4. Store in session
    session["_enriched_context"] = {
        "concepts": concepts,
        "concept_context": concept_context,
        "personalized_context": personalized,
        "expansion_context": expansion,
    }
    session["_last_enriched_segment"] = new_hash
    print(f"[ENRICH] stored. personalized={len(personalized)}chars, expansion={len(expansion)}chars", file=sys.stderr)

    # 5. Definition chain (only for content questions — computed on demand)
    if intent in ("content_question", "knowledge_question"):
        try:
            from knowledge_retriever import get_user_kp_names
            user_kps = get_user_kp_names(oid) if oid else set()
            def_chain = build_definition_chain(
                _last_user_message(session),
                text,
                user_kps,
            )
            if def_chain:
                session["_enriched_context"]["definition_chain"] = def_chain
        except Exception:
            pass


# Patterns that indicate the AI is describing conversation process rather than knowledge
META_COMMENTARY_PATTERNS = [
    r"AI[通过问说想想到到讲讲]",
    r"用户[通过问说想想到到记答回笔]",
    r"我们讨论",
    r"对话[中过过程程]",
    r"[推推]测[了]?",
    r"似乎.*用户",
    r"[根根]据对话",
    r"我[问说].*用户",
    r"用户[答回]",
    r"笔记中的关键词",
    r"推断用户",
    r"从.*知识树中.*读取",
    r"不是.*知道.*而是.*推测",
    # Correction chain (修正链路) patterns
    r"[修纠][正改].*理解",
    r"[纠纠]正.*之?前.*理解",
    r"先.*以为.*后[来才]",
    r"一开始.*后来.*[纠纠正]",
    r"起初.*后来.*[修纠]",
    r"误解.*[纠纠]正",
    r"原来.*理解.*不对",
    r"以为.*其实.*不[对是]",
    # Third-person perspective patterns
    r"学习者[^\s]{0,3}(?:学会|掌握|认识|理解|知道)",
    r"AI\s*(?:解释|说明|告诉|指出|纠正|引导|通过|根据|询问)",
]


def _filter_meta_commentary(text: str) -> str:
    """Return the text if clean, or empty string if it describes conversation process."""
    if not text or not text.strip():
        return ""
    import re
    for pattern in META_COMMENTARY_PATTERNS:
        if re.search(pattern, text):
            return ""
    return text


def _verify_concepts_via_wikipedia(concepts: list, log_prefix: str = "[WIKI]", source_text: str = "") -> list:
    """Verify each concept against Wikipedia and attach verification fields.

    Concepts without Wikipedia articles are normally filtered out, BUT
    domain-specific concepts that are substantially discussed may be kept
    even without Wikipedia coverage. The bar is intentionally high to avoid
    extracting generic words or passing example mentions as knowledge points.
    On API failure, concepts are kept unverified (graceful degradation).
    """
    import sys
    if not concepts:
        return []
    try:
        from wikipedia_service import verify_concept
    except ImportError:
        print(f"{log_prefix} wikipedia_service not available, keeping all {len(concepts)} concepts", file=sys.stderr)
        for c in concepts:
            c["verified"] = False
            c["wiki_summary"] = ""
            c["wiki_description"] = ""
        return concepts

    # Count how many times each concept name appears in the source text
    mention_counts = {}
    if source_text:
        for c in concepts:
            name = c.get("name", "")
            if name and len(name) >= 2:
                mention_counts[name] = source_text.count(name)

    verified = []
    for c in concepts:
        name = c.get("name", "")
        if not name or len(name) < 2:
            continue
        try:
            vc = verify_concept(name)
            if vc.get("verified"):
                c["verified"] = True
                c["wiki_summary"] = vc.get("summary", "")
                c["wiki_description"] = vc.get("description", "")
                verified.append(c)
                print(f"{log_prefix} ✓ {name}", file=sys.stderr)
            else:
                # For non-Wikipedia concepts, require stronger evidence that this
                # is a genuine domain concept, not a generic word or passing mention.
                mentions = mention_counts.get(name, 0)
                definition = c.get("definition", "")
                category = c.get("category", "")

                # Require BOTH: mentioned 3+ times AND has a substantive definition
                if mentions >= 3 and len(definition) >= 20:
                    c["verified"] = False
                    c["wiki_summary"] = ""
                    c["wiki_description"] = ""
                    verified.append(c)
                    print(f"{log_prefix} ~ {name} (no Wikipedia, mentioned {mentions}x, substantive def — kept)", file=sys.stderr)
                elif mentions >= 3:
                    print(f"{log_prefix} ✗ {name} (no Wikipedia, mentioned {mentions}x but def too short ({len(definition)} chars))", file=sys.stderr)
                elif len(definition) >= 20:
                    print(f"{log_prefix} ✗ {name} (no Wikipedia, substantive def but only {mentions} mention(s))", file=sys.stderr)
                else:
                    print(f"{log_prefix} ✗ {name} (no Wikipedia, only {mentions} mention(s), short def)", file=sys.stderr)
        except Exception:
            c["verified"] = False
            c["wiki_summary"] = ""
            c["wiki_description"] = ""
            verified.append(c)

    print(f"{log_prefix} verified {len(verified)}/{len(concepts)} concepts", file=sys.stderr)
    return verified


def _deduplicate_concepts(concepts: list, log_prefix: str = "[DEDUP]") -> list:
    """Merge near-duplicate concepts based on name overlap.

    Handles cases like:
    - Substring: "人才" is wholly contained in "人才管理" → merge, keep longer
    - Shared prefix/suffix: "光荣公司" vs "光荣特库摩" share "光荣" → merge, keep more formal
    - Character overlap >= 66% of the shorter name → merge
    """
    import sys
    if len(concepts) <= 1:
        return concepts

    def _norm(s: str) -> str:
        """Strip common suffixes for comparison."""
        import re
        s = s.strip()
        s = re.sub(r'[（(][^)）]*[)）]', '', s)  # remove parentheticals
        return s

    merged = []
    used = [False] * len(concepts)

    for i, ci in enumerate(concepts):
        if used[i]:
            continue
        name_i = ci.get("name", "")
        if not name_i:
            used[i] = True
            continue

        best = ci
        best_name = name_i
        best_idx = i

        for j, cj in enumerate(concepts):
            if i == j or used[j]:
                continue
            name_j = cj.get("name", "")
            if not name_j:
                used[j] = True
                continue

            # Check substring relationship
            if name_i in name_j or name_j in name_i:
                # Keep the longer, more formal version
                if len(name_j) > len(best_name):
                    best = cj
                    best_name = name_j
                    best_idx = j
                    used[i] = True
                else:
                    used[j] = True
                continue

            # Check character overlap
            norm_i = _norm(name_i)
            norm_j = _norm(name_j)
            if len(norm_i) >= 2 and len(norm_j) >= 2:
                common = sum(1 for ch in norm_i if ch in norm_j)
                shorter_len = min(len(norm_i), len(norm_j))
                if common >= shorter_len * 0.66:
                    # Merge: keep the more formal (longer) name
                    if len(name_j) > len(best_name):
                        best = cj
                        best_name = name_j
                        best_idx = j
                        used[i] = True
                    else:
                        used[j] = True

        # Merge definitions if we're keeping a different concept than ci
        if best_idx != i:
            # Add mention of the merged name in definition if it's different enough
            old_def = best.get("definition", "")
            other_name = name_i
            if other_name not in old_def and other_name not in best_name:
                if old_def:
                    best["definition"] = f"{old_def}（也称{other_name}）"
            print(f"{log_prefix} merged '{name_i}' → '{best_name}'", file=sys.stderr)

        merged.append(best)
        if best_idx != i:
            used[i] = True
        used[best_idx] = True

    return merged


def _get_recent_conversation_text(session: dict, max_messages: int = 4) -> str:
    """Get the last N messages as analysis text for concept extraction."""
    messages = session.get("messages", [])
    recent = messages[-max_messages:] if len(messages) > max_messages else messages
    parts = []
    for msg in recent:
        role = "AI" if msg["role"] == "ai" else "用户"
        content = msg.get("content", "")
        if content.strip():
            parts.append(f"{role}: {content}")
    return "\n".join(parts)


def _get_reference_text_for_enrichment(session: dict) -> str:
    """Get the reference text for concept extraction in non-line_by_line modes."""
    oid = session.get("owner_id", "")
    file_id = session.get("file_id", "")
    reference_text = session.get("reference_text", "")

    if file_id:
        content = _read_uploaded_file(oid, file_id)
        if content:
            return content
    if reference_text.strip():
        return reference_text

    # For multi_kp mode, use current KP's source_content
    kps = session.get("knowledge_points", [])
    idx = session.get("current_index", 0)
    if kps and idx < len(kps):
        kp = kps[idx]
        return kp.get("source_content", "") or kp.get("title", "")

    return ""


# Keep old name as alias for backward compatibility
enrich_line_by_line_context = enrich_chat_context


def _refresh_response_concepts(session: dict) -> None:
    """Post-response concept extraction.

    After the AI generates a reply, re-extract atomic concepts from the
    AI's actual teaching text. This ensures the clickable concept chips
    reflect what was just taught, rather than broad topics from the
    conversation history (which is what the pre-processing extraction sees).
    """
    import sys
    from concept_extractor import extract_atomic_concepts

    # Skip if already done this turn
    if session.get("_response_concepts"):
        return

    messages = session.get("messages", [])
    if not messages:
        return

    # Find the latest AI message
    ai_text = ""
    for m in reversed(messages):
        if m.get("role") == "ai" and m.get("content", "").strip():
            ai_text = m["content"]
            break

    if not ai_text:
        return

    # Get existing child names for dedup
    existing_names: list = []
    oid = session.get("owner_id", "")
    nid = session.get("node_id", "")
    if oid and nid:
        try:
            from tree_repository_sqlite import get_db_ctx as _get_db_ctx
            with _get_db_ctx() as _conn:
                rows = _conn.execute(
                    "SELECT name FROM nodes WHERE owner_id = ? AND parent_id = ? AND is_deleted = 0",
                    (oid, nid)
                ).fetchall()
                existing_names = [r["name"] for r in rows]
                # Also exclude current node's own name
                self_row = _conn.execute(
                    "SELECT name FROM nodes WHERE id = ? AND owner_id = ? AND is_deleted = 0",
                    (nid, oid)
                ).fetchone()
                if self_row and self_row["name"]:
                    existing_names.append(self_row["name"])
        except Exception:
            pass
    elif nid:
        kps = session.get("knowledge_points", [])
        if kps:
            node_name = kps[0].get("title", "")
            if node_name:
                existing_names.append(node_name)

    try:
        result = extract_atomic_concepts(ai_text, "", existing_names)
        concepts = result.get("concepts", [])
        if concepts:
            concepts = _verify_concepts_via_wikipedia(concepts, "[ENRICH-POST]", ai_text)
            concepts = _deduplicate_concepts(concepts, "[ENRICH-POST]")
        if concepts:
            session["_response_concepts"] = concepts
            print(f"[ENRICH] post-response extracted {len(concepts)} concepts from AI reply", file=sys.stderr)
            for c in concepts:
                print(f"[ENRICH]   - {c.get('name', '?')} [{c.get('category', '?')}]", file=sys.stderr)
    except Exception as e:
        print(f"[ENRICH] post-response extraction failed: {e}", file=sys.stderr)


def _hash_text(text: str) -> str:
    """Simple hash for comparing segment identity."""
    import hashlib
    return hashlib.md5(text.encode("utf-8")).hexdigest()


def _last_user_message(session: dict) -> str:
    """Get the most recent user message from the session."""
    messages = session.get("messages", [])
    for msg in reversed(messages):
        if msg.get("role") == "user":
            return msg.get("content", "")
    return ""


def _process_multi_kp_turn(
    session: dict,
    user_answer: str,
    skip: bool,
    intent: str = "content_question",
    tone: dict = None,
    gap_warning: str = ""
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

    # ── Handle off-topic content questions ──────────────────────────
    # When user asks a content question instead of answering the KP question,
    # answer it briefly using enriched context, then return to KP flow.
    if intent in ("content_question", "knowledge_question") and not skip:
        enriched = session.get("_enriched_context", {}) or {}
        concept_ctx = enriched.get("concept_context", "")
        personalized = enriched.get("personalized_context", "")
        def_chain = enriched.get("definition_chain", "")
        profile = build_knowledge_profile(session["owner_id"], session["node_id"])

        answer_msg = f"""用户没有直接回答当前知识点的问题，而是提出了一个内容问题。

当前知识点：{current_kp.get('title', '')}
当前问题：{last_question or '(无)'}
用户问：{user_answer}

请先简短回答用户的问题（2-4句话），然后自然地引导回当前知识点的讨论。
如果用户的问题和当前知识点完全无关，可以简单回答后说"这个话题挺有意思的，不过我们先回到..."。
如果用户的问题和当前知识点有关联，就顺着关联引导回来。

可用上下文：
- 【知识点结构】帮你理解用户问题涉及的概念
- 【个性化知识关联】用户已有的相关知识
- 你的回复要自然对话风格，不要用模板化开头"""

        user_lines = [answer_msg]
        if concept_ctx:
            user_lines.append(f"\n{concept_ctx}")
        if personalized:
            user_lines.append(f"\n{personalized}")
        if def_chain:
            user_lines.append(f"\n{def_chain}")
        if gap_warning:
            user_lines.append(f"\n{gap_warning}")
        if tone and tone.get("instruction"):
            user_lines.append(f"\n{tone['instruction']}")
        if profile:
            user_lines.append(f"\n{profile[:2000]}")  # truncated profile for context

        try:
            raw = call_deepseek([
                {"role": "system", "content": SINGLE_TOPIC_CHAT_SYSTEM},
                {"role": "user", "content": "\n".join(user_lines)},
            ])
            result = parse_json_response(raw)
            ai_message = result.get("message", "")
        except Exception:
            ai_message = f"好问题。不过我们先回到刚才的话题：{last_question}"

        session["messages"].append({
            "role": "ai",
            "content": ai_message,
            "timestamp": time.time(),
            "metadata": {"action": "follow_up", "reason": "off_topic_answer"}
        })
        save_session(session)
        return _make_multi_kp_response(session, "follow_up", ai_message)

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
    user_turn_count = sum(1 for m in session["messages"] if m["role"] == "user")

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
        ctx_window = get_context_window(session)
        pos_marker = get_position_marker(session)

        context_lines = []
        if ctx_window:
            context_lines.append(f"【文档上下文】（当前位置附近的段落）\n{ctx_window}")
        if pos_marker:
            context_lines.append(f"【{pos_marker}】")
        context_lines.append(f"【逐句讲解】{progress}")
        context_lines.append(f"请解释下面这句话：\n\n{current_segment}")
        # Use enriched context (concept extraction + knowledge retrieval by content)
        # instead of full knowledge profile to avoid "same KP every turn"
        enriched = session.get("_enriched_context", {}) or {}
        concept_ctx = enriched.get("concept_context", "")
        personalized = enriched.get("personalized_context", "")
        expansion = enriched.get("expansion_context", "")
        if concept_ctx:
            context_lines.append(concept_ctx)
        if personalized:
            context_lines.append(personalized)
        if expansion:
            context_lines.append(expansion)

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
            "mentioned_concepts": _extract_mentioned_concepts(session),
        }

    # ── Handle end request ────────────────────────────────────────────
    if intent == "end_request":
        return _end_line_by_line(session, "好的，讲解到这里。你可以随时回来继续。")

    # ── Handle content question / meta / correction / chitchat ────────
    # Answer the user's question briefly, then explain the current segment
    current_segment = get_current_segment(session)
    progress = get_progress_context(session)
    ctx_window2 = get_context_window(session)
    pos_marker2 = get_position_marker(session)

    context_lines = []
    if ctx_window2:
        context_lines.append(f"【文档上下文】（当前位置附近的段落）\n{ctx_window2}")
    if pos_marker2:
        context_lines.append(f"【{pos_marker2}】")
    context_lines.append(f"【逐句讲解】{progress}")
    context_lines.append(f"当前要讲解的句子：\n\n{current_segment}")
    context_lines.append(f"\n用户说：{user_answer}")

    if intent == "content_question":
        context_lines.append("\n判断用户是缺少前置知识还是需要换角度解释。缺少前置知识→建议去学具体的原子知识点。需要换角度→直接展开，不要问。")
    elif intent == "meta_question":
        context_lines.append("\n简要回答（关于你自己的问题），然后继续讲解当前段落。")
    elif intent == "correction":
        context_lines.append("\n用户纠正了你。承认错误，然后继续讲解当前段落。")
    else:
        context_lines.append("\n简短回应后，继续讲解当前段落。")

    # Inject enriched context (concept extraction + knowledge retrieval by content)
    # instead of full knowledge profile
    enriched = session.get("_enriched_context", {}) or {}
    concept_ctx = enriched.get("concept_context", "")
    personalized = enriched.get("personalized_context", "")
    expansion = enriched.get("expansion_context", "")
    def_chain = enriched.get("definition_chain", "")
    if concept_ctx:
        context_lines.append(concept_ctx)
    if personalized:
        context_lines.append(personalized)
    if expansion:
        context_lines.append(expansion)
    if def_chain:
        context_lines.append(def_chain)

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
        "mentioned_concepts": _extract_mentioned_concepts(session),
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
        "mentioned_concepts": _extract_mentioned_concepts(session),
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
        "mentioned_concepts": _extract_mentioned_concepts(session),
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

        # Check if a sibling with the same name already exists
        existing = conn.execute(
            "SELECT id FROM nodes WHERE owner_id = ? AND parent_id = ? AND name = ? AND is_deleted = 0",
            (owner_id, parent_id, concept_name)
        ).fetchone()
        if existing:
            child_id = existing["id"]
            is_new = False
        else:
            now = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
            conn.execute(
                """INSERT INTO nodes (id, owner_id, name, content, parent_id, depth, sort_order, created_at, updated_at)
                   VALUES (?, ?, ?, '', ?, ?, 0, ?, ?)""",
                (child_id, owner_id, concept_name, parent_id, parent["depth"] + 1, now, now)
            )
            conn.execute(
                "INSERT INTO edges (parent_id, child_id, sort_order) VALUES (?, ?, 0)",
                (parent_id, child_id)
            )
            is_new = True

    # Add a note to the chat
    if is_new:
        session["messages"].append({
            "role": "ai",
            "content": f"已创建子节点「{concept_name}」。你可以随时离开去学习它，回来时我会根据你的知识树更新解释。",
            "timestamp": time.time(),
            "metadata": {"action": "concept_marked", "concept_name": concept_name, "node_id": child_id}
        })
    else:
        session["messages"].append({
            "role": "ai",
            "content": f"知识点「{concept_name}」已存在于当前主题下，无需重复创建。",
            "timestamp": time.time(),
            "metadata": {"action": "concept_already_exists", "concept_name": concept_name, "node_id": child_id}
        })

    save_session(session)

    # Record transition for context chain (only for new nodes)
    if is_new:
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
    if not is_new:
        result["already_exists"] = True

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
        "mentioned_concepts": _extract_mentioned_concepts(session),
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

1. **去重合并**：同一个概念可能被记录了多次（初次记录、补充修正、换表述重述），只保留最准确、最完整的版本。如果两段说的是一件事，合并它们，不要各留一份。**即使两条笔记的措辞不同，只要描述的是同一个知识点，就是重复——必须合并。当不确定是否重复时，宁可合并也不要保留两份。**
2. **渐进修正优先**：如果同一概念有多条记录，保留对话后期修正后的版本。后续修正的版本比初始版本更准确。
3. **删除元对话**：删除"AI问"、"用户答"、"我们讨论了"、"AI通过用户笔记中的关键词推断"、"推测"、"似乎"等对话过程描述，只保留知识内容本身。任何描述 AI 推理过程（如"AI根据XX推断出YY"）或对话动态的句子必须完全删除。**尤其删除所有"修正链路"——不要写"先以为是X，后来纠正为Y""最初理解为A，经过讨论后修正为B"等句子。只保留最终正确的版本，删除修正过程的任何描述。如果整条笔记只是对前一条的修正，合并后只保留修正后的版本。**
4. **结构化组织**：用 ## 标题按知识点分组。一组相关概念放在一起。按照从基础到进阶的逻辑顺序排列。
5. **保留学习者口吻**：用学习者自己的表述（从对话中提取），不改写成教科书语气。
6. **公式完整准确**：保留对话中确认过的公式，用 $...$ 或 $$...$$ 格式。禁止脑补未确认的公式。
7. **保留关键例子**：对话中如果出现了有助于理解的具体例子，保留它。
8. **紧凑无废话**：删除过渡句、重复定义，同一概念只说一次。整体篇幅控制在合理范围内。
9. **连贯成文**：合并后的文档应该是一篇逻辑流畅的完整文章，而不是笔记片段的堆砌。调整片段之间的顺序和过渡，让上下文自然衔接。合并内容相近的段落，删除衔接生硬的片段边界。最终读者应该感觉这是一气呵成写的，而非多段拼凑的。

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


def _extract_mentioned_concepts(session: dict) -> list:
    """Extract mentioned concepts from the session's enriched context, excluding
    concepts that already exist as children of the current node.

    Lazily triggers post-response concept extraction from the AI's latest reply,
    so the chips reflect what was actually taught rather than broad conversation topics.
    """
    # Trigger post-response extraction if not yet done this turn
    if not session.get("_response_concepts") and not session.get("_response_extraction_attempted"):
        session["_response_extraction_attempted"] = True
        try:
            _refresh_response_concepts(session)
        except Exception:
            pass

    enriched = session.get("_enriched_context", {}) or {}
    # Prefer post-response concepts (extracted from AI's actual reply) over
    # pre-processing concepts (extracted from conversation history before AI responded)
    raw_concepts = session.get("_response_concepts") or enriched.get("concepts", [])
    if not raw_concepts:
        return []

    # Fetch existing child names so we can skip concepts the user already has
    existing_names: set = set()
    oid = session.get("owner_id", "")
    nid = session.get("node_id", "")
    if oid and nid:
        try:
            from tree_repository_sqlite import get_db_ctx as _get_db_ctx
            with _get_db_ctx() as _conn:
                rows = _conn.execute(
                    "SELECT name FROM nodes WHERE owner_id = ? AND parent_id = ? AND is_deleted = 0",
                    (oid, nid)
                ).fetchall()
                existing_names = {r["name"] for r in rows}
                # Also exclude current node's own name
                self_row = _conn.execute(
                    "SELECT name FROM nodes WHERE id = ? AND owner_id = ? AND is_deleted = 0",
                    (nid, oid)
                ).fetchone()
                if self_row and self_row["name"]:
                    existing_names.add(self_row["name"])
        except Exception:
            pass
    elif nid:
        kps = session.get("knowledge_points", [])
        if kps:
            node_name = kps[0].get("title", "")
            if node_name:
                existing_names.add(node_name)

    result = []
    for c in raw_concepts:
        name = c.get("name", "")
        if name in existing_names:
            continue
        result.append({
            "name": name,
            "category": c.get("category", ""),
            "definition": c.get("definition", ""),
            "prerequisites": c.get("prerequisites", []),
            "expansion_directions": c.get("expansion_directions", []),
            "verified": c.get("verified", False),
            "wiki_summary": c.get("wiki_summary", ""),
            "wiki_description": c.get("wiki_description", ""),
        })
    return result


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


def _collect_previous_knowledge_notes(session: dict) -> list[str]:
    """Collect all knowledge_note fragments from prior AI messages in this session."""
    notes = []
    for m in session.get("messages", []):
        meta = m.get("metadata", {})
        if isinstance(meta, dict):
            note = meta.get("knowledge_note", "")
            if note and note.strip():
                notes.append(note.strip())
    return notes


def _build_conversation_context(session: dict, owner_id: str = "", current_node_id: str = "", existing_content_tail: str = "", tone: dict = None, gap_warning: str = "") -> str:
    """Build conversation context string for the AI prompt.

    Includes: reference material, filtered knowledge matches (from enrichment pipeline),
    tone instruction, gap warning, conversation history, and existing note content tail.
    Uses enriched context (concept extraction + knowledge retrieval by content) when available,
    falling back to the full knowledge profile only when enrichment hasn't run.
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

    # ── Enriched context (concept extraction + knowledge retrieval by content) ──
    enriched = session.get("_enriched_context", {}) or {}
    concept_ctx = enriched.get("concept_context", "")
    personalized = enriched.get("personalized_context", "")
    expansion = enriched.get("expansion_context", "")
    def_chain = enriched.get("definition_chain", "")

    if concept_ctx:
        lines.append(f"\n{concept_ctx}")
    if personalized:
        lines.append(f"\n{personalized}")
    if expansion:
        lines.append(f"\n{expansion}")
    if def_chain:
        lines.append(f"\n{def_chain}")

    # ── Gap warning (from code-level knowledge_gap_detector) ──
    if gap_warning:
        lines.append(f"\n{gap_warning}")

    # ── Tone instruction (from code-level tone_wrapper) ──
    if tone and tone.get("instruction"):
        lines.append(f"\n{tone['instruction']}")

    # Fallback: full knowledge profile only if enrichment didn't produce personalized context
    # This prevents the "same KP every turn" problem when enrichment is working
    if not personalized:
        nid = current_node_id or session.get("node_id", "")
        if oid and nid:
            profile = build_knowledge_profile(oid, nid)
            if profile:
                lines.append(f"\n{profile}")

    # Declare authority: when knowledge profile and reference material both exist,
    # the reference material is the ground truth.
    nid = current_node_id or session.get("node_id", "")
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

    # Inject compressed memories from previous chat sessions on this node
    if oid and nid:
        try:
            memories = get_node_chat_memories(oid, nid, limit=5)
            if memories:
                lines.append("\n【本知识点历史对话摘要】以下是之前关于此知识点的对话压缩记录，请参考其中的讨论内容和学习进度，避免重复已讨论过的话题：")
                for i, mem in enumerate(memories):
                    lines.append(f"  [历史对话{i+1}] {mem['compressed_summary']}")
        except Exception:
            pass

    # Include existing note content tail for dedup and style matching
    if existing_content_tail.strip():
        lines.append(f"\n【已有笔记内容（尾部）】请检查以下内容，避免重复记录已存在的知识点，并匹配其记叙方式和排版格式：\n{existing_content_tail}")

    # Extract chapter titles from already-generated content for continuity awareness
    generated = session.get("generated_content", "")
    if generated.strip():
        import re as _re
        chapters = _re.findall(r'^##\s+(.+)$', generated, _re.MULTILINE)
        if chapters:
            lines.append(f"\n【已生成的章节】已写过的章节标题：{'、'.join(chapters)}。新生成的笔记章节应避免与这些章节标题重复，内容上也要自然衔接而非另起炉灶。")

    # Inject previous knowledge notes from this session for dedup
    prev_notes = _collect_previous_knowledge_notes(session)
    if prev_notes:
        lines.append("\n【已记录的知识笔记】以下笔记已在本对话中生成过，请勿在本次knowledge_note中重复这些内容（只记录本轮出现的新知识）：")
        for i, note in enumerate(prev_notes):
            lines.append(f"  [{i+1}] {note}")

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


# ── Chat compression ──────────────────────────────────────────────────

COMPRESS_CHAT_SYSTEM = """你是一个对话压缩专家。你的任务是将一段师生对话压缩成简洁的摘要，供后续对话作为上下文参考。

# 压缩规则

1. 提取对话中讨论过的**核心知识点**（概念、定义、公式等）
2. 记录用户的**理解水平**（哪些概念已掌握，哪些还在学习中）
3. 记录用户**问过的问题**和AI的解答要点
4. 记录对话的**进度**（讨论到了哪个子话题、还剩什么没讨论）
5. 删除寒暄、过渡语、重复确认等非知识性内容
6. 直接陈述知识内容，不要加"我学到了""我问了"等前缀，用简洁的陈述句记录

# 输出格式

返回JSON：
{
  "summary": "压缩后的对话摘要（200-400字，中文），包含：已讨论的核心概念、我的理解状态、关键问答、对话进度"
}"""


def compress_chat_session(session_id: str) -> Dict[str, Any]:
    """Compress a chat session's messages into a concise summary and store it as node memory."""
    session = load_session(session_id)
    if not session:
        raise ValueError(f"Session not found: {session_id}")

    messages = session.get("messages", [])
    if len(messages) < 2:
        raise ValueError("对话轮次太少，无需压缩")

    node_id = session["node_id"]
    owner_id = session["owner_id"]

    # Build conversation text
    history_lines = []
    for msg in messages:
        role_label = "AI" if msg["role"] == "ai" else "用户"
        content = msg.get("content", "")
        if content.strip():
            history_lines.append(f"{role_label}: {content}")

    conversation_text = "\n".join(history_lines)

    # Get node name
    node_name = ""
    kps = session.get("knowledge_points", [])
    if kps:
        node_name = kps[0].get("title", "")

    user_prompt = f"知识点名称：{node_name}\n\n对话历史（{len(messages)}条消息）：\n\n{conversation_text}\n\n请压缩上面的对话为简洁摘要。严格按照JSON格式回复。"

    try:
        raw = call_deepseek([
            {"role": "system", "content": COMPRESS_CHAT_SYSTEM},
            {"role": "user", "content": user_prompt},
        ])
        result = json.loads(raw)
    except Exception:
        # Fallback: build a simple summary from message metadata
        result = _fallback_compress(messages, node_name)

    summary = result.get("summary", "")
    if not summary.strip():
        summary = _fallback_compress(messages, node_name).get("summary", "")

    # Store in node_chat_memories
    memory_id = str(uuid4())
    with get_db_ctx() as conn:
        conn.execute(
            """INSERT INTO node_chat_memories (id, owner_id, node_id, session_id,
               compressed_summary, message_count)
               VALUES (?, ?, ?, ?, ?, ?)""",
            (memory_id, owner_id, node_id, session_id, summary, len(messages)),
        )

    # Mark session as completed
    session["status"] = "completed"
    session["last_activity_at"] = time.time()
    save_session(session)

    return {
        "memory_id": memory_id,
        "node_id": node_id,
        "summary": summary,
        "message_count": len(messages),
    }


def _fallback_compress(messages: list, node_name: str) -> dict:
    """Build a simple compression from message metadata when LLM call fails."""
    knowledge_notes = []
    topics = set()
    question_count = 0

    for msg in messages:
        meta = msg.get("metadata", {})
        if isinstance(meta, dict):
            note = meta.get("knowledge_note", "")
            if note and note.strip():
                knowledge_notes.append(note.strip())
            sub = meta.get("sub_topic", "")
            if sub and sub.strip():
                topics.add(sub.strip())
        if msg.get("role") == "user" and msg.get("content", "").strip().endswith("?"):
            question_count += 1

    parts = [f"围绕「{node_name}」进行了{len(messages)}轮对话。"]
    if topics:
        parts.append(f"讨论过的子话题：{'、'.join(topics)}。")
    if knowledge_notes:
        parts.append(f"学到的知识点：{'；'.join(knowledge_notes[-5:])}")
    parts.append(f"用户共提出了{question_count}个问题。")

    return {"summary": " ".join(parts)}


def get_node_chat_memories(owner_id: str, node_id: str, limit: int = 5) -> list:
    """Fetch compressed chat memories for a node, most recent first."""
    with get_db_ctx() as conn:
        rows = conn.execute(
            """SELECT * FROM node_chat_memories
               WHERE owner_id = ? AND node_id = ?
               ORDER BY compressed_at DESC LIMIT ?""",
            (owner_id, node_id, limit),
        ).fetchall()
    return [dict(r) for r in rows]

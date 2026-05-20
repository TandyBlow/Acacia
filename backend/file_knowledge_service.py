"""
File-based knowledge point extraction and conversation management service.
Uses DeepSeek API for AI-powered knowledge extraction and dialogue.
"""
import json
import os
import re
import glob
import time
from typing import List, Dict, Any
from uuid import uuid4

import httpx

from database import get_db_ctx
from file_parser import parse_file
from session_store import load_session, save_session

# DeepSeek API configuration
DEEPSEEK_API_KEY = os.getenv("DEEPSEEK_API_KEY")
if not DEEPSEEK_API_KEY:
    raise RuntimeError("DEEPSEEK_API_KEY 环境变量未设置")
DEEPSEEK_BASE_URL = "https://api.deepseek.com"
DEEPSEEK_MODEL = "deepseek-chat"

# Knowledge extraction prompt
KNOWLEDGE_EXTRACTION_PROMPT = """你是一个知识点提取助手。用户会提供学习材料，你需要：

1. 仔细阅读材料，提取出3-15个核心知识点（可独立理解的最小概念单元）
2. 为每个知识点分类：concept（概念）、principle（原理）、application（应用）、comparison（对比）、procedure（步骤方法）
3. 为每个知识点提供完整的上下文信息，包括原文段落、精确定义、示例和常见误解
4. 如果知识点超过10个，按主题分组

返回JSON格式：
{
  "total_count": 总知识点数,
  "groups": [
    {
      "group_name": "分组名称",
      "knowledge_points": [
        {
          "id": "kp_1",
          "title": "知识点标题（≤20字）",
          "type": "concept|principle|application|comparison|procedure",
          "brief": "一句话概括（≤50字）",
          "source_content": "原文中关于该知识点的核心段落，原文照录，50-200字。这是后续对话的事实依据，必须包含。",
          "correct_definition": "基于原文的准确一句话定义。这是评估学生回答的标准答案，必须精确。",
          "common_misconceptions": ["常见误解1", "常见误解2"],
          "key_example": "原文中的一个具体例子，或从原文合成的一个具体例子。必须包含具体细节。"
        }
      ]
    }
  ]
}

关键要求：
- source_content必须是原文中的确切内容或紧密概括，不能凭空编造。这是整个对话系统的事实基础
- correct_definition是对原文定义的精确概括，将作为评估用户回答的标准答案
- **缩写展开规则**：如果知识点标题是缩写（如"OML""SGD"等纯大写字母组合），correct_definition必须以"全称（缩写）"的格式给出完整展开。如果原文中未给出该缩写的完整定义，在title中标注"OML（未定义缩写）"并在common_misconceptions的首位注明"原文未定义此缩写，可能指代多种含义"
- common_misconceptions列出1-3个学生容易犯的典型错误，用于设计能暴露误解的问题
- key_example要具体、可验证，包含足够的细节让人能真正理解
- 如果知识点≤10个，所有知识点放在一个分组中，group_name为"全部"
- 如果知识点>10个，按主题合理分组（每组3-5个知识点）
- procedure类型用于需要计算步骤示例的方法（如牛顿法、积分技巧、矩阵运算等）
"""

# Question generation prompt template
QUESTION_GENERATION_PROMPT = """你是一个知识提问助手。你的目标是根据用户的知识水平，灵活选择"直接讲授"或"引导追问"策略来帮助用户理解知识点。

# 策略选择原则

首先根据用户知识档案判断：如果该知识点在用户档案中标记为🆕新(<0.3)或📖学习中(0.3-0.7)，**优先使用"直接定义+验证理解"策略**。只有当用户档案显示已掌握相关前置知识(✅已掌握 >0.7)时，才使用其他追问策略。

# 硬规则：知识点名称是缩写时先确认

如果知识点的标题是一个纯大写字母缩写（2-5个字符，如"OML""SGD""KL"），且其标准定义和原文内容中没有给出该缩写的完整展开，则**必须**生成确认型问题："你先告诉我XX是啥"或"你知道XX是啥吗？"——不要假设它是什么，不要围绕它设计追问。

注意：上述规则仅适用于纯大写字母缩写。如果知识点名称是自然语言短语（中文或英文单词），即使它在用户知识档案中标记为"新"，也不要问"你了解XX吗？"——直接用策略0（直接定义+验证理解），基于原文内容给出定义。

核心要求：
- 不要使用固定模板提问（如每次都问"用你自己的话说XX是什么？""你理解XX吗？"）
- 基于知识点的具体内容设计问题，让每个问题都独特
- 使用多种提问策略交替使用，避免重复。连续两个知识点的问题不能是同一种策略。
- 问题要具体，与用户可能有的日常经验或已知知识关联
- 从"关键示例"中提取灵感，设计基于场景的问题
- 如果有"常见误解"，设计能暴露误解的问题
- 问题长度控制在1-3句话，保持自然对话感
- 不要用审问式措辞（"你理解吗？""你懂了吗？"），用更自然的表达（"这部分清楚了？""到这里有问题吗？""你觉得这个解释怎么样？"）
- 如果知识点内容本身就很基础，直接给出定义然后问一个简单的确认性问题即可，不要为了追问而追问

提问策略库（根据用户知识水平选择，保持多样性）：
0. 直接定义+验证理解：先给出知识点的精确定义（用准确术语，不用比喻），然后问一个简单的确认性问题（如"这个定义里有哪部分需要我展开解释的吗？"）。**这是零基础用户的默认策略**
1. 类比提问："你觉得XX和[用户已掌握的熟悉概念]有什么相似之处？"（注意：仅在用户已掌握类比对象时使用）
2. 反例提问："为什么[看似合理的错误说法]是不对的？"
3. 场景提问："假设你在[具体场景]，你会怎么用XX？"
4. 分层提问：先问直觉理解层面，探探用户的基础
5. 对比提问："XX和YY的关键区别是什么？在什么情况下用XX而不是YY？"
6. 追溯提问："如果不用XX，你会怎么解决这个问题？为什么XX更好？"
7. 纠错提问：提出一个包含常见误解的说法，问用户是否同意并解释
8. Why-not提问："为什么不能用[看起来可行的替代方案]？"

问题设计原则：
- 每个问题都应该促使用户思考，而不是简单地回忆定义
- 将知识点嵌入具体情境中提问
- 如果知识点有key_example，围绕这个例子设计问题
- 如果知识点有common_misconceptions，设计能暴露这些误解的问题
- 避免抽象空泛的"你觉得XX是什么意思"类问题

返回JSON格式：
{
  "question": "具体问题（自然对话风格，1-3句话）",
  "hints": ["提示1（先给出精确定义）", "提示2（如果用户仍不理解，给一个具体例子）"],
  "strategy_used": "使用的策略名称"
}
"""

# Answer evaluation prompt template
ANSWER_EVALUATION_PROMPT = """你是一个知识导师，通过自然对话帮助用户深入理解知识点。你的核心能力是在"直接讲授"和"引导追问"之间灵活切换。

# 最高原则：定义优先

当用户表示不理解、说"不知道"、或回答错误时，**第一步永远是给出精确定义**。定义要使用准确的术语，不要用比喻替代定义。用户需要从定义中发现自己缺失哪些前置知识——这是我们期望的"追本溯源"式学习路径。比喻遮蔽知识依赖链，只在用户已掌握所有前置知识且仅对定义本身不好理解时才能使用。

# 硬规则：禁止猜测未定义缩写

当你遇到你不确定的缩写或术语时（尤其是纯大写字母的短缩写如 OML、SGD、KL 等），适用以下规则：
- 如果你无法从原文内容或对话上下文中确定该缩写的完整含义，**绝对禁止猜测**
- 直接追问用户："你先告诉我XX是啥"
- 不要展开解释，不要假设它指什么，不要用"可能是..."开头
- 即使你处于 direct teaching 模式，如果术语含义不确定，仍必须先确认

# 核心原则

- 将用户回答与"标准定义"和"原文内容"进行比对，以原文为准确依据
- 绝不接受与标准定义明显矛盾的错误回答
- 如果你发现自己在之前的对话中对用户说了与原文不符的内容，必须主动纠正
- 如果你无法根据原文确定用户回答是否正确，诚实说"我不确定"
- 给定义用精确术语，不要用比喻替代定义
- 追问要自然，像人在对话，不要像在审问

# 对话风格与学习关怀

- 温暖、自然。你是一个关心学生是否真学会了的导师，不是一个答题机器。
- 不要用"好，那我们把这个知识点记下来""我们来学习""首先""接下来"等固定模板——每次回复都应该是独特的。
- 注意观察用户的状态：回答越来越短可能是累了，连续说"理解""嗯""好的"可能没有真正在思考。适时表达关心。
- 如果用户全程只是被动确认（嗯、理解、好的），几乎没有主动输出过自己的理解，在结束时诚实地说出来，不要假装用户学会了。
- 不要在用户还没理解的情况下就匆忙推进到下一个知识点。

# 反馈检测与模式切换

- 用户**第1次**说"不知道"或回答错误：给出精确定义，然后自然地问一句"这部分清楚了吗？"——不要用"你理解了吗？"这种审问式措辞
- 用户**连续2次**回答错误或不理解：切换到直接讲授模式。不再追问，直接解释概念，拆解成更小的部分逐一说明。语气上表达共情："这个确实不太好理解，我换个方式说。"
- 用户**连续3次以上**仍不理解：不要继续死磕。主动建议："这个概念依赖几个前置知识，你的知识树里好像还没有。要不要先去建一下相关的知识点，回头再来看？"使用summarize_and_move_on给正确答案并过渡。

可用动作：
- "accept"：用户回答与标准定义一致，完整准确 → 真诚地肯定用户的回答（不要只说"好""对"），自然地补充关键示例，然后过渡。**禁止说"把这个知识点记下来"之类的话**——你只需要正常地确认和补充就行。
- "follow_up"：回答部分正确但不完整 → 先指出对的部分，让用户感到被认可，然后自然地追问遗漏的要点。不要用审问式语气。
- "hint"：回答错误或说"不知道" → **先给出基于标准定义的精确解释**，然后问一个确认性问题。注意：hint的核心是补定义，不是给比喻
- "progressive_hint"：已追问2次但用户仍未掌握 → 切换到直接讲授，给出更完整的解释，不要继续追问。表达共情："这个确实容易搞混，我直接讲一下。"
- "show_source"：用户表示看不到原文材料、不知道题目在问什么、不理解问题背景、或要求查看原始内容 → 在next_message中直接提供原文内容（source_content）和标准定义，帮助用户建立上下文，然后邀请用户基于原文重新回答。注意：这不是用户知识不足，而是缺少上下文，所以态度要友好，不要说"你答错了"
- "correct_self"：你自己在之前对话中对用户说的话有误，与原文矛盾 → 明确说"我之前说的不准确"，然后给出基于原文的正确说法
- "admit_uncertainty"：原文材料中没有足够信息来判断用户回答的对错 → 诚实说"原文中没有覆盖这一点，我不确定"
- "summarize_and_move_on"：已追问2次且用户仍无法给出合理回答 → 用友好的语气给出正确答案，不要让用户感到挫败。可以说"这个确实不太好理解，我给你总结一下"，然后自然过渡

返回JSON格式：
{
  "action": "accept|follow_up|hint|progressive_hint|show_source|correct_self|admit_uncertainty|summarize_and_move_on",
  "reason": "判断理由（必须引用标准定义或原文内容作为依据）",
  "next_message": "给用户的回复（自然对话风格）"
}

自我纠错详细规则：
- 仔细对比你之前在对话中发给用户的消息与原文内容和标准定义
- 如果你发现你给出的定义、例子或解释与原文矛盾，必须使用"correct_self"动作
- 纠正时要具体说明：哪句话有问题，为什么，正确的应该是什么
- 示例回复："我之前说因子是概率表中的数值，这个说法不准确。实际上，因子（factor）是一个函数，将一组随机变量的每一种联合取值映射到一个非负实数。比如φ(A,B)就是一个二维表，表示A和B的联合概率分布。让我纠正一下..."

不确定性规则：
- 如果用户问的侧面原文中没有覆盖，使用"admit_uncertainty"
- 示例回复："这个问题原文材料中没有详细涉及，我不确定答案。建议你查阅更全面的资料来确认。"

追问控制规则：
- 如果用户已经回答了2次以上但仍未达到标准定义的要求，使用"summarize_and_move_on"
- summarize_and_move_on时要友好地给出基于标准定义的正确答案，不要让用户感到挫败
- 如果用户在第2-3次回答中展现出进步，可以继续follow_up而不是强制结束
- 不要在用户第一次回答错误时就使用summarize_and_move_on
"""

# Content generation prompt template
CONTENT_GENERATION_PROMPT = """你是一个笔记生成助手。根据对话内容生成一份学习笔记。

输入信息包括：
- 知识点标题、类型、标准定义
- 原文相关段落
- 原文中的关键示例
- 用户与AI的完整对话历史

生成的笔记要求：
1. 直接写学到了什么，用学习者的口吻，不要出现"用户""AI""你""我"等对话角色
2. 保留学习者自己的表述和用词（从他的回答中提取），不要替他改写
3. 如果学习者理解有偏差，温和修正，但修正部分融入笔记中，不要标注"修正"或"纠正"
4. 公式只写原文中有或对话中确认过的，禁止自己推导或补充未确认的公式
5. 必须包含原文中的关键示例或一个具体的应用场景
6. 如果对话中AI进行了自我纠正（correct_self），笔记中只体现正确的版本
7. 使用Markdown格式，100-200字

返回JSON格式：
{
  "content": "生成的笔记内容（Markdown）",
  "included_example": "使用了哪个示例（来自原文还是AI生成的）",
  "accuracy_note": "如果用户理解与标准定义有偏差，简要说明修正了什么；无偏差则为空字符串"
}
"""

# Example generation prompt template for procedure-type knowledge points
EXAMPLE_GENERATION_PROMPT = """你是一个数学例题生成助手。根据用户对方法的理解，生成一个完整的计算例题。

要求：
1. 例题必须体现用户理解的核心思路
2. 使用 LaTeX 格式（行内公式 $...$，块级公式 $$...$$）
3. 包含：问题描述 + 完整的分步骤解答
4. 每个步骤要有说明文字
5. 100-300字

返回JSON格式：
{
  "example_content": "Markdown格式的例题内容（包含LaTeX）",
  "explanation": "为什么这个例题能说明用户的理解"
}

注意：
- 例题要具体，不要太抽象
- 步骤要清晰，每步都有说明
- LaTeX 语法要正确
"""


def call_deepseek(messages: List[Dict[str, str]]) -> str:
    """Call DeepSeek API."""
    headers = {
        "Authorization": f"Bearer {DEEPSEEK_API_KEY}",
        "Content-Type": "application/json",
    }
    payload = {
        "model": DEEPSEEK_MODEL,
        "messages": messages,
        "temperature": 0.7,
    }

    with httpx.Client(timeout=60.0) as client:
        resp = client.post(f"{DEEPSEEK_BASE_URL}/v1/chat/completions", headers=headers, json=payload)
        resp.raise_for_status()

    data = resp.json()
    return data["choices"][0]["message"]["content"]


def _sanitize_control_chars(text: str) -> str:
    """Replace JSON-invalid control characters (except whitespace: \\t, \\n, \\r)."""
    return re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f]", " ", text)


def _clean_dict_strings(obj: Any) -> Any:
    """Recursively sanitize control characters in all string values of a dict/list."""
    if isinstance(obj, str):
        return _sanitize_control_chars(obj)
    if isinstance(obj, dict):
        return {k: _clean_dict_strings(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_clean_dict_strings(v) for v in obj]
    return obj


def _fix_newlines_in_strings(text: str) -> str:
    """Replace literal newlines inside JSON string values with \\n."""
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
    """Find outermost JSON object/array boundary, skipping string contents."""
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
    """Parse JSON from LLM response, handling code blocks and control characters."""
    sanitized = _sanitize_control_chars(raw)

    try:
        return json.loads(sanitized, strict=False)
    except json.JSONDecodeError:
        pass

    # Strategy 1: Try to extract JSON from code block
    match = re.search(r"```(?:json)?\s*\n?(.*?)\n?\s*```", sanitized, re.DOTALL)
    if match:
        try:
            return json.loads(match.group(1), strict=False)
        except json.JSONDecodeError:
            pass

    # Strategy 2: Extract outermost JSON object/array via string-aware brace matching
    for opener, closer in [("{", "}"), ("[", "]")]:
        boundary = _find_json_boundary(sanitized, opener, closer)
        if boundary is None:
            continue
        start, end = boundary
        candidate = sanitized[start:end]
        # Fix trailing commas before closing braces/brackets
        candidate = re.sub(r",(\s*[}\]])", r"\1", candidate)
        try:
            return json.loads(candidate, strict=False)
        except json.JSONDecodeError:
            pass

    # Strategy 3: Try to fix unescaped newlines in string values
    # LLMs sometimes put real newlines inside JSON string values
    for opener, closer in [("{", "}"), ("[", "]")]:
        boundary = _find_json_boundary(sanitized, opener, closer)
        if boundary is None:
            continue
        start, end = boundary
        candidate = sanitized[start:end]
        # Replace literal newlines inside quoted strings with \\n
        candidate = _fix_newlines_in_strings(candidate)
        candidate = re.sub(r",(\s*[}\]])", r"\1", candidate)
        try:
            return json.loads(candidate, strict=False)
        except json.JSONDecodeError:
            pass

    # Log the raw response for debugging before raising
    preview = raw[:500] if len(raw) > 500 else raw
    raise ValueError(f"LLM response is not valid JSON. Raw response preview: {preview}")


def extract_knowledge_points(file_id: str, owner_id: str) -> Dict[str, Any]:
    """
    Extract knowledge points from uploaded file.

    Args:
        file_id: Uploaded file ID
        owner_id: User ID

    Returns:
        Dictionary with total_count and groups of knowledge points
    """
    # Read file content
    file_path = f"/tmp/acacia_uploads/{owner_id}/{file_id}"

    # Find file with any extension
    matching_files = glob.glob(f"{file_path}.*")
    if not matching_files:
        raise FileNotFoundError(f"File not found: {file_id}")

    file_path = matching_files[0]
    text_content = parse_file(file_path)

    if not text_content.strip():
        raise ValueError("文件内容为空")

    # Call DeepSeek to extract knowledge points
    messages = [
        {"role": "system", "content": KNOWLEDGE_EXTRACTION_PROMPT},
        {"role": "user", "content": f"请从以下材料中提取知识点：\n\n{text_content}"}
    ]

    raw_response = call_deepseek(messages)
    result = parse_json_response(raw_response)

    # Validate response structure
    if "total_count" not in result or "groups" not in result:
        raise ValueError("Invalid response structure from AI")

    # Validate mandatory fields on each knowledge point
    required_fields = ["source_content", "correct_definition", "key_example"]
    for group in result.get("groups", []):
        for kp in group.get("knowledge_points", []):
            missing = [f for f in required_fields if not kp.get(f)]
            if missing:
                raise ValueError(
                    f"知识点 '{kp.get('title', 'unknown')}' 缺少必填字段: {', '.join(missing)}。"
                    f"请AI重新提取。"
                )
            # Ensure common_misconceptions is at least an empty list
            if "common_misconceptions" not in kp:
                kp["common_misconceptions"] = []

    return result


def generate_question_for_knowledge_point(kp: Dict[str, Any]) -> Dict[str, Any]:
    """
    Generate a question for a specific knowledge point.

    Args:
        kp: Knowledge point dictionary with id, title, type, brief

    Returns:
        Dictionary with question and hints
    """
    messages = [
        {"role": "system", "content": QUESTION_GENERATION_PROMPT},
        {"role": "user", "content": f"""
知识点完整信息：
- 标题：{kp['title']}
- 类型：{kp['type']}
- 简介：{kp['brief']}
- 标准定义：{kp.get('correct_definition', kp['brief'])}
- 原文内容：{kp.get('source_content', kp['brief'])}
- 关键示例：{kp.get('key_example', '无')}
- 常见误解：{', '.join(kp.get('common_misconceptions', [])) or '无'}

请基于以上完整信息生成一个引导性问题。
"""}
    ]

    raw_response = call_deepseek(messages)
    result = parse_json_response(raw_response)

    return result


def evaluate_user_answer(
    kp: Dict[str, Any],
    question: str,
    user_answer: str,
    follow_up_count: int = 0
) -> Dict[str, Any]:
    """
    Evaluate user's answer and decide next action.

    Args:
        kp: Knowledge point dictionary
        question: The question asked
        user_answer: User's answer
        follow_up_count: Number of follow-ups so far

    Returns:
        Dictionary with action, reason, next_message
    """
    # Pass follow_up_count to the LLM for context-aware decisions.
    # The LLM decides whether to accept, give progressive hints, or summarize-and-move-on.
    # No hardcoded auto-accept — the LLM verifies against source content every time.

    messages = [
        {"role": "system", "content": ANSWER_EVALUATION_PROMPT},
        {"role": "user", "content": f"""
知识点完整上下文：
- 标题：{kp['title']}
- 类型：{kp['type']}
- 简介：{kp['brief']}
- 标准定义（正确答案）：{kp.get('correct_definition', kp['brief'])}
- 原文内容：{kp.get('source_content', kp['brief'])}
- 关键示例：{kp.get('key_example', '无')}
- 常见误解：{', '.join(kp.get('common_misconceptions', [])) or '无'}

我的问题：{question}
用户的回答：{user_answer}
已追问次数：{follow_up_count}

请基于以上信息评估用户的回答。将用户回答与标准定义和原文内容进行比对，判断其准确性。
"""}
    ]

    raw_response = call_deepseek(messages)
    result = parse_json_response(raw_response)

    return result


def generate_content_from_answer(
    kp: Dict[str, Any],
    question: str,
    user_answer: str,
    conversation_history: List[Dict[str, str]]
) -> str:
    """
    Generate note content based on user's answer.

    Args:
        kp: Knowledge point dictionary
        question: The question asked
        user_answer: User's final answer
        conversation_history: Full conversation for this knowledge point

    Returns:
        Generated Markdown content
    """
    # Build conversation context
    conversation_text = "\n".join([
        f"{msg['role']}: {msg['content']}"
        for msg in conversation_history
    ])

    messages = [
        {"role": "system", "content": CONTENT_GENERATION_PROMPT},
        {"role": "user", "content": f"""
知识点：{kp['title']}
类型：{kp['type']}
标准定义：{kp.get('correct_definition', kp['brief'])}
关键示例：{kp.get('key_example', '无')}

对话历史：
{conversation_text}

最终问题：{question}
用户的回答：{user_answer}

原始材料片段：
{kp.get('source_content', kp['brief'])}

请生成笔记内容。确保包含原文中的关键示例或具体应用场景。
"""}
    ]

    raw_response = call_deepseek(messages)
    result = parse_json_response(raw_response)

    return result.get("content", "")


def generate_example_for_procedure(
    kp: Dict[str, Any],
    user_answer: str,
    conversation_history: List[Dict[str, str]],
    previous_example: str | None = None,
    user_feedback: str | None = None
) -> Dict[str, Any]:
    """
    Generate a calculation example for procedure-type knowledge point.

    Args:
        kp: Knowledge point dictionary
        user_answer: User's final answer explaining their understanding
        conversation_history: Full conversation for this knowledge point
        previous_example: Previous generated example (for regeneration)
        user_feedback: User's feedback on previous example (for regeneration)

    Returns:
        Dictionary with example_content and explanation
    """
    # Build conversation context
    conversation_text = "\n".join([
        f"{msg['role']}: {msg['content']}"
        for msg in conversation_history
    ])

    # Build prompt
    prompt_parts = [
        f"知识点：{kp['title']}",
        f"类型：{kp['type']}",
        f"简介：{kp['brief']}",
        "",
        "对话历史：",
        conversation_text,
        "",
        f"用户的理解：{user_answer}",
    ]

    if kp.get('source_content'):
        prompt_parts.extend([
            "",
            "原始材料片段：",
            kp['source_content']
        ])

    # Add regeneration context if provided
    if previous_example and user_feedback:
        prompt_parts.extend([
            "",
            "之前生成的例题：",
            previous_example,
            "",
            "用户的反馈：",
            user_feedback,
            "",
            "请根据反馈重新生成一个不同的例题。"
        ])

    user_content = "\n".join(prompt_parts)

    messages = [
        {"role": "system", "content": EXAMPLE_GENERATION_PROMPT},
        {"role": "user", "content": user_content}
    ]

    raw_response = call_deepseek(messages)
    result = parse_json_response(raw_response)

    # Validate response structure
    if "example_content" not in result:
        raise ValueError("Invalid example generation response: missing example_content")

    return result


# Conversation session persistence via SQLite.
# Delegated to session_store.py — use load_session() / save_session() directly.


def create_conversation_session(
    node_id: str,
    owner_id: str,
    file_id: str,
    knowledge_points: List[Dict[str, Any]]
) -> str:
    """
    Create a new conversation session.

    Args:
        node_id: Target node ID
        owner_id: User ID
        file_id: Uploaded file ID
        knowledge_points: List of selected knowledge points

    Returns:
        Session ID
    """
    session_id = str(uuid4())

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
    }

    save_session(session)
    return session_id


def get_conversation_session(session_id: str) -> Dict[str, Any]:
    """Get conversation session by ID."""
    session = load_session(session_id)
    if not session:
        raise ValueError(f"Session not found: {session_id}")

    # Update last activity
    session["last_activity_at"] = time.time()
    return session


def get_session_for_resume(session_id: str, owner_id: str) -> Dict[str, Any]:
    """Get full session state for resume, with ownership validation."""
    session = load_session(session_id)
    if not session:
        raise ValueError(f"Session not found: {session_id}")

    if session["owner_id"] != owner_id:
        raise PermissionError("无权访问此会话")

    session["last_activity_at"] = time.time()

    knowledge_points = session["knowledge_points"]
    current_index = session["current_index"]
    current_kp = knowledge_points[current_index] if current_index < len(knowledge_points) else {}

    return {
        "session_id": session["session_id"],
        "node_id": session["node_id"],
        "file_id": session["file_id"],
        "knowledge_points": knowledge_points,
        "current_index": current_index,
        "messages": session["messages"],
        "generated_content": session["generated_content"],
        "status": session["status"],
        "created_at": session["created_at"],
        "last_activity_at": session["last_activity_at"],
        "follow_up_count": session["follow_up_count"],
        "pending_example": session.get("pending_example"),
        "example_history": session.get("example_history", []),
        "progress": {
            "current": current_index,
            "total": len(knowledge_points),
            "kp_title": current_kp.get("title", ""),
            "kp_type": current_kp.get("type", ""),
        },
    }


def start_conversation(
    node_id: str,
    owner_id: str,
    file_id: str,
    knowledge_points: List[Dict[str, Any]]
) -> Dict[str, Any]:
    """
    Start a new conversation session and generate first question.

    Args:
        node_id: Target node ID
        owner_id: User ID
        file_id: Uploaded file ID
        knowledge_points: List of selected knowledge points

    Returns:
        Dictionary with session_id, question, and current knowledge point info
    """
    if not knowledge_points:
        raise ValueError("No knowledge points provided")

    session_id = create_conversation_session(node_id, owner_id, file_id, knowledge_points)
    session = load_session(session_id)

    try:
        # Generate first question
        current_kp = knowledge_points[0]
        question_data = generate_question_for_knowledge_point(current_kp)

        # Add to message history
        session["messages"].append({
            "role": "ai",
            "content": question_data["question"],
            "timestamp": time.time(),
            "metadata": {
                "kp_id": current_kp["id"],
                "hints": question_data.get("hints", [])
            }
        })

        return {
            "session_id": session_id,
            "question": question_data["question"],
            "hints": question_data.get("hints", []),
            "current_kp": {
                "index": 0,
                "total": len(knowledge_points),
                "title": current_kp["title"],
                "type": current_kp["type"],
            }
        }
    finally:
        save_session(session)


def process_conversation_turn(
    session_id: str,
    user_answer: str,
    skip: bool = False
) -> Dict[str, Any]:
    """
    Process one conversation turn: user answer -> AI evaluation -> next action.

    Args:
        session_id: Conversation session ID
        user_answer: User's answer to current question
        skip: If True, skip current knowledge point

    Returns:
        Dictionary with action, ai_message, generated_content (if any), and progress info
    """
    session = get_conversation_session(session_id)

    current_index = session["current_index"]
    knowledge_points = session["knowledge_points"]
    current_kp = knowledge_points[current_index]

    # Add user message to history
    session["messages"].append({
        "role": "user",
        "content": user_answer,
        "timestamp": time.time(),
    })

    # Handle skip
    if skip:
        session["current_index"] += 1
        session["follow_up_count"] = 0

        # Check if all knowledge points completed
        if session["current_index"] >= len(knowledge_points):
            session["status"] = "completed"
            save_session(session)
            return {
                "action": "completed",
                "ai_message": "所有知识点已完成！",
                "generated_content": session["generated_content"],
                "progress": {
                    "current": session["current_index"],
                    "total": len(knowledge_points),
                    "completed": True
                }
            }

        # Generate question for next knowledge point
        next_kp = knowledge_points[session["current_index"]]
        question_data = generate_question_for_knowledge_point(next_kp)

        session["messages"].append({
            "role": "ai",
            "content": question_data["question"],
            "timestamp": time.time(),
            "metadata": {
                "kp_id": next_kp["id"],
                "hints": question_data.get("hints", [])
            }
        })

        save_session(session)
        return {
            "action": "next_question",
            "ai_message": question_data["question"],
            "hints": question_data.get("hints", []),
            "progress": {
                "current": session["current_index"],
                "total": len(knowledge_points),
                "kp_title": next_kp["title"],
                "kp_type": next_kp["type"],
            }
        }

    # Evaluate user's answer
    last_question = None
    for msg in reversed(session["messages"]):
        if msg["role"] == "ai" and msg.get("metadata", {}).get("kp_id") == current_kp["id"]:
            last_question = msg["content"]
            break

    evaluation = evaluate_user_answer(
        current_kp,
        last_question or "",
        user_answer,
        session["follow_up_count"]
    )

    action = evaluation["action"]
    ai_message = evaluation["next_message"]

    # Add AI response to history
    session["messages"].append({
        "role": "ai",
        "content": ai_message,
        "timestamp": time.time(),
        "metadata": {
            "action": action,
            "reason": evaluation.get("reason", "")
        }
    })

    # Handle different actions
    if action == "accept":
        # Enrich acceptance message with key example if not already included
        if current_kp.get('key_example') and current_kp['key_example'] not in ai_message:
            ai_message += f"\n\n举个具体例子：{current_kp['key_example']}"

        # Get conversation messages for this knowledge point
        kp_messages = [
            msg for msg in session["messages"]
            if msg.get("metadata", {}).get("kp_id") == current_kp["id"] or
               (msg["role"] == "user" and session["messages"].index(msg) >
                next((i for i, m in enumerate(session["messages"])
                      if m.get("metadata", {}).get("kp_id") == current_kp["id"]), 0))
        ]

        # Check if this is a procedure-type knowledge point
        if current_kp.get("type") == "procedure":
            # Generate example instead of final content
            example_result = generate_example_for_procedure(
                current_kp,
                user_answer,
                kp_messages
            )

            # Store pending example in session
            session["pending_example"] = {
                "example_content": example_result["example_content"],
                "explanation": example_result.get("explanation", ""),
                "user_answer": user_answer,
                "kp_messages": kp_messages
            }

            # Return example for user confirmation
            save_session(session)
            return {
                "action": "example_preview",
                "ai_message": ai_message,
                "example_content": example_result["example_content"],
                "explanation": example_result.get("explanation", ""),
                "progress": {
                    "current": session["current_index"],
                    "total": len(knowledge_points),
                    "kp_title": current_kp["title"],
                    "kp_type": current_kp["type"],
                }
            }

        # For non-procedure types, generate content directly
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

        # Move to next knowledge point
        session["current_index"] += 1
        session["follow_up_count"] = 0
        session["self_correction_count"] = 0
        session["uncertainty_count"] = 0

        # Check if all completed
        if session["current_index"] >= len(knowledge_points):
            session["status"] = "completed"
            save_session(session)
            return {
                "action": "completed",
                "ai_message": ai_message,
                "generated_content": generated_content,
                "total_content": session["generated_content"],
                "progress": {
                    "current": session["current_index"],
                    "total": len(knowledge_points),
                    "completed": True
                }
            }

        # Generate question for next knowledge point
        next_kp = knowledge_points[session["current_index"]]
        question_data = generate_question_for_knowledge_point(next_kp)

        session["messages"].append({
            "role": "ai",
            "content": question_data["question"],
            "timestamp": time.time(),
            "metadata": {
                "kp_id": next_kp["id"],
                "hints": question_data.get("hints", [])
            }
        })

        save_session(session)
        return {
            "action": "accept_and_next",
            "ai_message": ai_message,
            "generated_content": generated_content,
            "next_question": question_data["question"],
            "hints": question_data.get("hints", []),
            "progress": {
                "current": session["current_index"],
                "total": len(knowledge_points),
                "kp_title": next_kp["title"],
                "kp_type": next_kp["type"],
            }
        }

    elif action == "follow_up":
        session["follow_up_count"] += 1
        if session["follow_up_count"] > 3:
            session["current_index"] += 1
            session["follow_up_count"] = 0
            session["self_correction_count"] = 0
            session["uncertainty_count"] = 0
            if session["current_index"] >= len(knowledge_points):
                session["status"] = "completed"
                save_session(session)
                return {
                    "action": "completed",
                    "ai_message": ai_message + "\n\n（已自动总结，学习下一个知识点。）",
                    "generated_content": session["generated_content"],
                    "progress": {
                        "current": session["current_index"],
                        "total": len(knowledge_points),
                        "completed": True
                    }
                }
            next_kp = knowledge_points[session["current_index"]]
            question_data = generate_question_for_knowledge_point(next_kp)
            session["messages"].append({
                "role": "ai",
                "content": question_data["question"],
                "timestamp": time.time(),
                "metadata": {"kp_id": next_kp["id"], "hints": question_data.get("hints", [])}
            })
            save_session(session)
            return {
                "action": "accept_and_next",
                "ai_message": ai_message + "\n\n（已自动总结，学习下一个知识点。）",
                "next_question": question_data["question"],
                "hints": question_data.get("hints", []),
                "progress": {
                    "current": session["current_index"],
                    "total": len(knowledge_points),
                    "kp_title": next_kp["title"],
                    "kp_type": next_kp["type"],
                }
            }
        save_session(session)
        return {
            "action": "follow_up",
            "ai_message": ai_message,
            "progress": {
                "current": session["current_index"],
                "total": len(knowledge_points),
                "kp_title": current_kp["title"],
                "kp_type": current_kp["type"],
            }
        }

    elif action == "hint":
        save_session(session)
        return {
            "action": "hint",
            "ai_message": ai_message,
            "progress": {
                "current": session["current_index"],
                "total": len(knowledge_points),
                "kp_title": current_kp["title"],
                "kp_type": current_kp["type"],
            }
        }

    elif action == "show_source":
        # User can't see source material — provide it, don't count as follow-up
        save_session(session)
        return {
            "action": "show_source",
            "ai_message": ai_message,
            "source_content": current_kp.get("source_content", ""),
            "correct_definition": current_kp.get("correct_definition", ""),
            "key_example": current_kp.get("key_example", ""),
            "progress": {
                "current": session["current_index"],
                "total": len(knowledge_points),
                "kp_title": current_kp["title"],
                "kp_type": current_kp["type"],
            }
        }

    elif action == "progressive_hint":
        session["follow_up_count"] += 1
        if session["follow_up_count"] > 3:
            session["current_index"] += 1
            session["follow_up_count"] = 0
            session["self_correction_count"] = 0
            session["uncertainty_count"] = 0
            if session["current_index"] >= len(knowledge_points):
                session["status"] = "completed"
                save_session(session)
                return {
                    "action": "completed",
                    "ai_message": ai_message + "\n\n（已自动总结，学习下一个知识点。）",
                    "generated_content": session["generated_content"],
                    "progress": {
                        "current": session["current_index"],
                        "total": len(knowledge_points),
                        "completed": True
                    }
                }
            next_kp = knowledge_points[session["current_index"]]
            question_data = generate_question_for_knowledge_point(next_kp)
            session["messages"].append({
                "role": "ai",
                "content": question_data["question"],
                "timestamp": time.time(),
                "metadata": {"kp_id": next_kp["id"], "hints": question_data.get("hints", [])}
            })
            save_session(session)
            return {
                "action": "accept_and_next",
                "ai_message": ai_message + "\n\n（已自动总结，学习下一个知识点。）",
                "next_question": question_data["question"],
                "hints": question_data.get("hints", []),
                "progress": {
                    "current": session["current_index"],
                    "total": len(knowledge_points),
                    "kp_title": next_kp["title"],
                    "kp_type": next_kp["type"],
                }
            }
        save_session(session)
        return {
            "action": "hint",
            "ai_message": ai_message,
            "progress": {
                "current": session["current_index"],
                "total": len(knowledge_points),
                "kp_title": current_kp["title"],
                "kp_type": current_kp["type"],
            }
        }

    elif action == "correct_self":
        # AI caught its own mistake — don't count as follow-up
        session["self_correction_count"] += 1
        # Safety: if AI keeps correcting itself, force move on
        if session["self_correction_count"] > 2:
            session["current_index"] += 1
            session["follow_up_count"] = 0
            session["self_correction_count"] = 0
            session["uncertainty_count"] = 0
            if session["current_index"] >= len(knowledge_points):
                session["status"] = "completed"
                save_session(session)
                return {
                    "action": "completed",
                    "ai_message": ai_message + "\n\n（已自动跳过，让我们继续下一个知识点。）",
                    "generated_content": session["generated_content"],
                    "progress": {
                        "current": session["current_index"],
                        "total": len(knowledge_points),
                        "completed": True
                    }
                }
            next_kp = knowledge_points[session["current_index"]]
            question_data = generate_question_for_knowledge_point(next_kp)
            session["messages"].append({
                "role": "ai",
                "content": question_data["question"],
                "timestamp": time.time(),
                "metadata": {"kp_id": next_kp["id"], "hints": question_data.get("hints", [])}
            })
            save_session(session)
            return {
                "action": "accept_and_next",
                "ai_message": ai_message,
                "next_question": question_data["question"],
                "hints": question_data.get("hints", []),
                "progress": {
                    "current": session["current_index"],
                    "total": len(knowledge_points),
                    "kp_title": next_kp["title"],
                    "kp_type": next_kp["type"],
                }
            }
        save_session(session)
        return {
            "action": "correct_self",
            "ai_message": ai_message,
            "progress": {
                "current": session["current_index"],
                "total": len(knowledge_points),
                "kp_title": current_kp["title"],
                "kp_type": current_kp["type"],
            }
        }

    elif action == "admit_uncertainty":
        # AI doesn't know — don't count as follow-up
        session["uncertainty_count"] += 1
        # After 1 uncertainty, suggest user to skip
        can_skip = session["uncertainty_count"] >= 1
        save_session(session)
        return {
            "action": "admit_uncertainty",
            "ai_message": ai_message,
            "can_skip": can_skip,
            "progress": {
                "current": session["current_index"],
                "total": len(knowledge_points),
                "kp_title": current_kp["title"],
                "kp_type": current_kp["type"],
            }
        }

    elif action == "summarize_and_move_on":
        # AI summarizes correct answer and moves on — same logic as accept
        # but the ai_message already contains the correct explanation
        session["current_index"] += 1
        session["follow_up_count"] = 0
        session["self_correction_count"] = 0
        session["uncertainty_count"] = 0

        if session["current_index"] >= len(knowledge_points):
            session["status"] = "completed"
            save_session(session)
            return {
                "action": "completed",
                "ai_message": ai_message,
                "generated_content": session["generated_content"],
                "progress": {
                    "current": session["current_index"],
                    "total": len(knowledge_points),
                    "completed": True
                }
            }

        next_kp = knowledge_points[session["current_index"]]
        question_data = generate_question_for_knowledge_point(next_kp)
        session["messages"].append({
            "role": "ai",
            "content": question_data["question"],
            "timestamp": time.time(),
            "metadata": {"kp_id": next_kp["id"], "hints": question_data.get("hints", [])}
        })

        save_session(session)
        return {
            "action": "accept_and_next",
            "ai_message": ai_message,
            "next_question": question_data["question"],
            "hints": question_data.get("hints", []),
            "progress": {
                "current": session["current_index"],
                "total": len(knowledge_points),
                "kp_title": next_kp["title"],
                "kp_type": next_kp["type"],
            }
        }

    save_session(session)
    return {
        "action": "unknown",
        "ai_message": ai_message,
        "progress": {
            "current": session["current_index"],
            "total": len(knowledge_points),
        }
    }


def cleanup_old_sessions(max_age_seconds: int = 1800):
    """Clean up sessions older than max_age_seconds (default 30 minutes)."""
    cutoff = time.time() - max_age_seconds
    with get_db_ctx() as conn:
        cursor = conn.execute(
            "DELETE FROM conversation_sessions WHERE last_activity_at < ?",
            (cutoff,),
        )
        return cursor.rowcount


def process_example_feedback(
    session_id: str,
    action: str,
    feedback: str = ""
) -> Dict[str, Any]:
    """
    Process user feedback on generated example for procedure-type knowledge point.

    Args:
        session_id: Conversation session ID
        action: User action - "accept", "regenerate", or "skip"
        feedback: User feedback for regeneration (required if action is "regenerate")

    Returns:
        Dictionary with action result, next question (if any), and progress info
    """
    session = get_conversation_session(session_id)

    # Validate pending example exists
    if not session.get("pending_example"):
        raise ValueError("No pending example to process")

    pending_example = session["pending_example"]
    current_index = session["current_index"]
    knowledge_points = session["knowledge_points"]
    current_kp = knowledge_points[current_index]

    if action == "accept":
        # Combine user answer with example to create final content
        user_answer = pending_example["user_answer"]
        example_content = pending_example["example_content"]

        # Generate final content combining understanding and example
        final_content = f"{user_answer}\n\n{example_content}"

        # Append to accumulated content
        if session["generated_content"]:
            session["generated_content"] += "\n\n---\n\n"
        session["generated_content"] += f"## {current_kp['title']}\n\n{final_content}"

        # Clear pending example
        session["pending_example"] = None

        # Move to next knowledge point
        session["current_index"] += 1
        session["follow_up_count"] = 0

        # Check if all completed
        if session["current_index"] >= len(knowledge_points):
            session["status"] = "completed"
            save_session(session)
            return {
                "action": "completed",
                "ai_message": "所有知识点已完成！",
                "generated_content": final_content,
                "total_content": session["generated_content"],
                "progress": {
                    "current": session["current_index"],
                    "total": len(knowledge_points),
                    "completed": True
                }
            }

        # Generate question for next knowledge point
        next_kp = knowledge_points[session["current_index"]]
        question_data = generate_question_for_knowledge_point(next_kp)

        session["messages"].append({
            "role": "ai",
            "content": question_data["question"],
            "timestamp": time.time(),
            "metadata": {
                "kp_id": next_kp["id"],
                "hints": question_data.get("hints", [])
            }
        })

        save_session(session)
        return {
            "action": "accept_and_next",
            "ai_message": "很好！让我们继续下一个知识点。",
            "generated_content": final_content,
            "next_question": question_data["question"],
            "hints": question_data.get("hints", []),
            "progress": {
                "current": session["current_index"],
                "total": len(knowledge_points),
                "kp_title": next_kp["title"],
                "kp_type": next_kp["type"],
            }
        }

    elif action == "regenerate":
        # Check regeneration limit (max 3 attempts)
        example_history = session.get("example_history", [])
        regeneration_count = len([e for e in example_history if e.get("kp_id") == current_kp["id"]])

        if regeneration_count >= 3:
            save_session(session)
            return {
                "action": "regeneration_limit_reached",
                "ai_message": "已达到重新生成次数上限（3次）。您可以选择接受当前例题或跳过。",
                "example_content": pending_example["example_content"],
                "explanation": pending_example.get("explanation", ""),
                "progress": {
                    "current": session["current_index"],
                    "total": len(knowledge_points),
                    "kp_title": current_kp["title"],
                    "kp_type": current_kp["type"],
                }
            }

        if not feedback:
            raise ValueError("Feedback is required for regeneration")

        # Store current example in history
        if "example_history" not in session:
            session["example_history"] = []
        session["example_history"].append({
            "kp_id": current_kp["id"],
            "example_content": pending_example["example_content"],
            "timestamp": time.time()
        })

        # Generate new example with feedback
        kp_messages = pending_example["kp_messages"]
        user_answer = pending_example["user_answer"]

        new_example_result = generate_example_for_procedure(
            current_kp,
            user_answer,
            kp_messages,
            previous_example=pending_example["example_content"],
            user_feedback=feedback
        )

        # Update pending example
        session["pending_example"] = {
            "example_content": new_example_result["example_content"],
            "explanation": new_example_result.get("explanation", ""),
            "user_answer": user_answer,
            "kp_messages": kp_messages
        }

        save_session(session)
        return {
            "action": "example_regenerated",
            "ai_message": "我根据您的反馈重新生成了例题，请查看。",
            "example_content": new_example_result["example_content"],
            "explanation": new_example_result.get("explanation", ""),
            "regeneration_count": regeneration_count + 1,
            "progress": {
                "current": session["current_index"],
                "total": len(knowledge_points),
                "kp_title": current_kp["title"],
                "kp_type": current_kp["type"],
            }
        }

    elif action == "skip":
        # Generate text-only content without example
        user_answer = pending_example["user_answer"]
        kp_messages = pending_example["kp_messages"]

        # Get last question
        last_question = None
        for msg in reversed(session["messages"]):
            if msg["role"] == "ai" and msg.get("metadata", {}).get("kp_id") == current_kp["id"]:
                last_question = msg["content"]
                break

        # Generate content from answer only
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

        # Clear pending example
        session["pending_example"] = None

        # Move to next knowledge point
        session["current_index"] += 1
        session["follow_up_count"] = 0

        # Check if all completed
        if session["current_index"] >= len(knowledge_points):
            session["status"] = "completed"
            save_session(session)
            return {
                "action": "completed",
                "ai_message": "所有知识点已完成！",
                "generated_content": generated_content,
                "total_content": session["generated_content"],
                "progress": {
                    "current": session["current_index"],
                    "total": len(knowledge_points),
                    "completed": True
                }
            }

        # Generate question for next knowledge point
        next_kp = knowledge_points[session["current_index"]]
        question_data = generate_question_for_knowledge_point(next_kp)

        session["messages"].append({
            "role": "ai",
            "content": question_data["question"],
            "timestamp": time.time(),
            "metadata": {
                "kp_id": next_kp["id"],
                "hints": question_data.get("hints", [])
            }
        })

        save_session(session)
        return {
            "action": "skip_and_next",
            "ai_message": "好的，我们跳过例题，继续下一个知识点。",
            "generated_content": generated_content,
            "next_question": question_data["question"],
            "hints": question_data.get("hints", []),
            "progress": {
                "current": session["current_index"],
                "total": len(knowledge_points),
                "kp_title": next_kp["title"],
                "kp_type": next_kp["type"],
            }
        }

    else:
        raise ValueError(f"Invalid action: {action}. Must be 'accept', 'regenerate', or 'skip'")


"""
Narrow handler prompt templates for the refactored chat architecture.
Each prompt is 20-50 lines and does ONE thing. Code handles decisions,
AI handles text generation within a tightly scoped task.
"""

# ── Line-by-Line Mode Handlers ────────────────────────────────────────

LINE_BY_LINE_EXPLAIN_SYSTEM = """你是一个知识导师，正在陪用户逐段阅读一份文档。

你的每次回复：
1. 用 > 引用当前要讲解的段落原文
2. 解释这段内容。利用【知识点结构】理解这段话涉及的概念及其前置知识，自然地融入解释中
3. 如果【个性化知识关联】中有用户已掌握的相关内容，用具体的联系帮助用户建立理解——不是"类似XX"，而是指出具体在哪个概念上有怎样的关联
4. 数学公式用 $...$ 或 $$...$$ 包裹

返回JSON：{"message": "> 原文\\n\\n解释内容", "reason": "简短标注"}"""


LINE_BY_LINE_ANSWER_SYSTEM = """你是一个知识导师。用户对当前正在阅读的段落提出了疑问或表示不理解。

回复策略（按优先级判断）：
1. 用户是否缺少前置知识？— 看【知识点结构】中列出的前置知识。如果用户明显没掌握这些前置概念，不要展开解释当前内容，而是明确指出他需要先学什么："要理解这个概念，你需要先了解XX和YY。你的知识树里好像还没有这些，要不要先去建一下？"——这不是拒绝，是帮他建立正确的学习路径。
2. 用户有前置知识但不理解你的解释？— 换个角度重新解释，用更具体的例子或更简单的语言。不需要问"要不要展开"，直接展开。
3. 用户只是确认（"嗯""懂了""继续"）？— 这不是由你处理的场景，你不会收到这类消息。

回复格式：
- 用 > 引用当前段落原文
- 数学公式用 $...$ 或 $$...$$ 包裹
- 回复控制在2-5句话

返回JSON：{"message": "完整回复", "reason": "简短标注"}"""


# ── Single-Topic Socratic Mode Handlers ───────────────────────────────

SOCRATIC_GENERATE_QUESTION_SYSTEM = """你是苏格拉底式知识导师。基于参考资料和对话历史，生成下一个引导性问题或教学回复。

# 原则
- 定义优先：用户不理解时先给精确定义，不要用比喻替代定义
- 温暖、自然。你是关心学生的人，不是答题机器
- 问题1-3句话，不用固定模板开头
- 用户已有的知识做桥梁
- 如果用户连续被动确认（嗯、理解、好的），表达关心而不是假装他学会了

# 动作
- "question"：提出引导性问题（用户已理解基础定义后）
- "accept"：用户回答准确完整 → 真诚肯定，补充细节，生成笔记
- "follow_up"：回答部分正确 → 先肯定对的，自然追问遗漏
- "hint"：回答错误 → 先给精确定义，再问确认性问题
- "summarize_and_move_on"：多次未掌握 → 友好给出正确答案
- "end_conversation"：对话充分或用户疲劳 → 温暖总结

返回JSON：
{
  "action": "question|accept|follow_up|hint|summarize_and_move_on|end_conversation",
  "message": "给用户的回复（自然对话风格，2-5句话）",
  "sub_topic": "当前讨论的子话题名称",
  "generated_content": "当action=accept时，生成Markdown笔记（100-200字，学习者口吻，含具体例子）。非accept时为空",
  "knowledge_note": "知识总结（1-3句话，学习者口吻）。如果已充分记录或用户仅确认则留空"
}"""


SOCRATIC_END_SYSTEM = """你是苏格拉底式知识导师。用户想结束对话。

做一个温暖的总结（2-4句话）：
- 回顾你们聊了什么
- 肯定用户的投入（即使他大部分时间只是听）
- 建议接下来可以探索的方向
- 如果用户全程只是被动确认，诚实地说"今天我们主要是我在讲，你可以之后自己梳理一下"，不要假装他学会了

返回JSON：{"message": "温暖的总结合", "action": "end_conversation", "reason": "简短说明"}"""


# ── Knowledge Gap Handler ─────────────────────────────────────────────

KNOWLEDGE_GAP_SUGGEST_SYSTEM = """用户的知识树在这个领域几乎为空。

用温暖、关心的语气建议用户先去创建前置知识点（给1-2个具体建议）。
如果用户表示想继续，就从最基础的定义开始教。
这不是拒绝用户，而是帮他建立正确的学习路径。

返回JSON：{"message": "...", "action": "hint", "sub_topic": ""}"""


# ── Prompt Builder Functions ──────────────────────────────────────────

def build_line_by_line_explain_prompt(
    current_segment: str,
    progress: str,
    knowledge_profile: str = "",
    gap_warning: str = "",
    tone_instruction: str = "",
    recent_history: str = "",
    context_window: str = "",
    position_marker: str = "",
    concept_context: str = "",
    personalized_context: str = "",
    expansion_context: str = "",
) -> list[dict]:
    """Assemble prompt for explaining the next document segment."""
    user_lines = []
    # Context window — AI sees nearby segments, not the entire file
    if context_window:
        user_lines.append(f"【文档上下文】（当前位置附近的段落，供参考）\n{context_window}")
    if position_marker:
        user_lines.append(f"【{position_marker}】")
    if gap_warning:
        user_lines.append(gap_warning)
    if tone_instruction:
        user_lines.append(tone_instruction)
    if knowledge_profile:
        user_lines.append(knowledge_profile)
    if concept_context:
        user_lines.append(concept_context)
    if personalized_context:
        user_lines.append(personalized_context)
    if expansion_context:
        user_lines.append(expansion_context)
    user_lines.append(f"【{progress}】请解释下面这句话：\n\n{current_segment}")
    if recent_history:
        user_lines.append(f"\n最近对话：\n{recent_history}")
    return [
        {"role": "system", "content": LINE_BY_LINE_EXPLAIN_SYSTEM},
        {"role": "user", "content": "\n".join(user_lines)},
    ]


def build_line_by_line_answer_prompt(
    current_segment: str,
    progress: str,
    user_question: str,
    knowledge_profile: str = "",
    gap_warning: str = "",
    tone_instruction: str = "",
    recent_history: str = "",
    context_window: str = "",
    position_marker: str = "",
    concept_context: str = "",
    personalized_context: str = "",
    expansion_context: str = "",
    definition_chain: str = "",
) -> list[dict]:
    """Assemble prompt for answering a user question in line-by-line mode."""
    user_lines = []
    # Context window — nearby segments for orientation
    if context_window:
        user_lines.append(f"【文档上下文】（当前位置附近的段落）\n{context_window}")
    if position_marker:
        user_lines.append(f"【{position_marker}】")
    if gap_warning:
        user_lines.append(gap_warning)
    if tone_instruction:
        user_lines.append(tone_instruction)
    if definition_chain:
        user_lines.append(definition_chain)
    if knowledge_profile:
        user_lines.append(knowledge_profile)
    if concept_context:
        user_lines.append(concept_context)
    if personalized_context:
        user_lines.append(personalized_context)
    if expansion_context:
        user_lines.append(expansion_context)
    user_lines.append(f"【{progress}】当前句子：\n\n{current_segment}")
    user_lines.append(f"\n用户问：{user_question}")
    user_lines.append(
        "\n判断用户是缺少前置知识还是需要换角度解释。"
        "缺少前置知识 → 建议去学习具体的原子知识点。"
        "需要换角度解释 → 直接展开，不要问'要不要展开'。"
    )
    if recent_history:
        user_lines.append(f"\n最近对话：\n{recent_history}")
    return [
        {"role": "system", "content": LINE_BY_LINE_ANSWER_SYSTEM},
        {"role": "user", "content": "\n".join(user_lines)},
    ]


def build_socratic_question_prompt(
    reference_material: str,
    node_name: str,
    knowledge_profile: str = "",
    existing_content: str = "",
    conversation_history: str = "",
    gap_warning: str = "",
    tone_instruction: str = "",
) -> list[dict]:
    """Assemble prompt for generating the next Socratic question."""
    user_lines = [f"当前主题：{node_name}"]
    if reference_material.strip():
        user_lines.append(f"\n【参考资料】\n{reference_material[:3000]}")
    if knowledge_profile:
        user_lines.append(f"\n{knowledge_profile}")
    if gap_warning:
        user_lines.append(f"\n{gap_warning}")
    if tone_instruction:
        user_lines.append(f"\n{tone_instruction}")
    if existing_content.strip():
        user_lines.append(f"\n【已有笔记（尾部）】\n{existing_content[-1000:]}")
    if conversation_history:
        user_lines.append(f"\n对话历史：\n{conversation_history}")

    user_lines.append("\n请生成下一个引导性问题或教学动作。严格按照JSON格式回复。")
    return [
        {"role": "system", "content": SOCRATIC_GENERATE_QUESTION_SYSTEM},
        {"role": "user", "content": "\n".join(user_lines)},
    ]


def build_socratic_evaluate_prompt(
    user_answer: str,
    reference_material: str,
    node_name: str,
    knowledge_profile: str = "",
    conversation_history: str = "",
    existing_content: str = "",
    follow_up_count: int = 0,
    gap_warning: str = "",
    tone_instruction: str = "",
) -> list[dict]:
    """Assemble prompt for evaluating a user answer in Socratic mode."""
    user_lines = [f"当前主题：{node_name}"]
    if reference_material.strip():
        user_lines.append(f"\n【参考资料】\n{reference_material[:3000]}")
    if knowledge_profile:
        user_lines.append(f"\n{knowledge_profile}")
    if gap_warning:
        user_lines.append(f"\n{gap_warning}")
    if tone_instruction:
        user_lines.append(f"\n{tone_instruction}")
    if existing_content.strip():
        user_lines.append(f"\n【已有笔记（尾部）】\n{existing_content[-1000:]}")

    user_lines.append(f"\n已追问次数：{follow_up_count}")
    user_lines.append(f"\n用户回答：{user_answer}")
    if conversation_history:
        user_lines.append(f"\n对话历史：\n{conversation_history}")

    user_lines.append("\n请评估用户回答，选择动作并回复。严格按照JSON格式回复。")
    return [
        {"role": "system", "content": SOCRATIC_GENERATE_QUESTION_SYSTEM},
        {"role": "user", "content": "\n".join(user_lines)},
    ]


def build_socratic_end_prompt(
    node_name: str,
    conversation_history: str,
    knowledge_profile: str = "",
) -> list[dict]:
    """Assemble prompt for ending a Socratic conversation."""
    user_lines = [f"当前主题：{node_name}"]
    if knowledge_profile:
        user_lines.append(f"\n{knowledge_profile}")
    user_lines.append(f"\n对话历史：\n{conversation_history}")
    user_lines.append("\n请做一个温暖的对话总结。")
    return [
        {"role": "system", "content": SOCRATIC_END_SYSTEM},
        {"role": "user", "content": "\n".join(user_lines)},
    ]


def build_knowledge_gap_prompt(
    node_name: str,
    gap_result: dict,
    knowledge_profile: str = "",
) -> list[dict]:
    """Assemble prompt for suggesting the user go create prerequisite KPs."""
    domain = gap_result.get("domain_tag", "相关")
    related_count = gap_result.get("related_domain_nodes", 0)
    user_lines = [
        f"当前主题：{node_name}",
        f"用户在此领域（{domain}）只有 {related_count} 个知识点，基础薄弱。",
        "\n建议用户先出去创建前置知识点（给1-2个具体建议）。",
    ]
    if knowledge_profile:
        user_lines.append(f"\n{knowledge_profile}")
    return [
        {"role": "system", "content": KNOWLEDGE_GAP_SUGGEST_SYSTEM},
        {"role": "user", "content": "\n".join(user_lines)},
    ]

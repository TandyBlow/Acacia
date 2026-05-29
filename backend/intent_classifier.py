"""
Intent classifier for chat user input.
Primary: rule-based keyword matching (Chinese, <1ms).
Fallback: tiny LLM call for ambiguous inputs.

Returns one of:
  content_question, meta_question, correction, confirmation,
  skip_request, end_request, chitchat, knowledge_question
"""
import re
from typing import Tuple

# ── Pattern tables (priority order) ────────────────────────────────────

# Each entry: (regex_pattern, intent_label)
# Patterns checked in order; first match wins.

_SKIP_PATTERNS = [
    (r'(跳过|别讲了|换一个|不说这个|不用展开|不用讲了?|略过|下一个|不讲了?|说下一句|往下讲|往下)', "skip_request"),
]

_END_PATTERNS = [
    (r'(结束|先这样吧?|可以了|差不多了|就到这|不聊了|再见|拜拜|就这样吧|就这样|没.*问题了?|没有.*问题了?)', "end_request"),
]

_CONFIRMATION_PATTERNS = [
    # Short confirmations (only if input is mostly just this)
    (r'^[嗯嗯]+$', "confirmation"),
    # Note: "好的" intentionally excluded — can mean "yes please expand" not just "move on"
    (r'^(继续|懂了|ok|行|可以|对|没错|是的|然后呢|了解|明白|知道了?|理解|懂了?|往下|讲吧|你说|来吧|嗯嗯?|哦哦?|哦|额|呃|哈|快讲|讲啊|讲呀|说吧|说呀)[\s!！。。]*$', "confirmation"),
]

_META_PATTERNS = [
    # User asks about the AI itself, its rules, or its behavior
    (r'(提示词|系统提示|教学规则|你的规则|为什么这样讲|为什么这么讲|为什么不按|怎么不讲|不是让|怎么不按|你的模式|你是谁|你能做什么|你怎么回|你怎么讲|为什么你|你的.*提示|你的.*规则|你的.*设定|system.?prompt|prompt)', "meta_question"),
    (r'(为什么.*不讲|为什么.*不说|为什么.*不按|为什么不.*逐句|为什么.*不是.*读|为什么.*跳过|让你逐句|叫.*逐句|应该.*逐句|怎么不.*讲解|怎么不.*逐句|为什么.*不.*读)', "meta_question"),
]

_CORRECTION_PATTERNS = [
    # User corrects the AI
    (r'(不对|错了|不是这样|你说错了|纠正|错了吧|不正确|没听懂|不明白|听不懂|你不明白|你搞错了|你错了|你不对|这不对|这错了|有问题|不是这个意思|你没理解|你理解错了|你弄错了)', "correction"),
    (r'(不是.*这样|不是.*这个|我没.*说|我.*不是.*意思|重新.*讲|重新.*说|重讲|重说)', "correction"),
]

_KNOWLEDGE_PATTERNS = [
    # User asks about learning path, knowledge tree, prerequisites
    (r'(怎么学|学什么|先学|前置|基础.*知识|知识树|建.*知识点|创建.*知识|添加.*知识|建一个|创建一个|需要.*基础|有什么.*前置|应该.*先学|从哪里.*开始|从哪.*开始)', "knowledge_question"),
]

_CONTENT_QUESTION_PATTERNS = [
    # Ends with question mark
    (r'.*[？?]$', "content_question"),
    # Contains question words
    (r'.*[？?]', "content_question"),
    (r'(什么|怎么|为什么|如何|哪个|哪一|意思|定义|是啥|是吗|对吗|对不对|可以吗|行吗|懂吗|知道吗|能.*吗|会.*吗|有.*吗|能不能|会不会|为啥|干嘛|咋|咋办|咋整|咋做|为何)', "content_question"),
]

_CONFUSION_PATTERNS = [
    # User expresses not understanding — treat as content_question so AI pauses and explains
    (r'(我不会|我不懂|不理解|没听懂|不明白|没明白|听不懂|好复杂|太难了?|完全不懂|没学过|没学过|不知道|没接触过|好难|复杂|不太懂|没看懂|没理解|不懂你|没听明白)', "content_question"),
]

_CHITCHAT_PATTERNS = [
    (r'(你好|嗨|哈喽|hello|hi|天气|今天.*怎么样|吃了吗|在吗|在不在|哈哈|嘿嘿)', "chitchat"),
]


def _match_patterns(text: str, patterns: list) -> Tuple[str, float]:
    """Try to match text against a list of (regex, label) patterns.
    Returns (label, confidence) or ("", 0.0) if no match."""
    for pattern, label in patterns:
        if re.search(pattern, text, re.IGNORECASE):
            # Confidence based on match length relative to input
            match_len = len(re.search(pattern, text, re.IGNORECASE).group())
            confidence = min(1.0, match_len / max(len(text), 1) * 2.0)
            return (label, max(0.5, confidence))
    return ("", 0.0)


def classify_intent_rule(user_input: str) -> Tuple[str, float]:
    """Rule-based intent classification. Returns (intent, confidence)."""
    text = user_input.strip()
    if not text:
        return ("confirmation", 0.9)  # empty input = continue

    # Check in priority order
    for patterns in [
        _SKIP_PATTERNS,
        _END_PATTERNS,
        _CONFIRMATION_PATTERNS,
        _META_PATTERNS,
        _CORRECTION_PATTERNS,
        _CONFUSION_PATTERNS,
        _KNOWLEDGE_PATTERNS,
        _CONTENT_QUESTION_PATTERNS,
        _CHITCHAT_PATTERNS,
    ]:
        label, confidence = _match_patterns(text, patterns)
        if label:
            return (label, confidence)

    # No match → ambiguous
    return ("ambiguous", 0.0)


# ── LLM fallback ──────────────────────────────────────────────────────

INTENT_CLASSIFY_SYSTEM = """Classify this user message from a tutoring chat into exactly one category:

- content_question: user asks about the document/topic content being discussed
- meta_question: user asks about the AI, its system prompt, rules, or how it works
- correction: user corrects the AI's behavior or statement
- confirmation: passive acknowledgment (like "ok", "got it", "continue", "mm")
- skip_request: user wants to skip current topic/sentence
- end_request: user wants to end the conversation
- chitchat: off-topic casual talk
- knowledge_question: user asks about learning path, prerequisites, or creating knowledge points

Return JSON: {"intent": "<one category>", "reason": "<one short sentence>"}"""


def classify_intent_llm(user_input: str) -> str:
    """LLM-based intent classification for ambiguous inputs."""
    import httpx
    import os
    import json as _json

    from chat_service import parse_json_response

    api_key = os.getenv("LLM_API_KEY")
    if not api_key:
        return "content_question"  # safe default

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    payload = {
        "model": "deepseek-chat",
        "messages": [
            {"role": "system", "content": INTENT_CLASSIFY_SYSTEM},
            {"role": "user", "content": user_input},
        ],
        "temperature": 0.3,
        "response_format": {"type": "json_object"},
    }
    try:
        with httpx.Client(timeout=15.0) as client:
            resp = client.post(
                "https://api.deepseek.com/v1/chat/completions",
                headers=headers,
                json=payload,
            )
            resp.raise_for_status()
        data = resp.json()
        raw = data["choices"][0]["message"]["content"]
        result = parse_json_response(raw)
        intent = result.get("intent", "content_question")
        # Validate against known categories
        valid = {
            "content_question", "meta_question", "correction",
            "confirmation", "skip_request", "end_request",
            "chitchat", "knowledge_question",
        }
        return intent if intent in valid else "content_question"
    except Exception:
        return "content_question"


# ── Public API ────────────────────────────────────────────────────────

# Threshold below which we fall back to LLM
_CONFIDENCE_THRESHOLD = 0.6


def classify_intent(user_input: str, chat_mode: str = "single") -> str:
    """Classify user input intent. Rule-based primary, LLM fallback."""
    intent, confidence = classify_intent_rule(user_input)

    if intent != "ambiguous" and confidence >= _CONFIDENCE_THRESHOLD:
        return intent

    # Fall back to LLM for ambiguous or low-confidence cases
    llm_intent = classify_intent_llm(user_input)

    # If LLM says correction but rule said something else with decent confidence,
    # trust the rule-based result (LLM over-diagnoses "correction")
    if llm_intent == "correction" and intent != "ambiguous" and confidence >= 0.4:
        return intent

    return llm_intent

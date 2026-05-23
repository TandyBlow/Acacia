"""
Tone detection for chat sessions.
Analyzes recent message patterns to detect user state:
passive confirmation streaks, shrinking responses, fatigue.
Produces a Chinese instruction string for handler prompts.
"""
import re

# Patterns that indicate passive confirmation
_CONFIRMATION_RE = re.compile(
    r'^(嗯+|好的?|继续|懂了|ok|行|可以|对|没错|是的|然后呢|了解|明白|知道了?|理解|懂了?|往下|讲吧|你说|来吧|嗯嗯?|哦哦?|哦|额|呃|哈|快讲|讲啊|讲[email protected]|说啊|说呀)\s*[!！。。,，.]*$',
    re.IGNORECASE
)

# Signs of fatigue / wanting to end
_FATIGUE_RE = re.compile(r'(累了|困了|头疼|不想|不聊|就这样|休息|改天|下次|慢慢|太晚|好累|好困|想睡)')


def detect_tone(session: dict) -> dict:
    """Analyze recent user messages for tone patterns.

    Returns:
        {"passive_streak": int, "response_shrinking": bool,
         "fatigue_likely": bool, "instruction": str}
    """
    messages = session.get("messages", [])
    user_msgs = [m["content"].strip() for m in messages if m["role"] == "user"]

    result = {
        "passive_streak": 0,
        "response_shrinking": False,
        "fatigue_likely": False,
        "instruction": "",
    }

    if not user_msgs:
        return result

    # Count consecutive confirmation-only responses from the end
    for msg in reversed(user_msgs):
        if _CONFIRMATION_RE.match(msg):
            result["passive_streak"] += 1
        else:
            break

    # Check if responses are getting shorter
    if len(user_msgs) >= 3:
        last3 = user_msgs[-3:]
        lengths = [len(m) for m in last3]
        if lengths[0] > lengths[1] > lengths[2] and lengths[0] > 10:
            result["response_shrinking"] = True

    # Check for fatigue signals
    for msg in user_msgs[-3:]:
        if _FATIGUE_RE.search(msg):
            result["fatigue_likely"] = True
            break

    # Turn count as a rough fatigue proxy
    turn_count = len(user_msgs)
    if turn_count > 10 and result["passive_streak"] >= 3:
        result["fatigue_likely"] = True

    # Build instruction — must be compatible with line-by-line mode
    # (AI cannot ask questions or change modes, only adjust explanation style)
    instructions = []
    if result["fatigue_likely"]:
        instructions.append(
            "用户表现出疲劳。你的回复仍然以 > 引用开头继续讲解，"
            "但解释可以更简短（1句话即可）。"
            "在解释后加一句'今天先到这里也可以，随时回来继续'。"
        )
    elif result["passive_streak"] >= 4:
        instructions.append(
            f"用户已连续{result['passive_streak']}轮被动确认。"
            "你仍然逐句讲解，但可以跳过显而易见的句子，加快节奏。不要提问。"
        )
    elif result["passive_streak"] >= 2:
        instructions.append(
            "用户比较被动。保持逐句讲解，但解释更简洁（控制在1-2句话）。"
        )
    elif result["response_shrinking"]:
        instructions.append(
            "用户回复越来越短。保持讲解节奏，但每句解释控制在1-2句话。"
        )

    result["instruction"] = " ".join(instructions)
    return result

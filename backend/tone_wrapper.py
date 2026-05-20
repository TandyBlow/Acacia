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

    # Build instruction
    instructions = []
    if result["fatigue_likely"]:
        instructions.append("用户表现出疲劳或想结束。在回复中表达理解，建议休息或快速收尾。")
    elif result["passive_streak"] >= 4:
        instructions.append("用户连续多轮只是被动确认，可能没有真正在思考。在回复中真诚地问他是否消化了，不要假装他学会了。")
    elif result["passive_streak"] >= 2:
        instructions.append("用户最近几轮比较被动。对话可以更简洁，适当关心他的状态。")
    elif result["response_shrinking"]:
        instructions.append("用户回答越来越短，可能累了或失去兴趣。注意观察，适时收尾。")

    result["instruction"] = " ".join(instructions)
    return result

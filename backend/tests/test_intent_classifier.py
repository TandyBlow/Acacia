"""
Unit tests for backend/intent_classifier.py.

Covers every intent branch of classify_intent_rule / classify_intent
(content_question, meta_question, correction, confirmation, skip_request,
end_request, chitchat, knowledge_question), rule priority, edge cases
(empty / whitespace input), confidence computation, and the LLM fallback
path (patched with a fake httpx client — no network).
"""
import httpx
import pytest

import intent_classifier as ic


# ── Rule branches: one parametrized test per intent ────────────────────

@pytest.mark.parametrize("text", [
    "跳过", "别讲了", "换一个", "不用讲了", "不用展开",
    "略过", "下一个", "不讲了", "说下一句", "往下讲", "往下",
])
def test_skip_request_branch(text):
    intent, conf = ic.classify_intent_rule(text)
    assert intent == "skip_request"
    assert conf >= 0.6


@pytest.mark.parametrize("text", [
    "结束", "先这样吧", "先这样", "可以了", "差不多了", "就到这",
    "不聊了", "再见", "拜拜", "就这样吧", "就这样", "没问题了",
])
def test_end_request_branch(text):
    intent, conf = ic.classify_intent_rule(text)
    assert intent == "end_request"
    assert conf >= 0.6


@pytest.mark.parametrize("text", [
    "嗯", "嗯嗯", "嗯嗯嗯", "继续", "懂了", "ok", "行", "可以", "对",
    "没错", "是的", "然后呢", "了解", "明白", "知道了", "理解",
    "讲吧", "你说", "来吧", "哦", "额", "呃", "哈", "快讲",
    "讲啊", "讲呀", "说吧", "说呀",
])
def test_confirmation_branch(text):
    intent, conf = ic.classify_intent_rule(text)
    assert intent == "confirmation"
    assert conf >= 0.6


@pytest.mark.parametrize("text", [
    "你是谁", "你能做什么", "提示词", "系统提示", "教学规则", "你的规则",
    "你的设定是什么", "system prompt", "SYSTEM PROMPT", "prompt",
    "为什么这样讲", "为什么这么讲", "为什么不按规则", "为什么不逐句",
    "应该逐句讲解吧",
])
def test_meta_question_branch(text):
    intent, conf = ic.classify_intent_rule(text)
    assert intent == "meta_question"
    assert conf >= 0.6


@pytest.mark.parametrize("text", [
    "不对", "错了", "不是这样", "你说错了", "纠正一下", "不正确",
    "你搞错了", "你错了", "这不对", "这错了", "不是这个意思",
    "你没理解", "你理解错了", "你弄错了", "不是我要的这个", "重讲一遍",
    "重新说一遍",
])
def test_correction_branch(text):
    intent, conf = ic.classify_intent_rule(text)
    assert intent == "correction"
    assert conf >= 0.6


@pytest.mark.parametrize("text", [
    "怎么学", "学什么", "先学什么", "前置知识", "基础的知识有哪些",
    "知识树是什么", "创建一个知识点", "添加知识", "建一个知识点",
    "需要什么基础", "有什么前置要求", "应该先学什么", "从哪里开始学",
    "从哪开始",
])
def test_knowledge_question_branch(text):
    intent, conf = ic.classify_intent_rule(text)
    assert intent == "knowledge_question"
    assert conf >= 0.6


@pytest.mark.parametrize("text", [
    "这是什么", "怎么理解", "为什么天是蓝的？", "哪个选项对",
    "什么是定义", "是啥", "是吗", "对吗", "可以吗", "行吗",
    "懂吗", "知道吗", "能不能讲细点", "会不会", "为啥", "干嘛", "咋办",
    "咋整", "咋做", "为何", "我不会", "我不懂", "好复杂", "太难了",
    "完全不懂", "不知道",
])
def test_content_question_branch(text):
    intent, conf = ic.classify_intent_rule(text)
    assert intent == "content_question"
    assert conf >= 0.6


@pytest.mark.parametrize("text", [
    "你好", "嗨", "哈喽", "hello", "HI", "天气", "吃了吗",
    "在吗", "在不在", "哈哈", "嘿嘿",
])
def test_chitchat_branch(text):
    intent, conf = ic.classify_intent_rule(text)
    assert intent == "chitchat"
    assert conf >= 0.6


# ── Priority: first matching pattern group wins ────────────────────────

@pytest.mark.parametrize("text,expected", [
    ("为什么跳过", "skip_request"),      # skip beats meta
    ("怎么学才能跳过", "skip_request"),  # skip beats knowledge
    ("换一个话题", "skip_request"),
    ("不聊了再见", "end_request"),       # end beats chitchat
    ("继续", "confirmation"),            # confirmation beats meta/content
    ("你是谁", "meta_question"),         # meta beats chitchat
    ("没听懂", "correction"),            # correction beats confusion/content
    ("这到底是什么", "content_question"),  # content beats ... (no earlier hit)
    ("今天天气怎么样", "content_question"),  # content beats chitchat
    ("天气如何", "content_question"),     # content beats chitchat
    ("对不对", "correction"),             # correction beats content
    ("你好，你是谁", "meta_question"),   # meta beats chitchat
])
def test_rule_priority(text, expected):
    intent, _ = ic.classify_intent_rule(text)
    assert intent == expected


# ── Ambiguous inputs ───────────────────────────────────────────────────

@pytest.mark.parametrize("text", ["随便", "好的", "随便聊聊吧"])
def test_ambiguous_inputs(text):
    intent, conf = ic.classify_intent_rule(text)
    assert intent == "ambiguous"
    assert conf == 0.0


# ── Empty / whitespace input ──────────────────────────────────────────

@pytest.mark.parametrize("text", ["", "   ", "\t\n", "  \t  "])
def test_empty_or_whitespace_is_confirmation(text):
    intent, conf = ic.classify_intent_rule(text)
    assert intent == "confirmation"
    assert conf == 0.9


def test_whitespace_is_stripped_before_matching():
    intent, _ = ic.classify_intent_rule("  跳过  ")
    assert intent == "skip_request"


# ── Confidence computation (_match_patterns) ───────────────────────────

def test_match_patterns_no_match_returns_empty():
    label, conf = ic._match_patterns("随便", ic._SKIP_PATTERNS)
    assert label == ""
    assert conf == 0.0


def test_match_patterns_confidence_reflects_match_ratio():
    # Full-length match caps at 1.0
    label, conf = ic._match_patterns("跳过", ic._SKIP_PATTERNS)
    assert label == "skip_request"
    assert conf == 1.0
    # Partial match: "跳过" is 2 of 5 chars -> 2/5*2 = 0.8
    label, conf = ic._match_patterns("为什么跳过", ic._SKIP_PATTERNS)
    assert label == "skip_request"
    assert conf == pytest.approx(0.8)
    # Barely-matching long input floors at 0.5
    label, conf = ic._match_patterns("这到底是什么呢", ic._CONTENT_QUESTION_PATTERNS)
    assert label == "content_question"
    assert conf == pytest.approx(0.571, abs=0.001)


def test_match_patterns_is_case_insensitive():
    label, _ = ic._match_patterns("HELLO", ic._CHITCHAT_PATTERNS)
    assert label == "chitchat"
    label, _ = ic._match_patterns("SYSTEM PROMPT", ic._META_PATTERNS)
    assert label == "meta_question"


# ── classify_intent: rule-first orchestration ──────────────────────────

def test_high_confidence_rule_skips_llm(monkeypatch):
    def boom(*args, **kwargs):
        raise AssertionError("LLM must not be called for high-confidence matches")
    monkeypatch.setattr(ic, "classify_intent_llm", boom)
    assert ic.classify_intent("跳过") == "skip_request"
    assert ic.classify_intent("再见") == "end_request"
    assert ic.classify_intent("嗯") == "confirmation"
    assert ic.classify_intent("你是谁") == "meta_question"
    assert ic.classify_intent("怎么学") == "knowledge_question"
    assert ic.classify_intent("这是什么") == "content_question"
    assert ic.classify_intent("你好") == "chitchat"


def test_empty_input_returns_confirmation_without_llm(monkeypatch):
    def boom(*args, **kwargs):
        raise AssertionError("LLM must not be called for empty input")
    monkeypatch.setattr(ic, "classify_intent_llm", boom)
    assert ic.classify_intent("") == "confirmation"
    assert ic.classify_intent("   ") == "confirmation"


def test_ambiguous_input_falls_back_to_llm(monkeypatch):
    monkeypatch.setattr(ic, "classify_intent_llm", lambda s: "chitchat")
    assert ic.classify_intent("随便") == "chitchat"
    monkeypatch.setattr(ic, "classify_intent_llm", lambda s: "end_request")
    assert ic.classify_intent("随便") == "end_request"


def test_low_confidence_rule_falls_back_to_llm(monkeypatch):
    # "这到底是什么呢" -> (content_question, ~0.57) below threshold 0.6
    monkeypatch.setattr(ic, "classify_intent_llm", lambda s: "end_request")
    assert ic.classify_intent("这到底是什么呢") == "end_request"


def test_llm_correction_is_overridden_by_rule(monkeypatch):
    # Rule says content_question (0.57); LLM over-diagnoses correction.
    # classify_intent must trust the rule-based result.
    monkeypatch.setattr(ic, "classify_intent_llm", lambda s: "correction")
    assert ic.classify_intent("这到底是什么呢") == "content_question"


def test_chat_mode_parameter_is_accepted(monkeypatch):
    monkeypatch.setattr(ic, "classify_intent_llm", lambda s: "content_question")
    assert ic.classify_intent("跳过", chat_mode="multi") == "skip_request"
    assert ic.classify_intent("随便", chat_mode="multi") == "content_question"


# ── classify_intent_llm: safe default + fake network ───────────────────

class _FakeResp:
    def __init__(self, content):
        self._content = content

    def raise_for_status(self):
        return None

    def json(self):
        return {"choices": [{"message": {"content": self._content}}]}


class _FakeClient:
    def __init__(self, resp):
        self._resp = resp

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False

    def post(self, url, **kwargs):
        return self._resp


def _patch_llm_response(monkeypatch, content=None, exception=None):
    monkeypatch.setenv("LLM_API_KEY", "test-key")
    if exception is not None:
        class _ErrClient:
            def __init__(self, *a, **k):
                pass

            def __enter__(self):
                return self

            def __exit__(self, *a):
                return False

            def post(self, url, **k):
                raise exception

        monkeypatch.setattr(httpx, "Client", _ErrClient)
    else:
        resp = _FakeResp(content)
        monkeypatch.setattr(httpx, "Client", lambda *a, **k: _FakeClient(resp))


def test_classify_intent_llm_no_api_key_returns_safe_default(monkeypatch):
    # classify_intent_llm imports chat_service lazily; chat_service -> chat_llm
    # raises RuntimeError at import time when LLM_API_KEY is unset. Pre-import
    # it with the key set (caching the module) so the "no key -> safe default"
    # branch is reached rather than the import-time guard.
    monkeypatch.setenv("LLM_API_KEY", "test-key")
    import chat_service  # noqa: F401  caches the module with the key set
    monkeypatch.delenv("LLM_API_KEY")
    assert ic.classify_intent_llm("随便") == "content_question"


def test_classify_intent_llm_returns_valid_intent(monkeypatch):
    _patch_llm_response(monkeypatch, content='{"intent": "skip_request", "reason": "test"}')
    assert ic.classify_intent_llm("随便") == "skip_request"


def test_classify_intent_llm_rejects_unknown_intent(monkeypatch):
    _patch_llm_response(monkeypatch, content='{"intent": "banana", "reason": "test"}')
    assert ic.classify_intent_llm("随便") == "content_question"


def test_classify_intent_llm_falls_back_on_error(monkeypatch):
    _patch_llm_response(monkeypatch, exception=RuntimeError("boom"))
    assert ic.classify_intent_llm("随便") == "content_question"

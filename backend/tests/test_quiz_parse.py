"""Unit tests for backend/quiz_parse.py.

Covers the PARSERS registry (single_choice / true_false / short_answer) plus the
exported parse_batch function: valid inputs, missing-key JSON, non-JSON garbage,
wrong option counts, and out-of-range correct_index. No LLM/network is involved —
extract_json is a pure function, exercised here end to end.
"""

import json
import os

import pytest

# quiz_llm raises RuntimeError at import time unless LLM_API_KEY is set.
os.environ.setdefault("LLM_API_KEY", "test-key-for-quiz-parse")

from quiz_parse import (  # noqa: E402
    PARSERS,
    parse_single_choice,
    parse_true_false,
    parse_short_answer,
    parse_batch,
)


# ── PARSERS registry ──────────────────────────────────────────────

def test_parsers_registry_maps_all_question_types():
    assert set(PARSERS) == {"single_choice", "true_false", "short_answer"}
    assert PARSERS["single_choice"] is parse_single_choice
    assert PARSERS["true_false"] is parse_true_false
    assert PARSERS["short_answer"] is parse_short_answer


# ── parse_single_choice ───────────────────────────────────────────

def _sc_payload(**overrides):
    payload = {
        "question": "What is 2+2?",
        "options": ["1", "2", "3", "4"],
        "correct_index": 1,
        "explanation": "Basic arithmetic.",
    }
    payload.update(overrides)
    return payload


def test_single_choice_valid():
    result = parse_single_choice(json.dumps(_sc_payload(correct_index=3)))
    assert result["question_type"] == "single_choice"
    assert result["question"] == "What is 2+2?"
    assert result["options"] == ["1", "2", "3", "4"]
    assert result["correct_index"] == 3
    assert result["explanation"] == "Basic arithmetic."


@pytest.mark.parametrize("missing", ["question", "options", "correct_index", "explanation"])
def test_single_choice_missing_required_key(missing):
    payload = _sc_payload()
    del payload[missing]
    with pytest.raises(ValueError, match="missing required keys"):
        parse_single_choice(json.dumps(payload))


def test_single_choice_options_wrong_count():
    payload = _sc_payload(options=["1", "2", "3"])
    with pytest.raises(ValueError, match="Options must be a list of 4 items"):
        parse_single_choice(json.dumps(payload))


def test_single_choice_options_not_list():
    payload = _sc_payload(options="abcd")
    with pytest.raises(ValueError, match="Options must be a list of 4 items"):
        parse_single_choice(json.dumps(payload))


@pytest.mark.parametrize("idx", [-1, 4, 5])
def test_single_choice_correct_index_out_of_range(idx):
    payload = _sc_payload(correct_index=idx)
    with pytest.raises(ValueError, match="correct_index must be 0-3"):
        parse_single_choice(json.dumps(payload))


def test_single_choice_correct_index_not_int():
    payload = _sc_payload(correct_index="1")
    with pytest.raises(ValueError, match="correct_index must be 0-3"):
        parse_single_choice(json.dumps(payload))


def test_single_choice_accepts_markdown_fence():
    inner = json.dumps(_sc_payload())
    result = parse_single_choice(f"```json\n{inner}\n```")
    assert result["question_type"] == "single_choice"
    assert result["correct_index"] == 1


def test_single_choice_accepts_trailing_comma():
    raw = '{"question":"q","options":["a","b","c","d"],"correct_index":0,"explanation":"e",}'
    result = parse_single_choice(raw)
    assert result["correct_index"] == 0


# ── parse_true_false ──────────────────────────────────────────────

@pytest.mark.parametrize("idx", [0, 1])
def test_true_false_valid(idx):
    result = parse_true_false(json.dumps({
        "question": "Beijing is the capital of China.",
        "correct_index": idx,
        "explanation": "Geography.",
    }))
    assert result["question_type"] == "true_false"
    assert result["options"] == json.dumps(["正确", "错误"])
    assert result["correct_index"] == idx
    assert result["explanation"] == "Geography."


@pytest.mark.parametrize("missing", ["question", "correct_index", "explanation"])
def test_true_false_missing_required_key(missing):
    payload = {
        "question": "Beijing is the capital of China.",
        "correct_index": 0,
        "explanation": "Geography.",
    }
    del payload[missing]
    with pytest.raises(ValueError, match="missing required keys"):
        parse_true_false(json.dumps(payload))


@pytest.mark.parametrize("idx", [-1, 2, "1", None])
def test_true_false_correct_index_invalid(idx):
    raw = json.dumps({
        "question": "Statement.",
        "correct_index": idx,
        "explanation": "e",
    })
    with pytest.raises(ValueError, match="correct_index must be 0 or 1"):
        parse_true_false(raw)


# ── parse_short_answer ────────────────────────────────────────────

def test_short_answer_valid():
    result = parse_short_answer(json.dumps({
        "question": "Explain recursion.",
        "reference_answer": "A function calling itself.",
        "keywords": ["function", "self"],
    }))
    assert result["question_type"] == "short_answer"
    assert result["correct_index"] == 0
    assert result["options"] == json.dumps({
        "reference_answer": "A function calling itself.",
        "keywords": ["function", "self"],
    })
    # explanation defaults to reference_answer
    assert result["explanation"] == "A function calling itself."


def test_short_answer_keeps_explicit_explanation():
    result = parse_short_answer(json.dumps({
        "question": "Explain recursion.",
        "reference_answer": "A function calling itself.",
        "keywords": ["function"],
        "explanation": "custom explanation",
    }))
    assert result["explanation"] == "custom explanation"


@pytest.mark.parametrize("missing", ["question", "reference_answer", "keywords"])
def test_short_answer_missing_required_key(missing):
    payload = {
        "question": "Explain recursion.",
        "reference_answer": "A function calling itself.",
        "keywords": ["function"],
    }
    del payload[missing]
    with pytest.raises(ValueError, match="missing required keys"):
        parse_short_answer(json.dumps(payload))


def test_short_answer_keywords_not_list():
    raw = json.dumps({
        "question": "Explain recursion.",
        "reference_answer": "A function calling itself.",
        "keywords": "function, self",
    })
    with pytest.raises(ValueError, match="keywords must be a list"):
        parse_short_answer(raw)


# ── parse_batch ───────────────────────────────────────────────────

def test_batch_valid_mixed():
    raw = json.dumps({
        "questions": [
            {"question": "sc", "options": ["a", "b", "c", "d"],
             "correct_index": 2, "explanation": "e", "difficulty": "hard"},
            {"question": "tf", "correct_index": 1, "explanation": "e",
             "question_type": "true_false"},
            {"question": "sa", "reference_answer": "ra", "keywords": ["k1"],
             "explanation": "e", "question_type": "short_answer"},
        ]
    })
    result = parse_batch(raw)
    assert isinstance(result, list)
    assert len(result) == 3

    assert result[0]["question_type"] == "single_choice"
    assert result[0]["options"] == json.dumps(["a", "b", "c", "d"])
    assert result[0]["correct_index"] == 2
    assert result[0]["difficulty"] == "hard"

    assert result[1]["question_type"] == "true_false"
    assert result[1]["options"] == json.dumps(["正确", "错误"])
    assert result[1]["correct_index"] == 1
    assert result[1]["difficulty"] == "medium"

    assert result[2]["question_type"] == "short_answer"
    assert result[2]["options"] == json.dumps({"reference_answer": "ra", "keywords": ["k1"]})
    assert result[2]["correct_index"] == 0
    assert result[2]["explanation"] == "e"
    assert result[2]["difficulty"] == "medium"


def test_batch_single_choice_defaults_filled():
    raw = json.dumps({"questions": [{"question": "q", "options": ["a", "b", "c", "d"]}]})
    result = parse_batch(raw)
    assert result[0]["question_type"] == "single_choice"
    assert result[0]["correct_index"] == 0
    assert result[0]["explanation"] == ""
    assert result[0]["difficulty"] == "medium"


def test_batch_default_question_type_is_single_choice():
    raw = json.dumps({"questions": [
        {"question": "q", "options": ["a", "b", "c", "d"], "correct_index": 3, "explanation": "e"}
    ]})
    result = parse_batch(raw)
    assert result[0]["question_type"] == "single_choice"


def test_batch_true_false_forces_invalid_correct_index():
    raw = json.dumps({"questions": [
        {"question": "q", "correct_index": 5, "question_type": "true_false"}
    ]})
    result = parse_batch(raw)
    assert result[0]["correct_index"] == 0
    assert result[0]["options"] == json.dumps(["正确", "错误"])


def test_batch_short_answer_missing_fields_defaults():
    raw = json.dumps({"questions": [
        {"question": "q", "question_type": "short_answer"}
    ]})
    result = parse_batch(raw)
    assert result[0]["options"] == json.dumps({"reference_answer": "", "keywords": []})
    assert result[0]["correct_index"] == 0
    assert result[0]["explanation"] == ""
    assert result[0]["difficulty"] == "medium"


def test_batch_single_choice_missing_options_raises():
    raw = json.dumps({"questions": [{"question": "q", "correct_index": 0}]})
    with pytest.raises(ValueError, match="Question missing options"):
        parse_batch(raw)


def test_batch_missing_questions():
    with pytest.raises(ValueError, match="missing 'questions' list"):
        parse_batch(json.dumps({"foo": 1}))


def test_batch_questions_not_list():
    with pytest.raises(ValueError, match="missing 'questions' list"):
        parse_batch(json.dumps({"questions": {"question": "q"}}))


# ── Non-JSON input, exercised across every parser ─────────────────

@pytest.mark.parametrize("parser", [
    parse_single_choice,
    parse_true_false,
    parse_short_answer,
    parse_batch,
])
def test_non_json_raises_value_error(parser):
    with pytest.raises(ValueError, match="not valid JSON"):
        parser("this is definitely not json")

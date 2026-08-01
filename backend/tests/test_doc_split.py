"""
Unit tests for doc_split.py — document segmentation for line-by-line chat mode.
Pure string functions, no DB/LLM/network dependencies.
"""
import pytest

from doc_split import (
    split_document,
    _find_split_point,
    _force_split_long,
    _MIN_SEGMENT_LEN,
    _MAX_SEGMENT_LEN,
)


class TestSplitDocument:
    """split_document: paragraph → segment splitting + merging + force-split"""

    def test_empty_input_returns_empty_list(self):
        """Empty or whitespace-only input yields no segments."""
        assert split_document("") == []
        assert split_document("   ") == []
        assert split_document("\n\n\n") == []

    def test_none_input_returns_empty_list(self):
        """None input is handled safely (returns empty list)."""
        assert split_document(None) == []

    def test_short_document_single_segment(self):
        """A single short sentence is kept as one segment."""
        assert split_document("你好世界。") == ["你好世界。"]

    def test_short_text_without_terminator_single_segment(self):
        """Text shorter than _MIN_SEGMENT_LEN with no terminator still yields one segment."""
        assert split_document("你好") == ["你好"]

    def test_segment_at_min_length_is_emitted(self):
        """A segment exactly at _MIN_SEGMENT_LEN chars is emitted on its own."""
        # 你好世界。 is exactly 5 chars
        assert _MIN_SEGMENT_LEN == 5
        assert split_document("你好世界。") == ["你好世界。"]

    def test_multiple_chinese_sentences_split(self):
        """Each Chinese-terminated sentence becomes its own segment."""
        result = split_document("今天天气很好。我们去公园散步。然后回家吃饭。")
        assert result == ["今天天气很好。", "我们去公园散步。", "然后回家吃饭。"]

    def test_short_segment_merged_with_next(self):
        """A segment shorter than _MIN_SEGMENT_LEN is merged into the following one."""
        result = split_document("短。之后有长句可以合并进来成为更长的一段。")
        assert len(result) == 1
        assert result[0] == "短。之后有长句可以合并进来成为更长的一段。"

    def test_trailing_short_content_merged_into_last_segment(self):
        """Trailing short content without a terminator appends to the last segment."""
        result = split_document("第一句话很长。短")
        assert len(result) == 1
        assert result[0].endswith("短")

    def test_heading_stays_own_segment(self):
        """A markdown heading paragraph is kept verbatim as its own segment."""
        result = split_document("# Chapter 1\n\nSome content here. More content here.")
        assert result == ["# Chapter 1", "Some content here.", "More content here."]

    def test_multiple_headings_each_own_segment(self):
        """Each heading paragraph stays separate, even when consecutive."""
        assert split_document("# One\n\n# Two") == ["# One", "# Two"]

    def test_single_newline_within_paragraph_splits(self):
        """A single \\n inside a paragraph also acts as a sentence boundary."""
        result = split_document("今天天气很好。\n我们去公园吧。")
        assert result == ["今天天气很好。", "我们去公园吧。"]

    def test_mixed_document(self):
        """Heading + normal sentences + short-merge behave together."""
        doc = "# 第一章\n\n今天天气很好。我们去公园。\n\n短。之后的句子要合并进来。"
        result = split_document(doc)
        assert result == [
            "# 第一章",
            "今天天气很好。",
            "我们去公园。",
            "短。之后的句子要合并进来。",
        ]

    def test_segment_at_max_length_not_force_split(self):
        """A segment exactly _MAX_SEGMENT_LEN chars long is NOT force-split."""
        assert _MAX_SEGMENT_LEN == 200
        assert split_document("a" * 200) == ["a" * 200]

    def test_oversized_segment_without_boundary_stays_single(self):
        """A >max segment with no natural boundary survives as one oversized segment."""
        assert split_document("a" * 201) == ["a" * 201]

    def test_oversized_segment_force_split(self):
        """A long paragraph is force-split into chunks each <= _MAX_SEGMENT_LEN."""
        original = ("hello " * 100).strip()
        result = split_document(original)
        assert len(result) >= 2
        assert all(len(seg) <= _MAX_SEGMENT_LEN for seg in result)
        # Whitespace-normalized reconstruction preserves all words
        assert " ".join(result) == original


class TestFindSplitPoint:
    """_find_split_point: pick a natural boundary near max_len"""

    def test_text_within_max_len_returns_minus_one(self):
        assert _find_split_point("short", 100) == -1

    def test_no_boundary_returns_minus_one(self):
        """Text with no spaces/terminators has no split point."""
        assert _find_split_point("a" * 500, 200) == -1

    def test_sentence_boundary_dot_capital(self):
        """. <space> Capital near max_len is preferred (returns end of boundary)."""
        text = "a" * 60 + ". B" + "x" * 200
        assert _find_split_point(text, 100) == 62

    def test_semicolon_boundary(self):
        """; <space> Capital near max_len is a valid split point."""
        text = "a" * 60 + "; B" + "x" * 200
        assert _find_split_point(text, 100) == 62

    def test_numbered_item_boundary(self):
        """A space before a numbered item ( 1. ) is a split point."""
        text = "a" * 50 + " 1. bbbbb" + "c" * 200
        assert _find_split_point(text, 100) == 50

    def test_lettered_item_boundary(self):
        """A space before a lettered item ( (a) ) is a split point."""
        text = "a" * 50 + " (a) bbbbb" + "c" * 200
        assert _find_split_point(text, 100) == 50

    def test_section_header_boundary(self):
        """A space before a known section header (Chapter etc.) is a split point."""
        text = "a" * 50 + " Chapter X" + "y" * 200
        assert _find_split_point(text, 100) == 50

    def test_last_space_before_max_len_fallback(self):
        """Fallback: last space strictly before max_len."""
        assert _find_split_point("word " * 30, 100) == 99

    def test_first_space_past_max_len_last_resort(self):
        """Last resort: first space past max_len when nothing earlier."""
        assert _find_split_point("a" * 120 + " bbb", 100) == 120


class TestForceSplitLong:
    """_force_split_long: recursively split one oversized segment"""

    def test_already_short_single_segment(self):
        assert _force_split_long("abc", 10) == ["abc"]

    def test_no_boundary_returns_single_oversized_segment(self):
        """Without any natural boundary the segment is returned unsplit."""
        assert _force_split_long("a" * 500, 200) == ["a" * 500]

    def test_recursive_split_respects_max_len(self):
        """Splits at the boundary; each half is recursed and stays within max_len."""
        original = "a" * 197 + ". B" + "b" * 100
        result = _force_split_long(original, 200)
        assert len(result) == 2
        # Split lands at the '. ' boundary; the space is consumed by left.strip()
        assert result[0] == "a" * 197 + "."
        assert result[1] == "B" + "b" * 100
        assert all(len(seg) <= 200 for seg in result)
        assert " ".join(result) == original

    def test_recursive_split_preserves_content_when_space_boundary(self):
        """Space-based splitting preserves all words across chunks."""
        original = "word " * 60
        result = _force_split_long(original, 200)
        assert len(result) >= 2
        assert all(len(seg) <= 200 for seg in result)
        assert " ".join(result) == original.strip()

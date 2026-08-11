"""
Unit tests for parse_format.py — LLM markdown formatting helpers.

Covers the math protect/restore roundtrip (incl. the backtick-wrapped
placeholder regression), verbatim-preservation predicate, and chunk splitting.
Pure string functions, no DB/LLM/network dependencies.
"""
import pytest

from parse_format import (
    _protect_math,
    _restore_math,
    _split_text,
    should_preserve_verbatim,
)


class TestMathProtectRestore:
    """_protect_math/_restore_math roundtrip across every math form"""

    @pytest.mark.parametrize("formula", [
        "E = mc^2",
        r"\int_0^1 x \, dx",
        r"\sum_{i=1}^{n} i",
        r"\frac{a}{b}",
        r"\begin{pmatrix}1 & 2 \\ 3 & 4\end{pmatrix}",
        r"\alpha + \beta",
    ])
    def test_inline_math_roundtrip(self, formula):
        """An inline $...$ formula survives protect/restore unchanged."""
        text = f"上下文 ${formula}$ 之后。"
        protected, repl = _protect_math(text)
        assert "ACACIA_MATH_PLACEHOLDER" in protected
        assert _restore_math(protected, repl) == text

    def test_block_math_roundtrip(self):
        """Block $$...$$ math survives protect/restore unchanged."""
        text = "前文 $$\n\\int_0^1 x dx = \\frac{1}{2}\n$$ 后文"
        protected, repl = _protect_math(text)
        assert "ACACIA_MATH_PLACEHOLDER" in protected
        assert _restore_math(protected, repl) == text

    def test_no_math_is_passthrough(self):
        """Text without math has no placeholders and restores to itself."""
        text = "纯文本，没有公式。"
        protected, repl = _protect_math(text)
        assert protected == text
        assert repl == {}
        assert _restore_math(protected, repl) == text

    def test_mixed_inline_and_block_roundtrip(self):
        """Both inline and block formulas restore in original order."""
        text = "行内 $a+b$ 和块级 $$c+d$$ 都要保留。"
        protected, repl = _protect_math(text)
        assert _restore_math(protected, repl) == text

    def test_backticked_placeholder_has_no_stray_backticks(self):
        """Regression: LLM wrapping a placeholder in backticks must not leave backticks.

        The bare-placeholder replace used to run first, consuming the placeholder
        inside the backticks and leaving `$...$` behind.
        """
        text = "公式 $a + b$"
        protected, repl = _protect_math(text)
        placeholder = list(repl.keys())[0]
        backticked = protected.replace(placeholder, f"`{placeholder}`")
        restored = _restore_math(backticked, repl)
        assert "`" not in restored
        assert restored == text


class TestShouldPreserveVerbatim:
    """should_preserve_verbatim: which formats skip LLM formatting"""

    def test_markdown_extensions_preserved(self):
        assert should_preserve_verbatim(".md")
        assert should_preserve_verbatim(".MD")
        assert should_preserve_verbatim(".markdown")

    def test_other_extensions_not_preserved(self):
        assert not should_preserve_verbatim(".pdf")
        assert not should_preserve_verbatim(".txt")
        assert not should_preserve_verbatim(".docx")
        assert not should_preserve_verbatim("")


class TestSplitText:
    """_split_text: paragraph-aware chunking under a size cap"""

    def test_short_text_single_chunk(self):
        assert _split_text("只有一个段落。", 100) == ["只有一个段落。"]

    def test_chunks_respect_size_cap(self):
        """Each chunk's paragraph content stays within the size cap (separators excluded)."""
        text = "\n\n".join(["段" * 2000 for _ in range(5)])
        chunks = _split_text(text, 8000)
        # The size check runs on pre-join paragraph lengths, so a chunk's
        # emitted string can exceed `size` by its \\n\\n separators — but the
        # paragraph content itself never does, and no paragraph is split.
        assert all(
            sum(len(p) for p in chunk.split('\n\n')) <= 8000
            for chunk in chunks
        )
        assert len(chunks) > 1

    def test_paragraphs_never_split_across_chunks(self):
        """A paragraph is never split; chunk boundaries fall between paragraphs."""
        text = "\n\n".join(["段A", "段B", "段C"])
        chunks = _split_text(text, 2)
        # '段A' + '段B' = 4 > 2, so each paragraph becomes its own chunk.
        assert chunks == ["段A", "段B", "段C"]

    def test_reconstruction_preserves_content(self):
        """Joining chunks with \\n\\n reproduces the original text."""
        text = "\n\n".join(["第一段。", "第二段，内容长一点。"])
        chunks = _split_text(text, 3)
        assert "\n\n".join(chunks) == text

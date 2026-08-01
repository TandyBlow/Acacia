"""Tests for the knowledge index/search/retriever modules (line-by-line chat mode).

Covers:
- _tokenize() mixed Chinese/English/number tokenization
- KnowledgeIndex.add() / search() Jaccard matching, ranking, top-5 cap, threshold
- search_user_knowledge() cross-concept dedupe + ranking
- format_personalized_context() formatting + snippet truncation
- build_content_index() against the isolated SQLite DB and via patched repository
- get_user_kp_names() / knowledge_retriever re-exports
"""
from unittest.mock import patch

from database import get_db_ctx

from knowledge_index import (
    KnowledgeIndex,
    _tokenize,
    _describe_match,
    build_content_index,
)
from knowledge_search import (
    search_user_knowledge,
    format_personalized_context,
    get_user_kp_names,
)
import knowledge_retriever


# ── _tokenize ────────────────────────────────────────────────────────────


def test_tokenize_mixed_chinese_english_numbers():
    tokens = _tokenize("机器学习 AI 2024 训练数据")
    assert "机" in tokens
    assert "器" in tokens
    assert "学" in tokens
    assert "训" in tokens
    assert "ai" in tokens  # English lowered
    assert "2024" in tokens


def test_tokenize_empty_returns_empty_set():
    assert _tokenize("") == set()
    assert _tokenize(None) == set()


def test_tokenize_is_case_insensitive_and_trims():
    t1 = _tokenize("  Python ")
    t2 = _tokenize("python")
    assert t1 == t2
    assert "python" in t1
    assert "Python" not in t1


# ── KnowledgeIndex.add / search ──────────────────────────────────────────


def test_index_add_and_search_hits_indexed_content():
    index = KnowledgeIndex()
    index.add("kp-1", "向量", "向量是具有大小和方向的量，机器学习中用向量表示数据点")
    matches = index.search({"name": "向量", "definition": "机器学习中的向量表示"})
    assert len(matches) == 1
    m = matches[0]
    assert m["kp_name"] == "向量"
    assert "向量" in m["content_snippet"]
    assert 0.0 <= m["score"] <= 1.0
    assert "向量" in m["why"]


def test_search_empty_index_returns_empty():
    index = KnowledgeIndex()
    assert index.search({"name": "任意", "definition": "内容"}) == []


def test_search_empty_concept_tokens_returns_empty():
    index = KnowledgeIndex()
    index.add("kp-1", "笔记", "一些笔记内容")
    # concept with no name and no definition -> no query tokens
    assert index.search({"name": "", "definition": ""}) == []


def test_search_no_match_below_default_threshold():
    index = KnowledgeIndex()
    index.add("kp-1", "光合作用", "光合作用是植物利用光能合成有机物的过程")
    # disjoint token sets (micro + derivative vs photosynthesis + sunlight)
    matches = index.search({"name": "微积分", "definition": "导数 极限 连续"})
    assert matches == []


def test_search_threshold_param_filters_weak_matches():
    index = KnowledgeIndex()
    # tokens: {编,程,使,用,语,言,python}; score vs query = 5/7 ~= 0.71
    index.add("kp-1", "编程", "编程使用 python 语言")
    concept = {"name": "Python", "definition": "编程语言 Python"}
    assert len(index.search(concept)) == 1          # default 0.10 -> hit
    assert len(index.search(concept, threshold=0.6)) == 1  # 0.71 >= 0.6 -> hit
    assert index.search(concept, threshold=0.8) == []       # 0.71 < 0.8 -> miss


def test_search_returns_top5_sorted_by_score_desc():
    index = KnowledgeIndex()
    for i in range(1, 7):
        index.add(f"kp-{i}", f"KP{i}", f"机器学习 数据 算法 模型 训练 神经网络 {i}")
    concept = {"name": "机器学习", "definition": "机器学习需要数据 算法 模型 训练 神经网络 深度学习"}
    matches = index.search(concept)
    assert len(matches) == 5  # capped at top 5
    scores = [m["score"] for m in matches]
    assert scores == sorted(scores, reverse=True)


def test_search_skips_entries_without_tokens():
    index = KnowledgeIndex()
    index.add("kp-1", "", "")  # no name, no content -> empty token set
    index.add("kp-2", "笔记", "有内容的笔记")
    matches = index.search({"name": "笔记", "definition": ""})
    names = {m["kp_name"] for m in matches}
    assert names == {"笔记"}  # token-less entry skipped, no crash


def test_describe_match_score_tiers():
    concept = {"name": "概念"}
    entry = {"kp_name": "旧知识点"}
    high = _describe_match(concept, entry, 0.5)
    mid = _describe_match(concept, entry, 0.2)
    low = _describe_match(concept, entry, 0.05)
    assert "明确关联" in high
    assert "部分相关" in mid
    assert "可能涉及" in low


# ── search_user_knowledge ────────────────────────────────────────────────


def test_search_user_knowledge_dedupes_by_kp_name_and_sorts():
    index = KnowledgeIndex()
    index.add("kp-1", "机器学习", "机器学习是人工智能的一个分支 需要大量数据训练模型")
    index.add("kp-2", "深度学习", "深度学习使用深层神经网络进行特征学习")
    concepts = [
        {"name": "机器学习", "definition": "人工智能的一个分支"},
        {"name": "监督学习", "definition": "机器学习中常见范式 需要带标签数据训练"},
    ]
    matches = search_user_knowledge(concepts, index)
    names = [m["kp_name"] for m in matches]
    assert len(names) == len(set(names))  # no duplicates
    scores = [m["score"] for m in matches]
    assert scores == sorted(scores, reverse=True)


def test_search_user_knowledge_empty_inputs():
    index = KnowledgeIndex()
    index.add("kp-1", "笔记", "内容")
    assert search_user_knowledge([], index) == []
    assert search_user_knowledge([{"name": "x", "definition": "y"}], KnowledgeIndex()) == []


# ── format_personalized_context ──────────────────────────────────────────


def test_format_personalized_context_empty_returns_empty_string():
    assert format_personalized_context([]) == ""


def test_format_personalized_context_renders_matches():
    matches = [
        {
            "kp_name": "向量",
            "content_snippet": "向量是具有大小和方向的量",
            "score": 0.9,
            "why": "「向量」与「向量」有明确关联",
        }
    ]
    out = format_personalized_context(matches)
    assert "个性化知识关联" in out
    assert "向量" in out
    assert "用户笔记片段" in out
    assert "有明确关联" in out


def test_format_personalized_context_truncates_long_snippet():
    long_content = "a" * 250
    matches = [
        {
            "kp_name": "笔记",
            "content_snippet": long_content,
            "score": 0.5,
            "why": "「笔记」与「笔记」有明确关联",
        }
    ]
    out = format_personalized_context(matches)
    assert "..." in out
    assert "a" * 150 in out
    assert "a" * 160 not in out


# ── build_content_index (real isolated DB) ───────────────────────────────


def _insert_user(owner_id: str) -> None:
    with get_db_ctx() as conn:
        conn.execute(
            "INSERT INTO users (id, username, password_hash) VALUES (?, ?, ?)",
            (owner_id, "tester", "hash"),
        )


def _insert_node(owner_id: str, node_id: str, name: str, content: str) -> None:
    with get_db_ctx() as conn:
        conn.execute(
            "INSERT INTO nodes (id, owner_id, name, content) VALUES (?, ?, ?, ?)",
            (node_id, owner_id, name, content),
        )


def test_build_content_index_from_isolated_db(isolated_db):
    _insert_user("u-index")
    _insert_node("u-index", "n-1", "向量", "向量是具有大小和方向的量")
    _insert_node("u-index", "n-2", "微积分", "微积分研究导数与积分")

    index = build_content_index("u-index")
    assert len(index.entries) == 2

    # Hits the indexed content
    matches = index.search({"name": "向量", "definition": "向量表示数据点"})
    assert any(m["kp_name"] == "向量" for m in matches)

    # Different owner's index is empty
    assert build_content_index("u-other").entries == []


def test_build_content_index_skips_nameless_nodes(isolated_db):
    _insert_user("u-nameless")
    _insert_node("u-nameless", "n-1", "有名字", "可被索引的内容")
    _insert_node("u-nameless", "n-2", "", "没有名字的节点不应被索引")

    index = build_content_index("u-nameless")
    assert len(index.entries) == 1
    assert index.entries[0]["kp_name"] == "有名字"


def test_build_content_index_patches_repository():
    fake_nodes = [
        {"id": "n-1", "name": "向量", "content": "向量有大小和方向"},
        {"id": "n-2", "name": "", "content": "nameless should be skipped"},
    ]
    with patch("tree_repository_sqlite.fetch_user_nodes_with_knowledge",
               return_value=fake_nodes) as mock_fetch:
        index = build_content_index("u-patched")
    mock_fetch.assert_called_once_with("u-patched")
    assert len(index.entries) == 1
    assert index.entries[0]["kp_id"] == "n-1"


# ── get_user_kp_names / retriever re-exports ─────────────────────────────


def test_get_user_kp_names_from_patched_repository():
    fake_nodes = [
        {"id": "n-1", "name": "向量"},
        {"id": "n-2", "name": "微积分"},
        {"id": "n-3", "name": ""},  # nameless excluded
    ]
    with patch("tree_repository_sqlite.fetch_user_nodes_with_knowledge",
               return_value=fake_nodes) as mock_fetch:
        names = get_user_kp_names("u-kp")
    mock_fetch.assert_called_once_with("u-kp")
    assert names == {"向量", "微积分"}


def test_knowledge_retriever_re_exports_all_symbols():
    assert knowledge_retriever.KnowledgeIndex is KnowledgeIndex
    assert knowledge_retriever.build_content_index is build_content_index
    assert knowledge_retriever.search_user_knowledge is search_user_knowledge
    assert knowledge_retriever.format_personalized_context is format_personalized_context
    assert knowledge_retriever.get_user_kp_names is get_user_kp_names
    assert knowledge_retriever._tokenize is _tokenize
    assert hasattr(knowledge_retriever, "_TOKEN_RE")

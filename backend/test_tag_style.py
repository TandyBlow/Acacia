"""
Tests for tag_service and style_service with mock data.
"""
from unittest.mock import patch, MagicMock
from collections import Counter

from tag_service import tag_node, DOMAIN_KEYWORDS
from style_service import compute_style, STYLE_RULES


MOCK_NODES = [
    {"id": "01", "name": "日本料理研究", "content": {"markdown": "寿司和拉面"}},
    {"id": "02", "name": "动漫角色分析", "content": {"markdown": "火影忍者"}},
    {"id": "03", "name": "东京旅行计划", "content": {"markdown": "浅草寺和秋叶原"}},
    {"id": "04", "name": "日语N2备考", "content": {"markdown": "语法和单词"}},
    {"id": "05", "name": "二次元文化笔记", "content": {"markdown": "manga推荐"}},
    {"id": "06", "name": "武士道精神", "content": {"markdown": "和风美学"}},
    {"id": "07", "name": "樱花季摄影", "content": {"markdown": "京都赏樱"}},
    {"id": "08", "name": "日本文学入门", "content": {"markdown": "川端康成"}},
    {"id": "09", "name": "动漫音乐收藏", "content": {"markdown": "anime ost"}},
    {"id": "10", "name": "日本历史年表", "content": {"markdown": "战国时代"}},
    {"id": "11", "name": "漫画创作技巧", "content": {"markdown": "分镜与构图"}},
    {"id": "12", "name": "日语听力练习", "content": {"markdown": "nhk新闻"}},
    {"id": "13", "name": "Python学习笔记", "content": {"markdown": "flask框架"}},
    {"id": "14", "name": "Vue项目实战", "content": {"markdown": "组件开发"}},
    {"id": "15", "name": "算法刷题记录", "content": {"markdown": "动态规划"}},
    {"id": "16", "name": "读书笔记", "content": {"markdown": "百年孤独"}},
    {"id": "17", "name": "周末计划", "content": {"markdown": "去公园散步"}},
    {"id": "18", "name": "购物清单", "content": {"markdown": "牛奶面包鸡蛋"}},
    {"id": "19", "name": "健身记录", "content": {"markdown": "跑步5公里"}},
    {"id": "20", "name": "菜谱收集", "content": {"markdown": "红烧肉做法"}},
]


def test_tag_node_japanese():
    assert tag_node("日本料理研究", "寿司和拉面") == '日本文化'
    assert tag_node("动漫角色分析", "火影忍者") == '日本文化'
    assert tag_node("东京旅行计划", "浅草寺") == '日本文化'
    assert tag_node("二次元文化笔记", "manga推荐") == '日本文化'
    assert tag_node("樱花季摄影", "京都赏樱") == '日本文化'


def test_tag_node_programming():
    assert tag_node("Python学习笔记", "flask") == '编程技术'
    assert tag_node("Vue项目实战", "组件") == '编程技术'


def test_tag_node_other():
    assert tag_node("周末计划", "去公园散步") == '其他'
    assert tag_node("购物清单", "牛奶面包") == '其他'


def test_tag_node_content_match():
    assert tag_node("笔记", "学习日语语法") == '日本文化'
    assert tag_node("记录", "sql优化方案") == '编程技术'


def test_all_mock_nodes_distribution():
    """12/20 should be 日本文化 => 60% > 30% => sakura"""
    tags = [tag_node(n["name"], n["content"]["markdown"]) for n in MOCK_NODES]
    counts = Counter(tags)
    assert counts['日本文化'] == 12
    assert counts['编程技术'] == 3
    assert counts['其他'] == 5


def test_compute_style_sakura():
    """Full pipeline: 12/20 日本文化 => style='sakura'"""
    mock_resp = MagicMock()
    mock_resp.data = [
        {"domain_tag": "日本文化"} for _ in range(12)
    ] + [
        {"domain_tag": "编程技术"} for _ in range(3)
    ] + [
        {"domain_tag": "其他"} for _ in range(5)
    ]

    with patch('style_service.supabase') as mock_sb:
        mock_sb.table.return_value.select.return_value \
            .eq.return_value.eq.return_value.execute.return_value = mock_resp
        result = compute_style("test-user")

    assert result["style"] == "sakura"
    assert result["distribution"]["日本文化"] == 0.6


def test_compute_style_cyberpunk():
    """编程技术 > 40% => cyberpunk"""
    mock_resp = MagicMock()
    mock_resp.data = [
        {"domain_tag": "编程技术"} for _ in range(9)
    ] + [
        {"domain_tag": "其他"} for _ in range(11)
    ]

    with patch('style_service.supabase') as mock_sb:
        mock_sb.table.return_value.select.return_value \
            .eq.return_value.eq.return_value.execute.return_value = mock_resp
        result = compute_style("test-user")

    assert result["style"] == "cyberpunk"


def test_compute_style_default():
    """No domain exceeds threshold => default"""
    mock_resp = MagicMock()
    mock_resp.data = [{"domain_tag": "其他"} for _ in range(20)]

    with patch('style_service.supabase') as mock_sb:
        mock_sb.table.return_value.select.return_value \
            .eq.return_value.eq.return_value.execute.return_value = mock_resp
        result = compute_style("test-user")

    assert result["style"] == "default"


def test_compute_style_empty():
    """No nodes => default"""
    mock_resp = MagicMock()
    mock_resp.data = []

    with patch('style_service.supabase') as mock_sb:
        mock_sb.table.return_value.select.return_value \
            .eq.return_value.eq.return_value.execute.return_value = mock_resp
        result = compute_style("test-user")

    assert result["style"] == "default"
    assert result["distribution"] == {}

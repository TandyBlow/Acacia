"""
Domain tag service: assigns domain tags to nodes via keyword matching.
"""
from os import getenv
from collections import Counter

from dotenv import load_dotenv
from supabase import create_client, Client

load_dotenv()

supabase: Client = create_client(
    getenv("SUPABASE_URL") or "https://placeholder.supabase.co",
    getenv("SUPABASE_SERVICE_KEY") or "placeholder-key"
)

DOMAIN_KEYWORDS = {
    '日本文化': ['日本', '动漫', '漫画', '樱花', '东京', '日语', '二次元', 'anime', 'manga', '和风', '武士', '忍者', '京都'],
    '编程技术': ['python', 'javascript', 'c语言', 'java', 'api', '算法', '数据库', 'vue', 'react', '代码', '编程', '开发', 'css', 'html', 'sql', 'nlp', '机器学习'],
    '自然科学': ['物理', '化学', '生物', '数学', '天文', '地理', '实验', '公式', '定理'],
    '文学艺术': ['文学', '诗', '小说', '绘画', '音乐', '美术', '电影', '艺术', '哲学'],
    '历史人文': ['历史', '文化', '政治', '经济', '社会', '古代', '近代'],
    '语言学习': ['英语', '德语', '法语', '西班牙语', '单词', '语法', '翻译'],
}


def tag_node(name: str, content: str) -> str:
    text = f"{name} {content}".lower()
    for domain, keywords in DOMAIN_KEYWORDS.items():
        for kw in keywords:
            if kw.lower() in text:
                return domain
    return '其他'


def tag_all_nodes(user_id: str) -> dict:
    resp = supabase.table('nodes') \
        .select('id, name, content') \
        .eq('owner_id', user_id) \
        .eq('is_deleted', False) \
        .execute()

    nodes = resp.data
    if not nodes:
        return {"tagged": 0, "tags": {}}

    tag_counts: Counter = Counter()
    for node in nodes:
        content_md = ""
        content = node.get('content')
        if isinstance(content, dict):
            content_md = content.get('markdown', '')
        elif isinstance(content, str):
            content_md = content

        tag = tag_node(node['name'], content_md)
        tag_counts[tag] += 1

        supabase.table('nodes') \
            .update({'domain_tag': tag}) \
            .eq('id', node['id']) \
            .execute()

    return {"tagged": len(nodes), "tags": dict(tag_counts)}

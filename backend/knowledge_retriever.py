"""
Knowledge retriever for line-by-line chat mode.
Indexes user knowledge point contents and searches for matches against
extracted atomic concepts. Returns structured personalized context.
"""
import re
from typing import Dict, List


# ── Simple tokenizer (no external dependencies) ──────────────────────────

# Common Chinese + English word boundary patterns
_TOKEN_RE = re.compile(r'[一-鿿]+|[a-zA-Z0-9_]+|[^\s]')


def _tokenize(text: str) -> set:
    """Tokenize text into a set of normalized tokens.

    Handles mixed Chinese/English text without external dependencies.
    Chinese characters are treated as individual tokens for substring matching;
    English words are kept as-is.
    """
    if not text:
        return set()
    text = text.lower().strip()
    tokens = set()
    # Chinese chars as individual tokens
    chinese = re.findall(r'[一-鿿]', text)
    tokens.update(chinese)
    # English/identifier words
    english = re.findall(r'[a-zA-Z_][a-zA-Z0-9_]*', text)
    tokens.update(w.lower() for w in english)
    # Numbers
    numbers = re.findall(r'\d+', text)
    tokens.update(numbers)
    return tokens


# ── Knowledge Index ──────────────────────────────────────────────────────


class KnowledgeIndex:
    """A simple searchable index of user knowledge point contents."""

    def __init__(self):
        self.entries: list[dict] = []  # [{kp_id, kp_name, content, tokens}]

    def add(self, kp_id: str, kp_name: str, content: str):
        """Add a knowledge point to the index."""
        self.entries.append({
            "kp_id": kp_id,
            "kp_name": kp_name,
            "content": content,
            "tokens": _tokenize(content) | _tokenize(kp_name),
        })

    def search(self, concept: dict, threshold: float = 0.10) -> list[dict]:
        """Search the index for matches against a concept.

        Args:
            concept: A dict with 'name', 'definition', 'category' keys.
            threshold: Minimum Jaccard similarity to consider a match.

        Returns:
            List of matches, each with {kp_name, content_snippet, score, why}.
            Empty list if no matches above threshold.
        """
        # Build query tokens from concept name + definition
        query_text = concept.get("name", "") + " " + concept.get("definition", "")
        query_tokens = _tokenize(query_text)

        if not query_tokens:
            return []

        matches = []
        for entry in self.entries:
            entry_tokens = entry["tokens"]
            if not entry_tokens:
                continue

            # Jaccard similarity
            intersection = len(query_tokens & entry_tokens)
            union = len(query_tokens | entry_tokens)
            if union == 0:
                continue
            score = intersection / union

            if score >= threshold:
                snippet = entry["content"][:200] if entry["content"] else ""
                matches.append({
                    "kp_name": entry["kp_name"],
                    "content_snippet": snippet,
                    "score": score,
                    "why": _describe_match(concept, entry, score),
                })

        # Sort by score descending, return top 5
        matches.sort(key=lambda m: m["score"], reverse=True)
        return matches[:5]


def _describe_match(concept: dict, entry: dict, score: float) -> str:
    """Build a brief description of why this match is relevant."""
    concept_name = concept.get("name", "")
    kp_name = entry["kp_name"]
    if score > 0.3:
        return f"用户对「{kp_name}」的理解与当前知识点「{concept_name}」有明确关联"
    elif score > 0.15:
        return f"「{kp_name}」与「{concept_name}」部分相关"
    return f"「{kp_name}」可能涉及「{concept_name}」的某些方面"


# ── Public API ───────────────────────────────────────────────────────────


def build_content_index(owner_id: str) -> KnowledgeIndex:
    """Build a searchable content index from all user knowledge points.

    Args:
        owner_id: The user's ID.

    Returns:
        KnowledgeIndex with all user KP contents indexed.
    """
    from tree_repository_sqlite import fetch_user_nodes_with_knowledge

    index = KnowledgeIndex()
    nodes = fetch_user_nodes_with_knowledge(owner_id)
    for node in nodes:
        content = node.get("content", "") or ""
        name = node.get("name", "")
        kp_id = node.get("id", "")
        if name:  # Only index nodes that have a name
            index.add(kp_id, name, content)
    return index


def search_user_knowledge(
    concepts: list[dict],
    index: KnowledgeIndex,
    threshold: float = 0.10,
) -> list[dict]:
    """Search user knowledge for matches against extracted concepts.

    Args:
        concepts: List of concept dicts from extract_atomic_concepts().
        index: A KnowledgeIndex built by build_content_index().
        threshold: Minimum Jaccard similarity (0.0-1.0).

    Returns:
        List of unique matches across all concepts, sorted by score.
    """
    if not concepts or not index.entries:
        return []

    seen: set = set()
    all_matches = []
    for concept in concepts:
        matches = index.search(concept, threshold)
        for m in matches:
            key = m["kp_name"]
            if key not in seen:
                seen.add(key)
                all_matches.append(m)

    all_matches.sort(key=lambda m: m["score"], reverse=True)
    return all_matches


def format_personalized_context(matches: list[dict]) -> str:
    """Format knowledge matches as structured context for the AI prompt.

    The context presents specific connections between the user's existing
    knowledge and the current content, using the user's own words where available.

    Args:
        matches: List of match dicts from search_user_knowledge().

    Returns:
        Formatted string for injection into the AI prompt, or empty string
        if no matches (no forced connections).
    """
    if not matches:
        return ""

    lines = ["【个性化知识关联】（以下展示用户已有知识与当前内容的真实关联，解释时自然地融入）"]
    for m in matches:
        kp_name = m["kp_name"]
        snippet = m["content_snippet"]
        why = m["why"]
        lines.append(f"\n  📎 {why}")
        lines.append(f"     知识点：「{kp_name}」")
        if snippet:
            # Truncate snippet for readability
            short = snippet[:150].replace("\n", " ")
            lines.append(f"     用户笔记片段：「{short}...」" if len(snippet) > 150 else f"     用户笔记片段：「{short}」")

    return "\n".join(lines)


def get_user_kp_names(owner_id: str) -> set:
    """Get the set of knowledge point names for a user. Used by definition chain."""
    from tree_repository_sqlite import fetch_user_nodes_with_knowledge

    nodes = fetch_user_nodes_with_knowledge(owner_id)
    return {n["name"] for n in nodes if n.get("name")}

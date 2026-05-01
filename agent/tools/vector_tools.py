from db.embeddings import search_codebase as _search


def search_codebase(query: str, top_k: int = 5) -> list[dict]:
    return _search(query=query, top_k=top_k)

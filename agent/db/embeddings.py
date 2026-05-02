import os
import base64
import requests
from pathlib import Path
from fastembed import TextEmbedding
from db.connection import get_connection

SUPPORTED_EXTENSIONS = {".py", ".js", ".ts", ".jsx", ".tsx", ".java", ".go"}

# Local embedding model — 384 dimensions, using fastembed (ONNX, no PyTorch needed)
_model = None


def _get_model() -> TextEmbedding:
    global _model
    if _model is None:
        _model = TextEmbedding(model_name="sentence-transformers/all-MiniLM-L6-v2")
    return _model


def _github_headers() -> dict:
    return {"Authorization": f"token {os.environ['GITHUB_TOKEN']}"}


def _embed(texts: list[str]) -> list[list[float]]:
    model = _get_model()
    embeddings = list(model.embed(texts))
    # fastembed returns numpy arrays, convert to list of floats
    return [e.tolist() for e in embeddings]


def extract_semantic_chunk(raw: str, extension: str) -> str:
    lines = raw.split("\n")

    if extension == ".py":
        meaningful = [
            l for l in lines
            if l.strip().startswith(("def ", "class ", '"""', "'''", "import "))
            or (l.strip() and not l.strip().startswith("#") and ":" in l[:60])
        ]
        result = "\n".join(meaningful[:80])
        if len(result) > 100:
            return result[:1500]

    if extension in {".js", ".ts", ".jsx", ".tsx"}:
        meaningful = [
            l for l in lines
            if l.strip().startswith((
                "function ", "class ", "export ", "import ", "const ", "async ",
                "interface ", "type ", "module.exports",
            ))
            or "=>" in l
        ]
        result = "\n".join(meaningful[:80])
        if len(result) > 100:
            return result[:1500]

    return raw[:1500].strip()


def embed_repository(owner: str, repo: str, branch: str | None = None) -> None:
    headers = _github_headers()

    # Auto-detect default branch if not specified
    if branch is None:
        repo_resp = requests.get(
            f"https://api.github.com/repos/{owner}/{repo}",
            headers=headers, timeout=10,
        ).json()
        branch = repo_resp.get("default_branch", "main")
        print(f"  Detected default branch: {branch}")

    tree_url = (
        f"https://api.github.com/repos/{owner}/{repo}/git/trees/{branch}?recursive=1"
    )
    tree = requests.get(tree_url, headers=headers, timeout=20).json()

    if "tree" not in tree:
        raise ValueError(f"Could not fetch tree for {owner}/{repo}@{branch}: {tree}")

    embedded = 0
    for item in tree["tree"]:
        if item["type"] != "blob":
            continue
        if Path(item["path"]).suffix not in SUPPORTED_EXTENSIONS:
            continue

        content_url = (
            f"https://api.github.com/repos/{owner}/{repo}/contents/{item['path']}"
        )
        content_resp = requests.get(content_url, headers=headers, timeout=20).json()
        if "content" not in content_resp:
            continue

        raw = base64.b64decode(content_resp["content"]).decode("utf-8", errors="ignore")
        chunk = extract_semantic_chunk(raw, Path(item["path"]).suffix)
        if not chunk:
            continue

        embedding = _embed([chunk])[0]

        with get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO code_embeddings (repo, file_path, chunk_text, embedding)
                    VALUES (%s, %s, %s, %s)
                    ON CONFLICT (repo, file_path) DO UPDATE
                        SET chunk_text   = EXCLUDED.chunk_text,
                            embedding    = EXCLUDED.embedding,
                            last_updated = NOW()
                    """,
                    (f"{owner}/{repo}", item["path"], chunk, embedding),
                )
        embedded += 1

    print(f"Embedded {embedded} files from {owner}/{repo}")


def search_codebase(query: str, top_k: int = 5) -> list[dict]:
    query_embedding = _embed([query])[0]

    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT file_path, chunk_text,
                       1 - (embedding <=> %s::vector) AS similarity
                FROM code_embeddings
                ORDER BY embedding <=> %s::vector
                LIMIT %s
                """,
                (query_embedding, query_embedding, top_k),
            )
            rows = cur.fetchall()

    return [
        {
            "path": row[0],
            "snippet": row[1][:500],
            "similarity_score": round(float(row[2]), 3),
            "source": "sentence-transformers",
        }
        for row in rows
    ]

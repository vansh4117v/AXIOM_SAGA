import os
import logging
from models.scratchpad import AgentScratchpad
from db.connection import get_connection
from db.embeddings import embed_repository
from sse_writer import push_sse_event

logger = logging.getLogger(__name__)


def _repos_to_embed() -> list[tuple[str, str]]:
    owner = os.environ.get("GITHUB_OWNER", "")
    repos_raw = os.environ.get("GITHUB_REPOS", "")
    repos = [r.strip() for r in repos_raw.split(",") if r.strip()]
    return [(owner, r) for r in repos]


def _count_embeddings(owner: str, repo: str) -> int:
    try:
        with get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT COUNT(*) FROM code_embeddings WHERE repo = %s",
                    (f"{owner}/{repo}",),
                )
                return cur.fetchone()[0]
    except Exception:
        return -1


def ensure_repos_embedded(state: AgentScratchpad) -> AgentScratchpad:
    """Pre-pipeline guard. Checks each repo in GITHUB_REPOS, embeds if missing."""
    run_id = state.get("run_id", "")
    repos = _repos_to_embed()
    embedded_any = False

    for owner, repo in repos:
        count = _count_embeddings(owner, repo)
        if count == 0:
            logger.info(f"[embed_guard] No embeddings for {owner}/{repo}, embedding now...")
            if run_id:
                push_sse_event(run_id, "embedding_started", {"repo": f"{owner}/{repo}"})
            try:
                embed_repository(owner, repo)
                embedded_any = True
                if run_id:
                    push_sse_event(run_id, "embedding_complete", {"repo": f"{owner}/{repo}"})
            except Exception as e:
                logger.error(f"[embed_guard] Failed to embed {owner}/{repo}: {e}")
                if run_id:
                    push_sse_event(run_id, "embedding_failed", {"repo": f"{owner}/{repo}", "error": str(e)})
        elif count > 0:
            logger.info(f"[embed_guard] {owner}/{repo} already has {count} embeddings, skipping")

    state["agent_trace"].append({
        "agent": "embed_guard",
        "decision_made": f"checked {len(repos)} repos, embedded={embedded_any}",
        "reasoning": "pre-pipeline embedding check",
    })
    return state


def startup_embed():
    """Called once on app startup. Embeds any repo with 0 rows in code_embeddings."""
    repos = _repos_to_embed()
    for owner, repo in repos:
        count = _count_embeddings(owner, repo)
        if count == 0:
            logger.info(f"[startup] Embedding {owner}/{repo}...")
            try:
                embed_repository(owner, repo)
                logger.info(f"[startup] Embedded {owner}/{repo}")
            except Exception as e:
                logger.error(f"[startup] Failed to embed {owner}/{repo}: {e}")
        elif count > 0:
            logger.info(f"[startup] {owner}/{repo} has {count} embeddings, skip")

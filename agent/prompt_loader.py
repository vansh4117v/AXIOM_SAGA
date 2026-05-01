import json
import os
from functools import lru_cache
from db.connection import get_connection

_PROMPTS_PATH = os.path.join(os.path.dirname(__file__), "config", "prompts.json")


# Caches JSON file in memory forever. load_prompt() reads DB first,
# so Prompt Studio edits via UI take effect immediately. This cache
# only affects the JSON fallback path when DB is unreachable.
@lru_cache(maxsize=None)
def _load_json_prompts() -> dict:
    with open(_PROMPTS_PATH) as f:
        return json.load(f)


def load_prompt(agent_name: str) -> str:
    try:
        with get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT system_prompt FROM agent_prompts WHERE agent_name = %s",
                    (agent_name,),
                )
                row = cur.fetchone()
        if row:
            return row[0]
    except Exception:
        pass

    fallback = _load_json_prompts()
    if agent_name not in fallback:
        raise KeyError(f"No prompt found for agent: {agent_name}")
    return fallback[agent_name]["system_prompt"]


def seed_prompts_from_json() -> None:
    prompts = _load_json_prompts()
    with get_connection() as conn:
        with conn.cursor() as cur:
            for agent_name, data in prompts.items():
                cur.execute(
                    """
                    INSERT INTO agent_prompts (agent_name, system_prompt, version)
                    VALUES (%s, %s, %s)
                    ON CONFLICT (agent_name) DO NOTHING
                    """,
                    (agent_name, data["system_prompt"], data.get("version", 1)),
                )

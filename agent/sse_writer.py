import json
from db.connection import get_connection


def push_sse_event(run_id: str, event_type: str, payload: dict) -> None:
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO sse_events (run_id, event_type, payload)
                VALUES (%s, %s, %s)
                """,
                (run_id, event_type, json.dumps(payload)),
            )

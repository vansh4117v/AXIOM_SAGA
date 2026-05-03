import json
import asyncio
from uuid import UUID

from fastapi import APIRouter
from sse_starlette.sse import EventSourceResponse

from db.connection import get_connection

router = APIRouter()

MAX_WAIT_SECONDS = 120


async def _event_generator(run_id: str):
    run_uuid = UUID(run_id)
    waited = 0.0
    last_event_id = 0

    while waited < MAX_WAIT_SECONDS:
        with get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT id, event_type, payload
                    FROM sse_events
                    WHERE run_id = %s AND id > %s
                    ORDER BY created_at ASC
                    """,
                    (str(run_uuid), last_event_id),
                )
                rows = cur.fetchall()

                for row in rows:
                    event_id, event_type, payload = row
                    last_event_id = event_id
                    yield {
                        "event": event_type,
                        "data": json.dumps(payload) if isinstance(payload, dict) else payload,
                    }
                    if event_type in ("briefing_ready", "pipeline_failed"):
                        return

        await asyncio.sleep(0.5)
        waited += 0.5

    yield {"event": "timeout", "data": json.dumps({"error": "pipeline timeout after 120s"})}


@router.get("/stream/{run_id}")
async def stream_events(run_id: str):
    return EventSourceResponse(_event_generator(run_id))

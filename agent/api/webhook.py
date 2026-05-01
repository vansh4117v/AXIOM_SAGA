import uuid
import json
import asyncio
from functools import partial

from fastapi import APIRouter

from jira_client import parse_webhook_payload
from models.ticket import TicketDTO
from db.connection import get_connection
from graph import run_sage_pipeline

router = APIRouter()


def _run_pipeline_sync(ticket: TicketDTO, run_id: str) -> None:
    run_sage_pipeline(ticket, run_id)


@router.post("/webhook/jira")
async def jira_webhook(payload: dict):
    ticket = parse_webhook_payload(payload)
    run_id = str(uuid.uuid4())

    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO tickets (ticket_key, jira_issue_id, raw_payload, ticket_dto, status)
                VALUES (%s, %s, %s, %s, 'pending')
                ON CONFLICT (ticket_key) DO UPDATE
                    SET raw_payload = EXCLUDED.raw_payload,
                        ticket_dto = EXCLUDED.ticket_dto,
                        status = 'pending'
                """,
                (
                    ticket.ticket_key,
                    payload.get("issue", {}).get("id", ticket.ticket_key),
                    json.dumps(payload),
                    ticket.model_dump_json(),
                ),
            )

    loop = asyncio.get_running_loop()
    loop.run_in_executor(None, partial(_run_pipeline_sync, ticket, run_id))

    return {"run_id": run_id, "ticket_key": ticket.ticket_key, "status": "processing"}

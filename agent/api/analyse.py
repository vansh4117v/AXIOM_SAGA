import uuid
import json
import asyncio
from functools import partial

from fastapi import APIRouter

from models.ticket import TicketDTO
from db.connection import get_connection
from graph import run_sage_pipeline

router = APIRouter()


def _run_pipeline_sync(ticket: TicketDTO, run_id: str) -> None:
    run_sage_pipeline(ticket, run_id)


@router.post("/analyse")
async def analyse_ticket(ticket: TicketDTO):
    run_id = str(uuid.uuid4())

    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO tickets (ticket_key, jira_issue_id, raw_payload, ticket_dto, status)
                VALUES (%s, %s, %s, %s, 'pending')
                ON CONFLICT (ticket_key) DO UPDATE
                    SET status = 'pending',
                        ticket_dto = EXCLUDED.ticket_dto
                """,
                (
                    ticket.ticket_key,
                    ticket.ticket_id or ticket.ticket_key,
                    json.dumps({}),
                    ticket.model_dump_json(),
                ),
            )

    loop = asyncio.get_running_loop()
    loop.run_in_executor(None, partial(_run_pipeline_sync, ticket, run_id))

    return {"run_id": run_id, "ticket_key": ticket.ticket_key, "status": "processing"}

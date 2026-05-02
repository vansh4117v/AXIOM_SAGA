import json
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from db.connection import get_connection

router = APIRouter()


@router.get("/tickets")
def list_tickets():
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT ticket_key, status, received_at, processed_at,
                       ticket_dto->>'ticket_summary' AS summary
                FROM tickets
                ORDER BY received_at DESC
                LIMIT 50
                """
            )
            rows = cur.fetchall()
    return [
        {
            "ticket_key": r[0],
            "status": r[1],
            "received_at": r[2].isoformat() if r[2] else None,
            "processed_at": r[3].isoformat() if r[3] else None,
            "summary": r[4],
        }
        for r in rows
    ]


@router.get("/briefing/{run_id}")
def get_briefing(run_id: str):
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT briefing, agent_trace, overall_confidence, execution_plan FROM briefings WHERE run_id = %s",
                (run_id,),
            )
            row = cur.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Briefing not found")
    return {
        "briefing": row[0],
        "agent_trace": row[1],
        "overall_confidence": row[2],
        "execution_plan": row[3],
    }


@router.get("/prompts")
def list_prompts():
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT agent_name, system_prompt, version, updated_at FROM agent_prompts ORDER BY agent_name")
            rows = cur.fetchall()
    return [
        {
            "agent_name": r[0],
            "system_prompt": r[1],
            "version": r[2],
            "updated_at": r[3].isoformat() if r[3] else None,
        }
        for r in rows
    ]


class PromptUpdate(BaseModel):
    system_prompt: str


@router.put("/prompts/{agent_name}")
def update_prompt(agent_name: str, body: PromptUpdate):
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                UPDATE agent_prompts
                SET system_prompt = %s, version = version + 1, updated_at = NOW()
                WHERE agent_name = %s
                RETURNING version
                """,
                (body.system_prompt, agent_name),
            )
            row = cur.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail=f"Agent '{agent_name}' not found")
    return {"agent_name": agent_name, "version": row[0], "status": "updated"}

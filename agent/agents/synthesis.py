import json
import re
import time
from datetime import datetime, timezone

from models.scratchpad import AgentScratchpad
from db.connection import get_connection
from gateway_client import notify_gateway
from sse_writer import push_sse_event


def _persist_briefing(state: AgentScratchpad, briefing: dict) -> None:
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO briefings (run_id, ticket_key, scratchpad, briefing, agent_trace, overall_confidence, execution_plan)
                VALUES (%s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (run_id) DO NOTHING
                """,
                (
                    state["run_id"],
                    state["ticket_key"],
                    json.dumps(_safe_serialize(state)),
                    json.dumps(briefing),
                    json.dumps(state.get("agent_trace", [])),
                    briefing.get("overall_confidence", 0.0),
                    state.get("execution_plan", []),
                ),
            )
            cur.execute(
                """
                UPDATE tickets SET status = 'complete', processed_at = NOW()
                WHERE ticket_key = %s
                """,
                (state["ticket_key"],),
            )


def _safe_serialize(state: AgentScratchpad) -> dict:
    safe = {}
    for k, v in state.items():
        try:
            json.dumps(v)
            safe[k] = v
        except (TypeError, ValueError):
            safe[k] = str(v)
    return safe


def run_synthesis(state: AgentScratchpad) -> AgentScratchpad:
    started = time.monotonic()
    run_id = state["run_id"]
    push_sse_event(run_id, "agent_started", {"agent": "synthesis"})

    owner = state.get("primary_owner", {})
    steps = state.get("suggested_steps", [])
    risk_flags = state.get("risk_flags", [])

    steps_text = "\n".join(
        f"{s.get('step_number', i+1)}. {s.get('action', '')}"
        for i, s in enumerate(steps)
    )

    risk_text = "\n".join(
        f"[{r.get('severity', 'medium')}] {r.get('flag', '')}"
        for r in risk_flags
    ) or "No risk flags identified"

    confidence = state.get("context_confidence", 0.0)

    context_summary = state.get("plain_summary", "")
    if not context_summary:
        context_summary = f"{state['ticket_summary']}: {state.get('ticket_description', '')[:200]}"

    briefing = {
        "ticket_key": state["ticket_key"],
        "run_id": run_id,
        "overall_confidence": round(confidence, 2),
        "context_summary": context_summary,
        "owner_summary": f"{owner.get('name', 'unassigned')} ({owner.get('team', '')})",
        "steps_summary": steps_text,
        "risk_summary": risk_text,
        "ask_senior_message": state.get("suggested_question", ""),
        "primary_owner": owner,
        "risk_flags": risk_flags,
        "suggested_steps": steps,
        "overall_risk_level": state.get("overall_risk_level", "low"),
        "execution_plan": state.get("execution_plan", []),
    }

    try:
        _persist_briefing(state, briefing)
    except Exception as e:
        print(f"[synthesis] DB persist failed: {e}")

    ticket_key = state["ticket_key"]
    is_real_jira_key = bool(re.match(r'^[A-Z]+-\d+$', ticket_key))

    if is_real_jira_key:
        push_sse_event(run_id, "jira_write_delegated", {"ticket_key": ticket_key})
    else:
        push_sse_event(run_id, "jira_skipped", {"reason": "manual submission"})

    duration_ms = int((time.monotonic() - started) * 1000)

    state["briefing"] = briefing
    state["overall_confidence"] = confidence
    state["jira_comment_body"] = f"SAGE Briefing: {context_summary}"
    state["agent_trace"].append({
        "agent": "synthesis",
        "started_at": datetime.now(timezone.utc).isoformat(),
        "duration_ms": duration_ms,
        "tools_called": [],
        "confidence": confidence,
        "decision_made": f"briefing assembled, confidence={confidence:.2f}",
        "reasoning": f"risk_level={state.get('overall_risk_level', 'low')}",
    })

    try:
        notify_gateway(
            ticket_key=state["ticket_key"],
            run_id=run_id,
            status="complete",
            briefing=briefing,
            agent_trace=state.get("agent_trace", []),
            scratchpad=_safe_serialize(state),
            skip_jira_write=not is_real_jira_key,
        )
    except Exception as e:
        print(f"[synthesis] Gateway callback failed: {e}")

    push_sse_event(run_id, "briefing_ready", {
        "briefing": briefing,
        "trace": state.get("agent_trace", [])
    })
    return state

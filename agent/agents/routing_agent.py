import json
import time
from datetime import datetime, timezone

from groq import Groq

from models.scratchpad import AgentScratchpad
from prompt_loader import load_prompt
from sse_writer import push_sse_event
from tools.registry_tools import get_team_registry

_client = None


def _get_client():
    global _client
    if _client is None:
        _client = Groq()
    return _client


def _fallback_result(reason: str = "No matching team member found in registry") -> dict:
    return {
        "primary_owner": {
            "name": "Unassigned",
            "role": "N/A",
            "team": "N/A",
            "github_handle": "",
            "match_reason": reason,
        },
        "escalation_path": [],
        "suggested_question": reason,
    }


def _is_real_owner(owner: dict) -> bool:
    return bool(
        owner
        and owner.get("name")
        and owner.get("name") != "Unassigned"
        and owner.get("team") != "N/A"
    )


def run_routing_agent(state: AgentScratchpad) -> AgentScratchpad:
    started = time.monotonic()
    run_id = state["run_id"]
    push_sse_event(run_id, "agent_started", {"agent": "routing_agent"})

    file_paths = [f["path"] for f in state.get("relevant_files", [])]
    tools_called = []
    try:
        team_registry = get_team_registry()
        tools_called.append({"tool": "get_team_registry", "input": {}})
        push_sse_event(run_id, "tool_called", {"agent": "routing_agent", "tool": "get_team_registry"})
    except Exception as e:
        print(f"[routing_agent] registry lookup failed: {e}")
        team_registry = []

    user_prompt = (
        f"Ticket: {state['ticket_key']}\n"
        f"Summary: {state['ticket_summary']}\n"
        f"Domain: {state.get('classification', {}).get('domain', 'unknown')}\n"
        f"Relevant files: {file_paths}\n"
        f"Priority: {state['ticket_priority']}\n"
        f"Team registry JSON: {json.dumps(team_registry, default=str)}"
    )

    messages = [
        {"role": "system", "content": load_prompt("routing_agent")},
        {"role": "user", "content": user_prompt},
    ]

    try:
        response = _get_client().chat.completions.create(
            model="llama-3.1-8b-instant",
            max_tokens=1500,
            messages=messages,
        )
        choice = response.choices[0]
    except Exception as e:
        print(f"[routing_agent] completion failed: {e}")
        choice = None

    raw = choice.message.content or "" if choice else ""

    if raw.startswith("```"):
        raw = raw.split("```")[1]
        if raw.startswith("json"):
            raw = raw[4:]

    try:
        result = json.loads(raw.strip())
    except json.JSONDecodeError as e:
        print(f"routing_agent JSON parse failed: {e}, raw={raw[:200]}")
        result = _fallback_result("Routing model did not return valid JSON")

    duration_ms = int((time.monotonic() - started) * 1000)

    state["primary_owner"] = result.get("primary_owner", {})
    state["escalation_path"] = result.get("escalation_path", [])
    state["suggested_question"] = result.get("suggested_question", "")
    state["routing_confidence"] = 1.0 if _is_real_owner(state["primary_owner"]) else 0.0
    state["agent_trace"].append({
        "agent": "routing_agent",
        "started_at": datetime.now(timezone.utc).isoformat(),
        "duration_ms": duration_ms,
        "tools_called": tools_called,
        "confidence": state["routing_confidence"],
        "decision_made": f"owner={state['primary_owner'].get('name', 'unknown')}",
        "reasoning": state["primary_owner"].get("match_reason", ""),
    })

    push_sse_event(run_id, "agent_complete", {
        "agent": "routing_agent",
        "duration_ms": duration_ms,
        "decision": f"routed to {state['primary_owner'].get('name', 'unknown')}",
    })
    return state

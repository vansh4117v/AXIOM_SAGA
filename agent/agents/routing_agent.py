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

TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "get_team_registry",
            "description": "Fetch the full team registry with members, roles, owned paths, and domains.",
            "parameters": {
                "type": "object",
                "properties": {},
                "required": [],
            },
        },
    },
]


def _dispatch_tool(name: str, inputs: dict) -> str:
    if name == "get_team_registry":
        return str(get_team_registry())
    return f"unknown tool: {name}"


def run_routing_agent(state: AgentScratchpad) -> AgentScratchpad:
    started = time.monotonic()
    run_id = state["run_id"]
    push_sse_event(run_id, "agent_started", {"agent": "routing_agent"})

    file_paths = [f["path"] for f in state.get("relevant_files", [])]
    user_prompt = (
        f"Ticket: {state['ticket_key']}\n"
        f"Summary: {state['ticket_summary']}\n"
        f"Domain: {state.get('classification', {}).get('domain', 'unknown')}\n"
        f"Relevant files: {file_paths}\n"
        f"Priority: {state['ticket_priority']}"
    )

    messages = [
        {"role": "system", "content": load_prompt("routing_agent")},
        {"role": "user", "content": user_prompt},
    ]
    tools_called = []

    while True:
        response = _get_client().chat.completions.create(
            model="llama-3.1-8b-instant",
            max_tokens=1500,
            tools=TOOLS,
            messages=messages,
        )

        choice = response.choices[0]

        if choice.finish_reason == "stop":
            break

        if choice.finish_reason == "tool_calls":
            messages.append(choice.message)
            for tc in choice.message.tool_calls:
                args = json.loads(tc.function.arguments) if tc.function.arguments else {}
                result_str = _dispatch_tool(tc.function.name, args)
                tools_called.append({"tool": tc.function.name, "input": args})
                push_sse_event(run_id, "tool_called", {"agent": "routing_agent", "tool": tc.function.name})
                messages.append({
                    "role": "tool",
                    "tool_call_id": tc.id,
                    "content": result_str,
                })

    raw = choice.message.content or ""

    if raw.startswith("```"):
        raw = raw.split("```")[1]
        if raw.startswith("json"):
            raw = raw[4:]

    try:
        result = json.loads(raw.strip())
    except json.JSONDecodeError as e:
        print(f"routing_agent JSON parse failed: {e}, raw={raw[:200]}")
        result = {"primary_owner": {}, "escalation_path": [], "suggested_question": ""}

    duration_ms = int((time.monotonic() - started) * 1000)

    state["primary_owner"] = result.get("primary_owner", {})
    state["escalation_path"] = result.get("escalation_path", [])
    state["suggested_question"] = result.get("suggested_question", "")
    state["routing_confidence"] = 1.0 if state["primary_owner"].get("name") else 0.0
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

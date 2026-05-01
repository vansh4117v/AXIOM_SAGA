import json
import time
from datetime import datetime, timezone

import openai

from models.scratchpad import AgentScratchpad
from prompt_loader import load_prompt
from sse_writer import push_sse_event
from tools.registry_tools import search_closed_tickets

_client = None


def _get_client():
    global _client
    if _client is None:
        _client = openai.OpenAI()
    return _client

TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "search_closed_tickets",
            "description": "Search closed Jira tickets by keywords to find similar past issues.",
            "parameters": {
                "type": "object",
                "properties": {
                    "keywords": {"type": "array", "items": {"type": "string"}}
                },
                "required": ["keywords"],
            },
        },
    },
]


def _dispatch_tool(name: str, inputs: dict) -> str:
    if name == "search_closed_tickets":
        return str(search_closed_tickets(inputs["keywords"]))
    return f"unknown tool: {name}"


def run_risk_agent(state: AgentScratchpad) -> AgentScratchpad:
    started = time.monotonic()
    run_id = state["run_id"]
    push_sse_event(run_id, "agent_started", {"agent": "risk_agent"})

    files_summary = ", ".join(f["path"] for f in state.get("relevant_files", [])[:5])
    user_prompt = (
        f"Ticket: {state['ticket_key']}\n"
        f"Summary: {state['ticket_summary']}\n"
        f"Description: {state['ticket_description']}\n"
        f"Priority: {state['ticket_priority']}\n"
        f"Classification: {state.get('classification', {})}\n"
        f"Relevant files: {files_summary}"
    )

    messages = [
        {"role": "system", "content": load_prompt("risk_agent")},
        {"role": "user", "content": user_prompt},
    ]
    tools_called = []

    while True:
        response = _get_client().chat.completions.create(
            model="gpt-4o-mini",
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
                args = json.loads(tc.function.arguments)
                result_str = _dispatch_tool(tc.function.name, args)
                tools_called.append({"tool": tc.function.name, "input": args})
                push_sse_event(run_id, "tool_called", {"agent": "risk_agent", "tool": tc.function.name})
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
        print(f"risk_agent JSON parse failed: {e}, raw={raw[:200]}")
        result = {"risk_flags": [], "open_related_bugs": [], "overall_risk_level": "medium"}

    duration_ms = int((time.monotonic() - started) * 1000)

    state["risk_flags"] = result.get("risk_flags", [])
    state["open_related_bugs"] = result.get("open_related_bugs", [])
    state["overall_risk_level"] = result.get("overall_risk_level", "medium")
    state["historical_incidents"] = result.get("open_related_bugs", [])
    state["agent_trace"].append({
        "agent": "risk_agent",
        "started_at": datetime.now(timezone.utc).isoformat(),
        "duration_ms": duration_ms,
        "tools_called": tools_called,
        "confidence": None,
        "decision_made": f"risk_level={state['overall_risk_level']}, {len(state['risk_flags'])} flags",
        "reasoning": f"found {len(state['open_related_bugs'])} related bugs",
    })

    push_sse_event(run_id, "agent_complete", {
        "agent": "risk_agent",
        "duration_ms": duration_ms,
        "decision": f"risk={state['overall_risk_level']}",
    })
    return state

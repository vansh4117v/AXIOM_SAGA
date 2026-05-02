import json
import time
from datetime import datetime, timezone

from groq import Groq

from models.scratchpad import AgentScratchpad
from prompt_loader import load_prompt
from sse_writer import push_sse_event

_client = None


def _get_client():
    global _client
    if _client is None:
        _client = Groq()
    return _client


def run_explainer_agent(state: AgentScratchpad) -> AgentScratchpad:
    started = time.monotonic()
    run_id = state["run_id"]
    push_sse_event(run_id, "agent_started", {"agent": "explainer_agent"})

    files_summary = "\n".join(
        f"- {f['path']}: {f.get('snippet', '')[:800]}"
        for f in state.get("relevant_files", [])[:3]
    )

    user_prompt = (
        f"Ticket: {state['ticket_key']}\n"
        f"Summary: {state['ticket_summary']}\n"
        f"Description: {state['ticket_description']}\n"
        f"Priority: {state['ticket_priority']}\n"
        f"Classification: {state.get('classification', {})}\n"
        f"Relevant files:\n{files_summary}"
    )

    response = _get_client().chat.completions.create(
        model="llama-3.3-70b-versatile",
        max_tokens=1500,
        messages=[
            {"role": "system", "content": load_prompt("explainer_agent")},
            {"role": "user", "content": user_prompt},
        ],
    )

    raw = response.choices[0].message.content.strip()
    if raw.startswith("```"):
        raw = raw.split("```")[1]
        if raw.startswith("json"):
            raw = raw[4:]

    try:
        result = json.loads(raw.strip())
    except json.JSONDecodeError as e:
        print(f"explainer_agent JSON parse failed: {e}, raw={raw[:200]}")
        result = {"plain_summary": "", "suggested_steps": []}

    duration_ms = int((time.monotonic() - started) * 1000)

    state["plain_summary"] = result.get("plain_summary", "")
    state["suggested_steps"] = result.get("suggested_steps", [])
    state["audience_level"] = result.get("audience_level", "junior")
    state["key_concepts"] = result.get("key_concepts", [])
    state["agent_trace"].append({
        "agent": "explainer_agent",
        "started_at": datetime.now(timezone.utc).isoformat(),
        "duration_ms": duration_ms,
        "tools_called": [],
        "confidence": None,
        "decision_made": f"{len(state['suggested_steps'])} steps generated",
        "reasoning": "pure generation, no tools",
    })

    push_sse_event(run_id, "agent_complete", {
        "agent": "explainer_agent",
        "duration_ms": duration_ms,
        "decision": f"{len(state['suggested_steps'])} steps",
    })
    return state

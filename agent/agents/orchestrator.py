import json
import time
from datetime import datetime, timezone

import openai

from models.scratchpad import AgentScratchpad
from prompt_loader import load_prompt
from sse_writer import push_sse_event

_client = None


def _get_client():
    global _client
    if _client is None:
        _client = openai.OpenAI()
    return _client


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def classify_and_plan(state: AgentScratchpad) -> AgentScratchpad:
    started = time.monotonic()

    prompt = (
        f"Ticket key: {state['ticket_key']}\n"
        f"Summary: {state['ticket_summary']}\n"
        f"Description: {state['ticket_description']}\n"
        f"Priority: {state['ticket_priority']}\n"
        f"Labels: {state['ticket_labels']}\n"
        f"Components: {state['ticket_components']}\n"
        f"Type: {state['ticket_type']}"
    )

    response = _get_client().chat.completions.create(
        model="gpt-4o-mini",
        max_tokens=512,
        messages=[
            {"role": "system", "content": load_prompt("orchestrator")},
            {"role": "user", "content": prompt},
        ],
    )

    raw = response.choices[0].message.content.strip()
    if raw.startswith("```"):
        raw = raw.split("```")[1]
        if raw.startswith("json"):
            raw = raw[4:]
    classification = json.loads(raw.strip())

    if classification.get("is_production") or classification["severity"] == "P0":
        plan = ["risk_agent", "context_agent", "routing_agent"]
        reasoning = "P0 or production: risk first, explainer skipped for urgency"
        path = "risk_first"
    elif classification["estimated_complexity"] == "low":
        plan = ["context_agent", "routing_agent", "explainer_agent"]
        reasoning = "Low complexity: risk agent skipped"
        path = "low_complexity"
    else:
        plan = ["context_agent", "routing_agent", "explainer_agent", "risk_agent"]
        reasoning = "Standard path: full analysis pipeline"
        path = "default"

    duration_ms = int((time.monotonic() - started) * 1000)

    state["classification"] = classification
    state["execution_plan"] = plan
    state["plan_reasoning"] = reasoning
    state["execution_path"] = path
    state["agent_trace"].append(
        {
            "agent": "orchestrator",
            "started_at": _now_iso(),
            "duration_ms": duration_ms,
            "tools_called": [],
            "confidence": None,
            "decision_made": f"plan={plan}",
            "reasoning": reasoning,
        }
    )

    push_sse_event(
        state["run_id"],
        "plan_ready",
        {"plan": plan, "reasoning": reasoning, "classification": classification},
    )
    return state


def should_run_risk_first(state: AgentScratchpad) -> str:
    if state.get("execution_plan", [])[0] == "risk_agent":
        return "risk_agent"
    return "context_agent"


def should_retry_context(state: AgentScratchpad) -> str:
    below_threshold = state.get("context_confidence", 0.0) < 0.60
    under_retry_limit = state.get("context_retry_count", 0) < 2
    if below_threshold and under_retry_limit:
        return "context_agent"
    return "routing_check"


def should_run_routing(state: AgentScratchpad) -> str:
    if "routing_agent" in state.get("execution_plan", []):
        return "routing_agent"
    return "explainer_check"


def should_run_explainer(state: AgentScratchpad) -> str:
    if "explainer_agent" in state.get("execution_plan", []):
        return "explainer_agent"
    return "risk_late_check"


def should_run_risk_late(state: AgentScratchpad) -> str:
    plan = state.get("execution_plan", [])
    already_ran = state.get("execution_path", "") == "risk_first"
    if "risk_agent" in plan and not already_ran:
        return "risk_agent_late"
    return "synthesis"

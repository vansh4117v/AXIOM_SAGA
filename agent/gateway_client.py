import os

import requests


def notify_gateway(
    ticket_key: str,
    run_id: str,
    status: str,
    briefing: dict | None = None,
    agent_trace: list | None = None,
    scratchpad: dict | None = None,
) -> None:
    gateway_url = os.environ.get("GATEWAY_URL") or os.environ.get("SAGE_GATEWAY_URL")
    callback_url = os.environ.get("GATEWAY_BRIEFING_CALLBACK_URL")

    if not callback_url:
        if not gateway_url:
            return
        callback_url = f"{gateway_url.rstrip('/')}/callback/briefing"

    payload = {
        "ticket_key": ticket_key,
        "run_id": run_id,
        "status": status,
        "skip_jira_write": True,
    }

    if briefing is not None:
        payload["briefing"] = briefing
        payload["overall_confidence"] = briefing.get("overall_confidence")
        payload["execution_plan"] = briefing.get("execution_plan", [])

    if agent_trace is not None:
        payload["agent_trace"] = agent_trace

    if scratchpad is not None:
        payload["scratchpad"] = scratchpad

    requests.post(callback_url, json=payload, timeout=10).raise_for_status()

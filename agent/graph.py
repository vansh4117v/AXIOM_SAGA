import json
import concurrent.futures
from langgraph.graph import StateGraph, END

from models.scratchpad import AgentScratchpad
from models.ticket import TicketDTO
from agents.orchestrator import (
    classify_and_plan,
    should_run_risk_first,
    should_retry_context,
    should_run_routing,
    should_run_explainer,
    should_run_risk_late,
)
from agents.embed_guard import ensure_repos_embedded
from agents.context_agent import run_context_agent
from agents.routing_agent import run_routing_agent
from agents.explainer_agent import run_explainer_agent
from agents.risk_agent import run_risk_agent
from agents.synthesis import run_synthesis
from db.connection import get_connection
from sse_writer import push_sse_event

PIPELINE_TIMEOUT_SECONDS = 120


def build_graph():
    graph = StateGraph(AgentScratchpad)

    graph.add_node("ensure_embeddings", ensure_repos_embedded)
    graph.add_node("orchestrator", classify_and_plan)
    graph.add_node("context_agent", run_context_agent)
    graph.add_node("routing_agent", run_routing_agent)
    graph.add_node("explainer_agent", run_explainer_agent)
    graph.add_node("risk_agent", run_risk_agent)
    graph.add_node("risk_agent_late", run_risk_agent)
    graph.add_node("synthesis", run_synthesis)
    graph.add_node("routing_check", lambda s: s)
    graph.add_node("explainer_check", lambda s: s)
    graph.add_node("risk_late_check", lambda s: s)

    graph.set_entry_point("ensure_embeddings")
    graph.add_edge("ensure_embeddings", "orchestrator")

    graph.add_conditional_edges(
        "orchestrator",
        should_run_risk_first,
        {"risk_agent": "risk_agent", "context_agent": "context_agent"},
    )

    graph.add_edge("risk_agent", "context_agent")

    graph.add_conditional_edges(
        "context_agent",
        should_retry_context,
        {"context_agent": "context_agent", "routing_check": "routing_check"},
    )

    graph.add_conditional_edges(
        "routing_check",
        should_run_routing,
        {"routing_agent": "routing_agent", "explainer_check": "explainer_check"},
    )

    graph.add_edge("routing_agent", "explainer_check")

    graph.add_conditional_edges(
        "explainer_check",
        should_run_explainer,
        {"explainer_agent": "explainer_agent", "risk_late_check": "risk_late_check"},
    )

    graph.add_edge("explainer_agent", "risk_late_check")

    graph.add_conditional_edges(
        "risk_late_check",
        should_run_risk_late,
        {"risk_agent_late": "risk_agent_late", "synthesis": "synthesis"},
    )

    graph.add_edge("risk_agent_late", "synthesis")
    graph.add_edge("synthesis", END)

    return graph.compile()


_compiled_graph = None


def get_graph():
    global _compiled_graph
    if _compiled_graph is None:
        _compiled_graph = build_graph()
    return _compiled_graph


def run_sage_pipeline(ticket: TicketDTO, run_id: str) -> dict:
    push_sse_event(run_id, "pipeline_started", {"ticket_key": ticket.ticket_key})

    initial_state: AgentScratchpad = {
        "ticket_key": ticket.ticket_key,
        "ticket_summary": ticket.ticket_summary,
        "ticket_description": ticket.ticket_description,
        "ticket_priority": ticket.ticket_priority,
        "ticket_labels": ticket.ticket_labels,
        "ticket_components": ticket.ticket_components,
        "ticket_type": ticket.ticket_type,
        "run_id": run_id,
        "agent_trace": [],
        "execution_plan": [],
        "relevant_files": [],
        "related_prs": [],
        "related_tickets": [],
        "risk_flags": [],
        "open_related_bugs": [],
        "suggested_steps": [],
        "escalation_path": [],
        "context_confidence": 0.0,
        "context_retry_count": 0,
        "execution_path": "",
    }

    graph = get_graph()
    try:
        with concurrent.futures.ThreadPoolExecutor(max_workers=1) as executor:
            future = executor.submit(graph.invoke, initial_state)
            result = future.result(timeout=PIPELINE_TIMEOUT_SECONDS)
    except concurrent.futures.TimeoutError:
        print(f"[pipeline] TIMEOUT after {PIPELINE_TIMEOUT_SECONDS}s")
        push_sse_event(run_id, "pipeline_failed", {"error": f"Pipeline timeout after {PIPELINE_TIMEOUT_SECONDS}s"})
        with get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "UPDATE tickets SET status = 'timeout' WHERE ticket_key = %s",
                    (ticket.ticket_key,),
                )
        return initial_state
    except Exception as e:
        print(f"[pipeline] FATAL: {e}")
        push_sse_event(run_id, "pipeline_failed", {"error": str(e)})
        with get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "UPDATE tickets SET status = 'failed' WHERE ticket_key = %s",
                    (ticket.ticket_key,),
                )
        raise
    return result


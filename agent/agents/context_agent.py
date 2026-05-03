import json
import time
from datetime import datetime, timezone

from groq import Groq
from tenacity import retry, stop_after_attempt, wait_exponential, retry_if_exception_type

from models.scratchpad import AgentScratchpad
from prompt_loader import load_prompt
from sse_writer import push_sse_event
from tools.vector_tools import search_codebase
from tools.github_tools import get_file_content, get_recent_prs_for_file, validate_file_paths
from tools.registry_tools import search_closed_tickets

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
            "name": "search_codebase",
            "description": "Semantic search over embedded codebase files using pgvector.",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {"type": "string"},
                    "top_k": {"type": "integer", "default": 5},
                },
                "required": ["query"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_file_content",
            "description": "Get actual content of a specific file from GitHub.",
            "parameters": {
                "type": "object",
                "properties": {"file_path": {"type": "string"}},
                "required": ["file_path"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_recent_prs_for_file",
            "description": "Get recent pull requests that touched a specific file path.",
            "parameters": {
                "type": "object",
                "properties": {
                    "file_path": {"type": "string"},
                    "limit": {"type": "integer", "default": 5},
                },
                "required": ["file_path"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "search_closed_tickets",
            "description": "Search closed Jira tickets similar to the current one.",
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
    if name == "search_codebase":
        result = search_codebase(inputs["query"], inputs.get("top_k", 5))
        result = validate_file_paths(result)
        return json.dumps(result)
    if name == "get_file_content":
        result = get_file_content(inputs["file_path"])
        return json.dumps(result) if isinstance(result, (dict, list)) else str(result)
    if name == "get_recent_prs_for_file":
        result = get_recent_prs_for_file(inputs["file_path"], inputs.get("limit", 5))
        return json.dumps(result)
    if name == "search_closed_tickets":
        result = search_closed_tickets(inputs["keywords"])
        return json.dumps(result)
    return f"unknown tool: {name}"


def _build_user_prompt(state: AgentScratchpad) -> str:
    return (
        f"Ticket: {state['ticket_key']}\n"
        f"Summary: {state['ticket_summary']}\n"
        f"Description: {state['ticket_description']}\n"
        f"Priority: {state['ticket_priority']}\n"
        f"Labels: {state['ticket_labels']}\n"
        f"Classification: {state.get('classification', {})}"
    )


def _compute_retrieval_confidence(files: list[dict]) -> float:
    if not files:
        return 0.0
    scores = [f.get("similarity_score", 0.0) for f in files]
    return round(sum(scores) / len(scores), 2)


@retry(
    retry=retry_if_exception_type(Exception),
    wait=wait_exponential(min=1, max=10),
    stop=stop_after_attempt(3),
)
def run_context_agent(state: AgentScratchpad) -> AgentScratchpad:
    started = time.monotonic()
    run_id = state["run_id"]

    push_sse_event(run_id, "agent_started", {"agent": "context_agent", "tools_available": [t["function"]["name"] for t in TOOLS]})

    messages = [
        {"role": "system", "content": load_prompt("context_agent")},
        {"role": "user", "content": _build_user_prompt(state)},
    ]
    tools_called = []
    all_files: list[dict] = []
    all_prs: list[dict] = []
    all_related_tickets: list[dict] = []

    try:
        while True:
            response = _get_client().chat.completions.create(
                model="llama-3.1-8b-instant",
                max_tokens=2000,
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

                    push_sse_event(run_id, "tool_called", {
                        "agent": "context_agent",
                        "tool": tc.function.name,
                        "input_summary": str(args)[:200],
                    })

                    if tc.function.name == "search_codebase":
                        try:
                            all_files.extend(json.loads(result_str))
                        except Exception:
                            pass
                    elif tc.function.name == "get_recent_prs_for_file":
                        try:
                            all_prs.extend(json.loads(result_str))
                        except Exception:
                            pass
                    elif tc.function.name == "search_closed_tickets":
                        try:
                            all_related_tickets.extend(json.loads(result_str))
                        except Exception:
                            pass

                    messages.append({
                        "role": "tool",
                        "tool_call_id": tc.id,
                        "content": result_str,
                    })
    except Exception as e:
        print(f"[context_agent] tool call failed ({e}), continuing with fallback")

    # Hard fallback: if LLM stopped without calling any tools, force one search
    if not tools_called:
        fallback_query = state.get("ticket_summary", "")[:100]
        push_sse_event(run_id, "tool_called", {
            "agent": "context_agent",
            "tool": "search_codebase",
            "input_summary": f"(fallback) {fallback_query}",
        })
        try:
            fallback_results = search_codebase(fallback_query, top_k=5)
            fallback_results = validate_file_paths(fallback_results)
            all_files.extend(fallback_results)
            tools_called.append({
                "tool": "search_codebase",
                "input": {"query": fallback_query},
                "fallback": True
            })
        except Exception as e:
            print(f"[context_agent] fallback search failed: {e}")

    seen_paths = set()
    unique_files = []
    for f in all_files:
        if f["path"] not in seen_paths:
            seen_paths.add(f["path"])
            unique_files.append(f)

    confidence = _compute_retrieval_confidence(unique_files)
    duration_ms = int((time.monotonic() - started) * 1000)

    state["relevant_files"] = unique_files
    state["related_prs"] = all_prs
    state["related_tickets"] = all_related_tickets
    state["context_confidence"] = confidence
    retry_count = state.get("context_retry_count", 0) + 1
    state["context_retry_count"] = retry_count

    # If no files found at all, force confidence above threshold to prevent
    # useless retries (embeddings are simply missing or query has no matches)
    if len(unique_files) == 0 and retry_count >= 1:
        state["context_confidence"] = 0.99

    reasoning = f"retry_count={retry_count}"
    if len(unique_files) == 0:
        reasoning += ", no embeddings matched - skipping further retries"

    state["agent_trace"].append({
        "agent": "context_agent",
        "started_at": datetime.now(timezone.utc).isoformat(),
        "duration_ms": duration_ms,
        "tools_called": tools_called,
        "confidence": confidence if unique_files else 0.0,
        "decision_made": f"found {len(unique_files)} files, confidence={confidence}",
        "reasoning": reasoning,
    })

    push_sse_event(run_id, "agent_complete", {
        "agent": "context_agent",
        "duration_ms": duration_ms,
        "confidence": confidence,
        "decision": f"{len(unique_files)} files retrieved",
    })
    return state

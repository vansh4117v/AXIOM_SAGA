# SAGE — Master Build Context File
## Situational Awareness & Guidance Engine
### Veersa Hackathon 2027 | Use this file as persistent context in every AI coding session

---

## HOW TO USE THIS FILE

Paste this entire file at the start of every Claude session. Then say exactly what you need:

> "I am building SAGE. Full spec is above. I am Person [A/B/C]. Now build [exact file path from Section 3 of spec]. Do not deviate from schemas in Section 4. Do not invent new fields or endpoints."

**One file. One source of truth. Every session starts here.**

---

## SECTION 1 — WHAT SAGE IS (30-second pitch for any judge)

SAGE is a **Jira-integrated multi-agent AI system** that intercepts tickets at creation via polling, builds a **Situational Briefing** by reasoning across live codebase context, team knowledge graphs, and historical risk signals — then delivers that intelligence as a structured comment back into the Jira ticket and on a live React dashboard.

**It does not process tickets. It reasons about them.**

Two tickets that look superficially similar produce **different agent execution paths, different tool call sequences, and different outputs** — because the Orchestrator reads ticket signals and builds a runtime plan, not a fixed pipeline. This branching is visible, traceable, and explainable.

**One-line pitch:** SAGE turns the 3-hour "who do I ask and what do I do" delay that every junior engineer faces into a 30-second briefing delivered where they already work — inside Jira.

---

## SECTION 2 — ARCHITECTURE (memorize this before any presentation)

```
Jira Cloud (polling every 60s)
    → Node.js Gateway (normalise → TicketDTO → deduplicate)
        → FastAPI AI Engine (LangGraph orchestration)
            → Orchestrator Agent (classify + build runtime plan)
                → Context Agent    (pgvector + GitHub API)
                → Routing Agent    (team registry JSON)
                → Explainer Agent  (plain language + steps)
                → Risk Agent       (open bugs + history)
            → Synthesis (assemble briefing + ask-senior message)
        → Azure PostgreSQL (persist briefing + trace)
        → Jira API (write structured comment back to ticket)
    → React Dashboard (live SSE stream of agent events)
```

**Stack decisions (justify these to judges):**
- **LangGraph over raw loops** — conditional edges are first-class citizens, graph is inspectable, retry logic is a single edge not a while loop
- **Node.js gateway + FastAPI AI engine** — Node handles I/O-bound Jira polling/auth; FastAPI handles CPU-bound LLM inference. Scale independently.
- **pgvector on Azure PostgreSQL** — no separate vector DB to manage, same connection pool as relational data, cosine similarity built in
- **SSE over WebSockets** — one-directional server push is enough, no auth complexity, works through proxies
- **Scratchpad TypedDict** — single immutable contract. Every agent reads and writes only its designated fields. No hidden state.
- **prompts.json** — all prompts externalized. Hackathon requirement met. Editable via Prompt Studio UI without code changes.

---

## SECTION 3 — REPOSITORY STRUCTURE (exact file paths — do not deviate)

```
sage/
├── frontend/                          # Person A
│   ├── src/
│   │   ├── components/
│   │   │   ├── TicketQueue.jsx
│   │   │   ├── BriefingPanel.jsx
│   │   │   ├── AgentTrace.jsx
│   │   │   ├── PromptStudio.jsx
│   │   │   ├── ConfidenceBadge.jsx
│   │   │   └── CompareView.jsx
│   │   ├── hooks/
│   │   │   └── useSSE.js
│   │   ├── api/
│   │   │   └── client.js
│   │   └── App.jsx
│   ├── .env.example
│   └── package.json
│
├── gateway/                           # Person B
│   ├── src/
│   │   ├── routes/
│   │   │   ├── tickets.js
│   │   │   ├── auth.js
│   │   │   └── prompts.js
│   │   ├── services/
│   │   │   ├── jiraPoller.js
│   │   │   ├── jiraNormaliser.js
│   │   │   ├── deduplicator.js
│   │   │   └── jiraWriter.js
│   │   ├── middleware/
│   │   │   └── auth.js
│   │   └── index.js
│   ├── .env.example
│   └── package.json
│
├── ai_engine/                         # Person C
│   ├── agents/
│   │   ├── orchestrator.py
│   │   ├── context_agent.py
│   │   ├── routing_agent.py
│   │   ├── explainer_agent.py
│   │   ├── risk_agent.py
│   │   └── synthesis.py
│   ├── tools/
│   │   ├── github_tools.py
│   │   ├── vector_tools.py
│   │   └── registry_tools.py
│   ├── models/
│   │   ├── scratchpad.py
│   │   └── briefing.py
│   ├── api/
│   │   └── routes.py
│   ├── db/
│   │   ├── connection.py
│   │   ├── embeddings.py
│   │   └── migrations/
│   │       └── 001_init.sql
│   ├── config/
│   │   └── prompts.json
│   ├── tests/
│   │   ├── test_orchestrator.py
│   │   ├── test_context_agent.py
│   │   └── sage_api.postman_collection.json
│   ├── .env.example
│   └── requirements.txt
│
├── .github/workflows/deploy.yml
├── docker-compose.yml
├── DECISIONS.md
├── architecture.png
└── README.md
```

---

## SECTION 4 — THE SCRATCHPAD (single source of truth — every agent uses this exact schema)

```python
# ai_engine/models/scratchpad.py
from typing import TypedDict, Optional

class AgentScratchpad(TypedDict):
    # Input (set by gateway, never mutated)
    ticket_id: str
    ticket_key: str
    ticket_summary: str
    ticket_description: str
    ticket_priority: str           # "High" | "Medium" | "Low" | "Critical"
    ticket_labels: list
    ticket_components: list
    ticket_assignee: dict          # {name, email, jira_account_id}
    ticket_reporter: dict
    ticket_created: str            # ISO timestamp
    ticket_type: str               # "Bug" | "Story" | "Task"

    # Orchestrator writes
    classification: dict
    # {severity: "P0"|"P1"|"P2", domain: str, is_production: bool,
    #  has_clear_assignee: bool, estimated_complexity: "low"|"medium"|"high",
    #  reasoning: str}
    execution_plan: list           # e.g. ["risk", "context", "routing"]
    plan_reasoning: str

    # Context Agent writes
    relevant_files: list
    # [{path, snippet, similarity_score, last_author, last_modified,
    #   source: "pgvector"|"github_search"}]
    related_prs: list
    # [{pr_number, title, author, merged_at, files_changed, pr_url}]
    related_tickets: list
    # [{key, summary, status, resolution}]
    context_confidence: float      # mean(similarity_scores) — NOT from LLM
    context_retry_count: int

    # Routing Agent writes
    primary_owner: dict
    # {name, role, team, github_handle, match_reason}
    escalation_path: list
    routing_confidence: float
    suggested_question: str        # complete ready-to-send message for junior

    # Explainer Agent writes
    plain_summary: str
    suggested_steps: list
    # [{step_number, action, rationale, estimated_effort_hours}]
    audience_level: str            # "intern" | "junior"
    key_concepts: list

    # Risk Agent writes
    risk_flags: list
    # [{flag, severity: "critical"|"high"|"medium", evidence, recommendation}]
    open_related_bugs: list
    historical_incidents: list
    overall_risk_level: str        # "critical"|"high"|"medium"|"low"

    # Synthesis writes
    briefing: dict
    ask_senior_message: str
    jira_comment_body: str
    overall_confidence: float

    # System fields
    agent_trace: list
    # [{agent, started_at, completed_at, duration_ms, tools_called,
    #   confidence, decision_made, reasoning}]
    sse_events: list
    run_id: str
    processing_status: str         # "running"|"complete"|"failed"
    error: Optional[str]
```

---

## SECTION 5 — LANGGRAPH ORCHESTRATOR (the proof of agency)

```python
# ai_engine/agents/orchestrator.py
from langgraph.graph import StateGraph, END
from models.scratchpad import AgentScratchpad

def classify_and_plan(state: AgentScratchpad) -> AgentScratchpad:
    classification = call_llm_classify(state)  # returns dict from prompts.json
    plan = []

    if classification["severity"] == "P0" or classification["is_production"]:
        plan = ["risk", "context", "routing"]
        reasoning = "P0/production — risk first, explainer skipped for urgency"
    elif classification["estimated_complexity"] == "low":
        plan = ["context", "routing", "explainer"]
        reasoning = "Low complexity — risk agent skipped"
    else:
        plan = ["context", "routing", "explainer", "risk"]
        reasoning = "Standard ticket — full pipeline"

    state["classification"] = classification
    state["execution_plan"] = plan
    state["plan_reasoning"] = reasoning
    state["agent_trace"].append({
        "agent": "orchestrator",
        "decision_made": f"plan: {plan}",
        "reasoning": reasoning
    })
    return state

def should_run_risk_first(state): 
    return "risk_agent" if state["execution_plan"][0] == "risk" else "context_agent"

def should_retry_context(state):
    if state["context_confidence"] < 0.60 and state["context_retry_count"] < 2:
        return "context_agent"
    return "routing_agent"

def should_run_explainer(state):
    return "synthesis" if "explainer" not in state["execution_plan"] else "explainer_agent"

def build_sage_graph():
    graph = StateGraph(AgentScratchpad)
    graph.add_node("orchestrator", classify_and_plan)
    graph.add_node("context_agent", run_context_agent)
    graph.add_node("routing_agent", run_routing_agent)
    graph.add_node("explainer_agent", run_explainer_agent)
    graph.add_node("risk_agent", run_risk_agent)
    graph.add_node("synthesis", run_synthesis)

    graph.set_entry_point("orchestrator")
    graph.add_conditional_edges("orchestrator", should_run_risk_first,
        {"risk_agent": "risk_agent", "context_agent": "context_agent"})
    graph.add_conditional_edges("context_agent", should_retry_context,
        {"context_agent": "context_agent", "routing_agent": "routing_agent"})
    graph.add_edge("risk_agent", "context_agent")
    graph.add_edge("routing_agent", "explainer_agent_check")
    graph.add_conditional_edges("explainer_agent_check", should_run_explainer,
        {"explainer_agent": "explainer_agent", "synthesis": "synthesis"})
    graph.add_edge("explainer_agent", "synthesis")
    graph.add_edge("synthesis", END)
    return graph.compile()
```

---

## SECTION 6 — CONTEXT AGENT (real tool use loop)

```python
# ai_engine/agents/context_agent.py
TOOLS = [
    {"name": "search_codebase", "description": "Semantic search over embedded code files",
     "input_schema": {"type": "object", "properties": {
         "query": {"type": "string"}, "top_k": {"type": "integer", "default": 5}}}},
    {"name": "get_file_content", "description": "Get actual file content from GitHub",
     "input_schema": {"type": "object", "properties": {"file_path": {"type": "string"}}}},
    {"name": "get_recent_prs_for_file", "description": "PRs that touched a file",
     "input_schema": {"type": "object", "properties": {
         "file_path": {"type": "string"}, "limit": {"type": "integer", "default": 5}}}},
    {"name": "search_closed_tickets", "description": "Similar resolved Jira tickets",
     "input_schema": {"type": "object", "properties": {
         "keywords": {"type": "array", "items": {"type": "string"}}}}}
]

def run_context_agent(state: AgentScratchpad) -> AgentScratchpad:
    messages = [{"role": "user", "content": build_context_prompt(state)}]
    tools_called = []

    while True:
        response = anthropic_client.messages.create(
            model="claude-sonnet-4-20250514",
            max_tokens=2000,
            system=load_prompt("context_agent"),  # from prompts.json
            tools=TOOLS,
            messages=messages
        )
        if response.stop_reason == "end_turn":
            break
        if response.stop_reason == "tool_use":
            tool_results = []
            for block in response.content:
                if block.type == "tool_use":
                    result = execute_tool(block.name, block.input, state)
                    if block.name == "search_codebase":
                        result = validate_file_paths(result)  # no hallucinated paths
                    tools_called.append({"tool": block.name, "input": block.input})
                    tool_results.append({"type": "tool_result",
                                         "tool_use_id": block.id, "content": str(result)})
            messages.append({"role": "assistant", "content": response.content})
            messages.append({"role": "user", "content": tool_results})

    parsed = parse_context_output(response)
    confidence = compute_retrieval_confidence(parsed["relevant_files"])  # pgvector scores, not LLM

    state["relevant_files"] = parsed["relevant_files"]
    state["related_prs"] = parsed["related_prs"]
    state["related_tickets"] = parsed["related_tickets"]
    state["context_confidence"] = confidence
    state["context_retry_count"] = state.get("context_retry_count", 0) + 1
    return state

def compute_retrieval_confidence(files: list) -> float:
    """Real confidence from pgvector cosine similarity scores."""
    if not files:
        return 0.0
    return round(sum(f.get("similarity_score", 0) for f in files) / len(files), 2)
```

---

## SECTION 7 — DATABASE SCHEMA

```sql
-- ai_engine/db/migrations/001_init.sql

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE code_embeddings (
    id           SERIAL PRIMARY KEY,
    repo         VARCHAR(255) NOT NULL,
    file_path    VARCHAR(512) NOT NULL,
    chunk_text   TEXT NOT NULL,
    embedding    vector(1024),          -- voyage-code-2 dimension
    last_updated TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(repo, file_path)
);
CREATE INDEX ON code_embeddings USING ivfflat (embedding vector_cosine_ops);

CREATE TABLE tickets (
    id            SERIAL PRIMARY KEY,
    ticket_key    VARCHAR(50) UNIQUE NOT NULL,
    jira_issue_id VARCHAR(50) UNIQUE NOT NULL,
    raw_payload   JSONB NOT NULL,
    ticket_dto    JSONB NOT NULL,
    status        VARCHAR(50) DEFAULT 'pending',
    received_at   TIMESTAMPTZ DEFAULT NOW(),
    processed_at  TIMESTAMPTZ
);

CREATE TABLE briefings (
    id                 SERIAL PRIMARY KEY,
    run_id             UUID DEFAULT gen_random_uuid(),
    ticket_key         VARCHAR(50) REFERENCES tickets(ticket_key),
    scratchpad         JSONB NOT NULL,
    briefing           JSONB NOT NULL,
    agent_trace        JSONB NOT NULL,
    overall_confidence FLOAT,
    execution_plan     TEXT[],
    created_at         TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE agent_prompts (
    id          SERIAL PRIMARY KEY,
    agent_name  VARCHAR(100) UNIQUE NOT NULL,
    system_prompt TEXT NOT NULL,
    version     INT DEFAULT 1,
    updated_at  TIMESTAMPTZ DEFAULT NOW(),
    updated_by  VARCHAR(100)
);

CREATE TABLE team_registry (
    id                  SERIAL PRIMARY KEY,
    team_name           VARCHAR(100) NOT NULL,
    member_name         VARCHAR(100) NOT NULL,
    role                VARCHAR(100),
    github_handle       VARCHAR(100),
    domains             TEXT[],
    owned_paths         TEXT[],
    escalation_priority INT DEFAULT 1
);

CREATE TABLE jira_poll_state (
    id             SERIAL PRIMARY KEY,
    last_polled_at TIMESTAMPTZ DEFAULT NOW(),
    last_ticket_key VARCHAR(50)
);
```

---

## SECTION 8 — JIRA POLLING SERVICE

```javascript
// gateway/src/services/jiraPoller.js
const cron = require('node-cron');
const axios = require('axios');

const jiraAuth = {
    auth: { username: process.env.JIRA_EMAIL, password: process.env.JIRA_API_TOKEN }
};
const processedTickets = new Set();

async function pollJira() {
    const jql = `project = ${process.env.JIRA_PROJECT_KEY} AND updated >= -2m ORDER BY updated DESC`;
    const response = await axios.get(`${process.env.JIRA_BASE_URL}/rest/api/3/search`, {
        params: { jql, maxResults: 20,
            fields: 'summary,description,priority,assignee,reporter,labels,components,status,issuetype,created' },
        ...jiraAuth
    });
    for (const issue of response.data.issues) {
        if (processedTickets.has(issue.key)) continue;
        if (await checkDB(issue.key)) continue;
        const dto = normaliseToTicketDTO(issue);
        await axios.post(`${process.env.AI_ENGINE_URL}/analyse`, dto);
        processedTickets.add(issue.key);
    }
}

function normaliseToTicketDTO(issue) {
    return {
        ticket_id: issue.id,
        ticket_key: issue.key,
        ticket_summary: issue.fields.summary,
        ticket_description: extractPlainText(issue.fields.description),
        ticket_priority: issue.fields.priority?.name || 'Medium',
        ticket_labels: issue.fields.labels || [],
        ticket_components: issue.fields.components?.map(c => c.name) || [],
        ticket_assignee: {
            name: issue.fields.assignee?.displayName || 'Unassigned',
            email: issue.fields.assignee?.emailAddress || null,
            jira_account_id: issue.fields.assignee?.accountId || null
        },
        ticket_reporter: {
            name: issue.fields.reporter?.displayName,
            email: issue.fields.reporter?.emailAddress
        },
        ticket_created: issue.fields.created,
        ticket_type: issue.fields.issuetype?.name || 'Task'
    };
}

cron.schedule('*/1 * * * *', pollJira);
module.exports = { pollJira };
```

---

## SECTION 9 — JIRA WRITE-BACK (ADF format)

```javascript
// gateway/src/services/jiraWriter.js
async function writeCommentToJira(ticketKey, briefing, traceUrl) {
    const body = {
        body: {
            type: "doc", version: 1,
            content: [
                { type: "heading", attrs: { level: 3 },
                  content: [{ type: "text",
                    text: `🤖 SAGE Analysis — confidence ${Math.round(briefing.overall_confidence * 100)}%` }] },
                { type: "paragraph",
                  content: [{ type: "text", marks: [{type:"strong"}], text: "Context: " },
                             { type: "text", text: briefing.context_summary }] },
                { type: "paragraph",
                  content: [{ type: "text", marks: [{type:"strong"}], text: "Owner: " },
                             { type: "text", text: `${briefing.primary_owner.name} (${briefing.primary_owner.team})` }] },
                { type: "blockquote", content: [{ type: "paragraph",
                    content: [{ type: "text", marks:[{type:"strong"}], text: "Ask senior: " },
                               { type: "hardBreak" },
                               { type: "text", text: briefing.suggested_question }] }] },
                { type: "paragraph",
                  content: [{ type: "text", marks: [{ type: "link", attrs: { href: traceUrl } }],
                    text: "→ View full briefing in SAGE" }] }
            ]
        }
    };
    await axios.post(`${process.env.JIRA_BASE_URL}/rest/api/3/issue/${ticketKey}/comment`,
        body, jiraAuth);
}
```

---

## SECTION 10 — SSE STREAMING ENDPOINTS

```python
# ai_engine/api/routes.py
from fastapi import FastAPI
from fastapi.responses import StreamingResponse
import asyncio, json
from uuid import uuid4

app = FastAPI()

@app.post("/analyse")
async def analyse_ticket(ticket_dto: dict):
    run_id = str(uuid4())
    await db.save_ticket(ticket_dto, run_id)
    asyncio.create_task(run_pipeline(ticket_dto, run_id))
    return {"run_id": run_id, "status": "processing"}

@app.get("/stream/{run_id}")
async def stream_events(run_id: str):
    async def event_generator():
        while True:
            events = await db.get_new_sse_events(run_id)
            for event in events:
                yield f"data: {json.dumps(event)}\n\n"
            status = await db.get_run_status(run_id)
            if status in ["complete", "failed"]:
                yield f"data: {json.dumps({'type': 'done', 'status': status})}\n\n"
                break
            await asyncio.sleep(0.5)
    return StreamingResponse(event_generator(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})

# SSE event types (frontend listens for all of these):
# {type: "plan_ready",     data: {plan, reasoning}}
# {type: "agent_started",  data: {agent, tools_available}}
# {type: "tool_called",    data: {agent, tool, input_summary}}
# {type: "tool_result",    data: {agent, tool, result_summary, confidence}}
# {type: "agent_complete", data: {agent, duration_ms, confidence, decision}}
# {type: "briefing_ready", data: {briefing, trace, run_id}}
# {type: "jira_commented", data: {ticket_key, comment_url}}
```

---

## SECTION 11 — ALL AGENT PROMPTS (prompts.json — exact content)

```json
{
  "orchestrator": {
    "version": 1,
    "system_prompt": "You are the Orchestrator for SAGE. Classify the Jira ticket:\n- severity: P0 (production down/data loss), P1 (major feature broken), P2 (non-critical)\n- domain: engineering domain (payments, frontend, infra, auth, data)\n- is_production: true if labels/description mention prod/production/live\n- has_clear_assignee: true if specific engineer is assigned\n- estimated_complexity: low (docs/minor bug), medium (feature/bug), high (architectural)\n\nAlways explain your reasoning for each classification.\n\nReturn JSON only:\n{\"severity\": \"P0|P1|P2\", \"domain\": \"string\", \"is_production\": bool, \"has_clear_assignee\": bool, \"estimated_complexity\": \"low|medium|high\", \"reasoning\": \"string\"}"
  },
  "context_agent": {
    "version": 1,
    "system_prompt": "You are the Context Agent for SAGE. Find what parts of the codebase are relevant to this ticket.\n\nTools: search_codebase, get_file_content, get_recent_prs_for_file, search_closed_tickets.\n\nStrategy:\n1. Extract key technical concepts from the ticket\n2. Search codebase with those concepts\n3. Fetch actual file content to verify relevance\n4. Find recent PRs to identify who knows this code\n5. Search similar past tickets\n\nOnly cite files you actually retrieved. Never invent file paths.\nStop when you have 3-5 high-confidence files or have tried 3 different queries."
  },
  "routing_agent": {
    "version": 1,
    "system_prompt": "You are the Routing Agent for SAGE. Given ticket and codebase context, identify the best person to own this ticket.\n\nOutput must include:\n1. primary_owner: best person, with reason (cite specific files they own)\n2. escalation_path: 1-2 backups\n3. suggested_question: complete, specific, ready-to-send message. Must reference actual file names and PR numbers from context.\n\nBAD: 'Hey, can you help me with this ticket?'\nGOOD: 'Hey Priya, I picked up PROJ-347 about the payment retry failure. SAGE found payments/processor.py was last touched in PR #234 which you merged. Was MAX_RETRIES=3 intentional or a temp fix?'"
  },
  "explainer_agent": {
    "version": 1,
    "system_prompt": "You are the Explainer Agent for SAGE. Audience: junior engineer new to the codebase.\n\nProduce:\n1. plain_summary: what this ticket asks for, plain English, 2-3 sentences\n2. suggested_steps: 3-6 concrete steps. Each must have: action, why it makes sense given context, estimated effort in hours.\n3. key_concepts: technical terms the junior may not know (just name them)\n\nTone: clear, direct, non-condescending."
  },
  "risk_agent": {
    "version": 1,
    "system_prompt": "You are the Risk Agent for SAGE. Identify risks based on context found.\n\nLook for:\n- Open bugs in same files/module\n- Past incidents in this area\n- High-traffic code paths\n- Auth, payments, or data integrity involvement\n- Breaking dependencies\n\nFor each flag: description, severity (critical/high/medium), specific evidence (cite ticket keys or file names).\nOverall risk: critical if any flag critical, high if any high, medium otherwise.\n\nDo not invent risks without evidence from provided context."
  },
  "synthesis": {
    "version": 1,
    "system_prompt": "You are the Synthesis node for SAGE. Assemble the final briefing from the complete scratchpad.\n\nStructure:\n- context_summary: 1-2 sentences on files/context found\n- owner_summary: who owns this and why\n- steps_summary: suggested approach\n- risk_summary: key risks in one sentence\n- ask_senior_message: copy exactly from Routing Agent's suggested_question\n\nAlso produce jira_comment_body: clean markdown for Jira, under 200 words, confidence score first, ask-senior as blockquote."
  }
}
```

---

## SECTION 12 — ENVIRONMENT VARIABLES (complete list)

```bash
# ai_engine/.env.example
ANTHROPIC_API_KEY=
AZURE_POSTGRES_URL=postgresql://user:pass@host:5432/sage
GITHUB_TOKEN=               # fine-grained PAT, read-only
GITHUB_OWNER=               # your GitHub org/username
GITHUB_REPOS=repo1,repo2    # comma-separated repos to embed
AI_ENGINE_PORT=8000

# gateway/.env.example
JIRA_BASE_URL=https://yourteam.atlassian.net
JIRA_EMAIL=
JIRA_API_TOKEN=             # from Atlassian account settings
JIRA_PROJECT_KEY=PROJ
AI_ENGINE_URL=http://localhost:8000
JWT_SECRET=
GATEWAY_PORT=3001

# frontend/.env.example
VITE_GATEWAY_URL=http://localhost:3001
VITE_AI_ENGINE_URL=http://localhost:8000
```

---

## SECTION 13 — THE TWO-TICKET DEMO (prepare BEFORE the presentation)

Create these in your Jira project:

**Ticket A — PROJ-001 (Critical / P0)**
```
Summary: Payment gateway returning 500 errors on retry after timeout
Description: Users are reporting failed payments since 3 AM. Payment gateway 
returning 500 errors specifically on retry attempts after initial timeout. 
Error rate 12% of all payment attempts. Affecting production.
Priority: Critical
Labels: payments, production, incident
Component: Backend API
```

Expected SAGE behaviour:
- severity: P0, is_production: true
- execution_plan: `["risk", "context", "routing"]` — Explainer SKIPPED
- Risk Agent runs FIRST
- Jira comment posted in under 90 seconds

**Ticket B — PROJ-002 (Low / P2)**
```
Summary: Update API documentation for new authentication endpoints
Description: New OAuth2 endpoints added in the last sprint are missing from 
developer documentation. Need to add examples for /auth/token, /auth/refresh, 
and /auth/revoke endpoints.
Priority: Low
Labels: documentation, auth
Component: Developer Docs
```

Expected SAGE behaviour:
- severity: P2, is_production: false, complexity: low
- execution_plan: `["context", "routing", "explainer"]` — Risk Agent SKIPPED
- Completely different output, completely different path

**Show CompareView side by side. Point to `execution_plan` in both traces. That is your proof of agency.**

---

## SECTION 14 — JUDGE Q&A ANSWERS (memorize these)

**"Is this just chaining LLM calls?"**
No. The execution plan is built at runtime by the Orchestrator based on ticket signals. Two different tickets take different paths — visible in agent trace and LangGraph conditional edges. Context Agent also runs a tool-use loop where it decides whether to retry based on computed confidence scores, not a fixed number of calls.

**"How is confidence computed?"**
Mean cosine similarity from pgvector results — a real number from vector search, not an LLM-invented percentage. Raw similarity scores are in the agent trace for every file retrieved.

**"Why Node.js AND FastAPI?"**
Node handles I/O-bound Jira polling, auth, write-back — benefits from event loop. FastAPI handles LLM inference, LangGraph orchestration, vector search — needs Python's ML ecosystem. Separating them means independent scaling and a clean integration boundary.

**"What if LLM hallucinated a file path?"**
Every file path from Context Agent is validated against actual GitHub API responses before writing to scratchpad. If the file doesn't exist in the repo, it's rejected.

**"How do you prevent double processing?"**
Deduplicator checks `tickets` table before forwarding. If ticket_key exists with status 'complete' or 'processing', it's dropped. Jira poller uses 2-minute lookback with overlap handling.

**"What's the confidence badge colour logic?"**
Green >75%, amber 50–75%, red <50%. Computed from pgvector similarity — not vibes.

---

## SECTION 15 — REQUIREMENTS.TXT

```
fastapi==0.110.0
uvicorn==0.27.1
langgraph==0.0.69
anthropic==0.25.0
psycopg2-binary==2.9.9
pgvector==0.2.5
httpx==0.27.0
python-dotenv==1.0.0
pydantic==2.6.4
pytest==8.1.1
pytest-asyncio==0.23.6
requests==2.31.0
```

---

## SECTION 16 — GITHUB ACTIONS CI/CD

```yaml
# .github/workflows/deploy.yml
name: SAGE CI/CD
on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-python@v4
        with: { python-version: '3.11' }
      - run: pip install -r ai_engine/requirements.txt
      - run: pytest ai_engine/tests/ -v --tb=short
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
          AZURE_POSTGRES_URL: ${{ secrets.AZURE_POSTGRES_URL }}
      - uses: actions/setup-node@v3
        with: { node-version: '20' }
      - run: cd gateway && npm ci
      - name: API tests
        run: |
          cd gateway && npm start &
          sleep 5
          cd ai_engine && uvicorn api.routes:app --port 8000 &
          sleep 5
          npx newman run ai_engine/tests/sage_api.postman_collection.json \
            --env-var "base_url=http://localhost:8000"

  deploy:
    needs: test
    runs-on: ubuntu-latest
    if: github.ref == 'refs/heads/main'
    steps:
      - uses: actions/checkout@v3
      - uses: azure/docker-login@v1
        with:
          login-server: ${{ secrets.ACR_LOGIN_SERVER }}
          username: ${{ secrets.ACR_USERNAME }}
          password: ${{ secrets.ACR_PASSWORD }}
      - run: |
          docker build -t ${{ secrets.ACR_LOGIN_SERVER }}/sage-ai:${{ github.sha }} ./ai_engine
          docker push ${{ secrets.ACR_LOGIN_SERVER }}/sage-ai:${{ github.sha }}
      - uses: azure/webapps-deploy@v2
        with:
          app-name: sage-ai-engine
          images: ${{ secrets.ACR_LOGIN_SERVER }}/sage-ai:${{ github.sha }}
      - uses: Azure/static-web-apps-deploy@v1
        with:
          azure_static_web_apps_api_token: ${{ secrets.AZURE_STATIC_WEB_APPS_TOKEN }}
          repo_token: ${{ secrets.GITHUB_TOKEN }}
          action: upload
          app_location: /frontend
          output_location: dist
```

---

## SECTION 17 — DECISIONS.MD (commit this early — judges love it)

```markdown
# Engineering Decisions

| Decision | Alternatives Considered | Why We Chose This |
|----------|------------------------|-------------------|
| LangGraph for orchestration | Raw while loop, CrewAI | Conditional edges are first-class. Graph is inspectable. Retry logic is a single edge, not nested if-else. |
| Node.js gateway + FastAPI AI engine | Single FastAPI service | Node event loop for I/O-bound Jira polling; Python ML ecosystem for inference. Scale independently. |
| pgvector on Azure PostgreSQL | Pinecone, Weaviate, ChromaDB | Zero extra infrastructure. Same connection pool. Cosine similarity built in. Free tier on Azure. |
| SSE over WebSockets | WebSockets, polling | Unidirectional push is sufficient. Simpler auth. Works through corporate proxies. |
| Scratchpad TypedDict | Pydantic BaseModel, plain dict | Static type checking. Single contract visible to every agent. No hidden state. |
| prompts.json + Prompt Studio | Hardcoded strings | Hackathon requirement. Editable without code change. DB synced on startup. |
| voyage-code-2 embeddings | text-embedding-3-small, ada-002 | Code-specific model. Higher similarity scores for code search. Available via Anthropic. |
| Confidence from pgvector scores | LLM self-assessment | Deterministic. Reproducible. Cannot be hallucinated. Directly represents retrieval quality. |
```

---

## SECTION 18 — BUILD PROMPTS FOR EACH SESSION

### Starting any session:
```
I am building SAGE (Situational Awareness & Guidance Engine) for the Veersa Hackathon 2027. 
Here is the complete project specification: [paste this entire file].
I am Person [A/B/C]. 
Now build [exact file path]. 
Do not deviate from the Scratchpad schema in Section 4. 
Do not add endpoints not listed in Section 10. 
Do not invent new fields.
```

### Person A — Frontend sessions:
```
Build useSSE.js from Section 10. It connects to /stream/{run_id} on port 8000 directly 
(not through gateway). Parse all 7 event types listed. Each event updates its own state slice. 
Export a hook: useSSE(runId) → { events, status, briefing }.
```
```
Build AgentTrace.jsx. It receives agent_trace array from scratchpad. Render each agent as a 
timeline row showing: agent name, duration_ms, confidence as ConfidenceBadge, decision_made 
string, and collapsible tools_called list. Use Tailwind only.
```
```
Build BriefingPanel.jsx. It has 5 sections: Context (relevant_files list with similarity scores), 
Owner (primary_owner card + suggested_question with copy button), Steps (suggested_steps numbered), 
Risks (risk_flags with severity colour), Ask Senior (ask_senior_message in a copy-ready box).
```
```
Build PromptStudio.jsx. It fetches GET /prompts from gateway (port 3001). Renders one textarea per 
agent. Save button hits PUT /prompts/:agent. Show version number and last updated timestamp.
```
```
Build CompareView.jsx. Side-by-side layout of two ticket briefings. Left panel: PROJ-001 trace. 
Right panel: PROJ-002 trace. Highlight in amber any agent that appears in one execution_plan 
but not the other. This is the demo's proof of agency.
```

### Person B — Gateway sessions:
```
Build jiraNormaliser.js. Input: raw Jira issue JSON. Output: TicketDTO matching exactly the 
input fields of AgentScratchpad in Section 4. Handle missing fields with safe defaults. 
Export: normaliseToTicketDTO(issue) → TicketDTO.
```
```
Build jiraPoller.js from Section 8. Cron every 60 seconds. JQL: project = PROJ AND updated >= -2m. 
Deduplicate via in-memory Set + DB check. Forward to FastAPI /analyse endpoint. Log each new ticket.
```
```
Build jiraWriter.js from Section 9. Input: ticketKey, briefing object, traceUrl. 
POST ADF-formatted comment to Jira REST API v3. Exact ADF structure is in Section 9.
```
```
Build Express routes: POST /tickets (manual submit), GET /tickets (list with status), 
GET /prompts (all agent prompts from DB), PUT /prompts/:agent (update prompt, bump version). 
All routes behind JWT middleware.
```

### Person C — AI Engine sessions:
```
Build ai_engine/db/migrations/001_init.sql from Section 7. Exact schema, no changes. 
Then build connection.py with async psycopg2 pool. Connection string from AZURE_POSTGRES_URL env.
```
```
Build embeddings.py from the spec. embed_repository(owner, repo, branch) fetches GitHub file tree, 
extracts semantic chunks from .py .js .ts .jsx files, embeds via voyage-code-2, stores in 
code_embeddings table. search_codebase(query, top_k) does pgvector cosine similarity search.
```
```
Build orchestrator.py from Section 5. Exact LangGraph graph: 5 nodes, 3 conditional edges, 
1 regular edge from risk_agent to context_agent. Entry point: orchestrator. classify_and_plan 
must produce execution_plan from 3 possible plans as shown. No other plans.
```
```
Build context_agent.py from Section 6. Tool use loop continues until stop_reason == "end_turn". 
compute_retrieval_confidence must use pgvector similarity scores only — never ask LLM for confidence. 
Validate all file paths against GitHub API before writing to scratchpad.
```
```
Build FastAPI routes from Section 10: POST /analyse and GET /stream/{run_id}. 
/analyse saves ticket and starts pipeline as background task. /stream is SSE returning events 
from DB queue, closing when status is complete or failed.
```

---

## SECTION 19 — ONE-DAY BUILD ORDER

```
NOW → +2h
  Person A: React scaffold + Tailwind + layout (left: TicketQueue, right: BriefingPanel skeleton) + useSSE.js
  Person B: Express setup + JWT + jiraNormaliser + jiraPoller running against live Jira
  Person C: Azure PostgreSQL up + 001_init.sql run + embed_repository() run on your GitHub repos ← DO THIS FIRST

+2h → +5h
  Person A: AgentTrace + BriefingPanel + ConfidenceBadge
  Person B: jiraWriter + gateway routes + deduplicator + prompt CRUD
  Person C: orchestrator.py + context_agent.py + routing_agent.py + explainer_agent.py + risk_agent.py + synthesis.py

+5h → +8h
  ALL: Integration — run PROJ-001 end to end. Fix what breaks.
  Person A: PromptStudio + CompareView
  Person B: Push to Azure, GitHub Actions green

+8h → +10h
  ALL: Run both demo tickets. Verify different execution_plan values. Verify Jira comment posted.

+10h → +12h
  Person A: Polish, record demo video (5 min max)
  Person B + C: README + DECISIONS.md + architecture.png + final commit sweep

DEADLINE: May 2, 2026 at 11:59 PM IST
```

---

## SECTION 20 — CHECKLIST (tick off before submitting)

- [ ] Jira polling running and picking up new tickets automatically
- [ ] Two demo tickets created: PROJ-001 (Critical/production) and PROJ-002 (Low/docs)
- [ ] PROJ-001 execution_plan = `["risk", "context", "routing"]`
- [ ] PROJ-002 execution_plan = `["context", "routing", "explainer"]`
- [ ] Jira comment written back to each ticket after analysis
- [ ] pgvector has real code embeddings (run embed_repository before demo)
- [ ] confidence scores come from pgvector, not LLM
- [ ] file paths validated against GitHub before writing to scratchpad
- [ ] prompts.json committed and editable via Prompt Studio UI
- [ ] agent_trace logged for every run and visible in AgentTrace component
- [ ] CompareView shows both traces side by side with plan diff highlighted
- [ ] No secrets in code — all in .env files
- [ ] GitHub Actions passing (both pytest and Newman)
- [ ] Azure deployment live and URL in README
- [ ] Each team member has commits from their own account
- [ ] DECISIONS.md committed
- [ ] Architecture diagram (architecture.png) committed
- [ ] Demo video ≤ 5 minutes uploaded
- [ ] Public GitHub repo link submitted via MS Forms before deadline
```

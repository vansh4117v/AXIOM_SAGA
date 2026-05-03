# AXIOM SAGE (Situational Awareness & Guidance Engine)

SAGE is a **Jira-integrated multi-agent AI system** built for the Veersa Hackathon 2027. It intercepts tickets at creation via polling, builds a **Situational Briefing** by reasoning across live codebase context, team knowledge graphs, and historical risk signals — then delivers that intelligence as a structured comment back into the Jira ticket and on a live React dashboard.

## The Problem SAGE Solves

**It turns the 3-hour "who do I ask and what do I do" delay that every junior engineer faces into a 30-second briefing delivered where they already work — inside Jira.**

SAGE does not just process tickets blindly. It reasons about them. Two tickets that look superficially similar produce **different agent execution paths, different tool call sequences, and different outputs** — because the Orchestrator reads ticket signals and builds a runtime plan, not a fixed pipeline. This branching is visible, traceable, and explainable.

## Architecture & Engineering Decisions

The system is built as a microservices architecture with three core components:

### 1. Frontend (`/frontend`)
- **Stack:** React 18, Vite, Tailwind CSS v4
- **Features:** 
  - Glassmorphic, dark-mode first UI
  - Real-time Server-Sent Events (SSE) tracing of AI agent pipelines
  - Ticket dashboard and detailed briefing views
  - Side-by-side run comparisons
  - Dynamic prompt studio

### 2. Gateway (`/gateway`)
- **Stack:** Node.js, Express, Prisma
- **Database:** PostgreSQL (Azure/Docker)
- **Features:**
  - JWT Authentication
  - Background Jira polling to automatically ingest new tickets
  - Deduplication and rate-limiting
  - Serves as the central API gateway for the frontend

### 3. AI Engine (`/agent`)
- **Stack:** Python 3.11, FastAPI, LangGraph
- **Features:**
  - Complex state-machine pipeline using LangGraph
  - Specialized agents: Context, Risk, Routing, Explainer, Synthesis
  - Connects back to Jira to write automated comments
  - Streams execution traces via SSE

### Key Engineering Decisions
- **LangGraph over raw loops:** Conditional edges are first-class citizens. The graph is inspectable, and retry logic is a single edge, not a nested if-else.
- **Node.js gateway + FastAPI AI engine:** Node handles I/O-bound Jira polling/auth; FastAPI handles CPU-bound LLM inference. Scale independently.
- **pgvector on Azure PostgreSQL:** No separate vector DB to manage, same connection pool as relational data, cosine similarity built in.
- **SSE over WebSockets:** One-directional server push is enough, no auth complexity, works through proxies.
- **Scratchpad TypedDict:** Single immutable contract. Every agent reads and writes only its designated fields. No hidden state.

## Prerequisites

- Node.js 18+
- Python 3.11+
- PostgreSQL
- Jira Account with API Token
- Groq API Key (for LLM inference)

## Environment Variables

You need to configure `.env` files in each service directory. See the respective `.env.example` files.

### Gateway (`/gateway/.env`)
Must include `DATABASE_URL`, `JWT_SECRET`, and Jira credentials (`JIRA_BASE_URL`, `JIRA_EMAIL`, `JIRA_API_TOKEN`, `JIRA_PROJECT_KEY`).

### Agent (`/agent/.env`)
Must include `AZURE_POSTGRES_URL`, `GROQ_API_KEY`, and Jira credentials (same as gateway).

### Frontend (`/frontend/.env`)
Must include `VITE_GATEWAY_URL` and `VITE_AI_ENGINE_URL`.

## Running Locally

Run all three services concurrently in separate terminals:

**1. Gateway**
```bash
cd gateway
npm install
npx prisma generate
npm run dev
```

**2. AI Engine**
```bash
cd agent
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --port 8000 --reload
```

**3. Frontend**
```bash
cd frontend
npm install
npm run dev
```

## How It Works

1. **Ingestion**: The Gateway polls Jira every minute for new tickets matching the project key.
2. **Analysis Trigger**: A user selects a ticket in the Frontend and clicks "Analyse".
3. **Execution**: The Gateway forwards the request to the AI Engine.
4. **Pipeline**: The AI Engine orchestrates a LangGraph pipeline, pulling context, assessing risk, and generating a plan.
5. **Real-time Feedback**: The Frontend connects to the AI Engine via SSE to visualize the agent's thought process.
6. **Synthesis**: The AI Engine compiles a briefing, saves it to the database, and writes a comment back to the original Jira ticket.

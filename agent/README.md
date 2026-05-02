# SAGE — Situational Awareness & Guided Execution

Multi-agent AI system that analyses Jira tickets, retrieves codebase context via semantic search, assesses risk, routes to the right owner, and writes a structured briefing back to Jira.

## Architecture

```
Jira Webhook / Manual POST
        ↓
   FastAPI (main.py)
        ↓
   LangGraph Pipeline (graph.py)
        ↓
┌─────────────────────────────────────────────────┐
│  Orchestrator → classifies ticket, picks path   │
│                                                 │
│  Path 1 (P0/Prod): risk → context → routing     │
│  Path 2 (Low):     context → routing → explain  │
│  Path 3 (Default): context → routing → explain → risk │
│                                                 │
│  Synthesis → briefing → Jira comment            │
└─────────────────────────────────────────────────┘
        ↓
   SSE Stream → Frontend
```

## Quick Start

```bash
cp .env.example .env          # fill keys
pip install -r requirements.txt
psql "$AZURE_POSTGRES_URL" -f db/migrations/001_init.sql
python scripts/embed_repos.py
uvicorn main:app --host 0.0.0.0 --port 8000
```

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Health check |
| `POST` | `/analyse` | Submit ticket for analysis |
| `POST` | `/webhook/jira` | Jira webhook receiver |
| `GET` | `/stream/{run_id}` | SSE real-time agent updates |

## Test

```bash
pytest tests/test_core.py -v
```

## Environment Variables

| Variable | Purpose |
|----------|---------|
| `OPENAI_API_KEY` | LLM + embeddings |
| `GITHUB_TOKEN` | Codebase access |
| `AZURE_POSTGRES_URL` | PostgreSQL + pgvector |
| `JIRA_BASE_URL` | Jira Cloud instance |
| `JIRA_EMAIL` | Jira auth |
| `JIRA_API_TOKEN` | Jira auth |
| `WEBHOOK_SECRET` | Optional — shared secret for `/webhook/jira` security |
| `CORS_ORIGINS` | Comma-separated allowed origins (default: `*`) |

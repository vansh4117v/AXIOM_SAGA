CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE code_embeddings (
    id           SERIAL PRIMARY KEY,
    repo         VARCHAR(255) NOT NULL,
    file_path    VARCHAR(512) NOT NULL,
    chunk_text   TEXT NOT NULL,
    embedding    vector(1536),
    last_updated TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(repo, file_path)
);
CREATE INDEX ON code_embeddings USING hnsw (embedding vector_cosine_ops);

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
    run_id             UUID NOT NULL UNIQUE,
    ticket_key         VARCHAR(50) REFERENCES tickets(ticket_key),
    scratchpad         JSONB NOT NULL,
    briefing           JSONB NOT NULL,
    agent_trace        JSONB NOT NULL,
    overall_confidence FLOAT,
    execution_plan     TEXT[],
    created_at         TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE agent_prompts (
    id            SERIAL PRIMARY KEY,
    agent_name    VARCHAR(100) UNIQUE NOT NULL,
    system_prompt TEXT NOT NULL,
    version       INT DEFAULT 1,
    updated_at    TIMESTAMPTZ DEFAULT NOW(),
    updated_by    VARCHAR(100)
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
    id              SERIAL PRIMARY KEY,
    last_polled_at  TIMESTAMPTZ DEFAULT NOW(),
    last_ticket_key VARCHAR(50)
);

CREATE TABLE sse_events (
    id         SERIAL PRIMARY KEY,
    run_id     UUID NOT NULL,
    event_type VARCHAR(50) NOT NULL,
    payload    JSONB NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    delivered  BOOLEAN DEFAULT FALSE
);
CREATE INDEX ON sse_events (run_id, delivered);

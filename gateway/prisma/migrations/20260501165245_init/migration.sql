-- CreateTable
CREATE TABLE "users" (
    "id" SERIAL NOT NULL,
    "username" VARCHAR(100) NOT NULL,
    "email" VARCHAR(255) NOT NULL,
    "password_hash" VARCHAR(255),
    "role" VARCHAR(50) NOT NULL DEFAULT 'viewer',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "failed_attempts" INTEGER NOT NULL DEFAULT 0,
    "locked_until" TIMESTAMP(3),
    "last_login_at" TIMESTAMP(3),
    "google_id" VARCHAR(255),
    "avatar_url" VARCHAR(500),
    "auth_provider" VARCHAR(50) NOT NULL DEFAULT 'local',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "token_hash" VARCHAR(255) NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "revoked" BOOLEAN NOT NULL DEFAULT false,
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "user_agent" VARCHAR(500),
    "ip_address" VARCHAR(45),

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tickets" (
    "id" SERIAL NOT NULL,
    "ticket_key" VARCHAR(50) NOT NULL,
    "jira_issue_id" VARCHAR(50),
    "raw_payload" JSONB NOT NULL,
    "ticket_dto" JSONB NOT NULL,
    "status" VARCHAR(50) NOT NULL DEFAULT 'pending',
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMP(3),

    CONSTRAINT "tickets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "briefings" (
    "id" SERIAL NOT NULL,
    "run_id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "ticket_key" VARCHAR(50) NOT NULL,
    "scratchpad" JSONB NOT NULL,
    "briefing" JSONB NOT NULL,
    "agent_trace" JSONB NOT NULL,
    "overall_confidence" DOUBLE PRECISION,
    "execution_plan" TEXT[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "briefings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_prompts" (
    "id" SERIAL NOT NULL,
    "agent_name" VARCHAR(100) NOT NULL,
    "system_prompt" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" VARCHAR(100),

    CONSTRAINT "agent_prompts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "team_registry" (
    "id" SERIAL NOT NULL,
    "team_name" VARCHAR(100) NOT NULL,
    "member_name" VARCHAR(100) NOT NULL,
    "role" VARCHAR(100),
    "github_handle" VARCHAR(100),
    "domains" TEXT[],
    "owned_paths" TEXT[],
    "escalation_priority" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "team_registry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "code_embeddings" (
    "id" SERIAL NOT NULL,
    "repo" VARCHAR(255) NOT NULL,
    "file_path" VARCHAR(512) NOT NULL,
    "chunk_text" TEXT NOT NULL,
    "last_updated" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "code_embeddings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "jira_poll_state" (
    "id" SERIAL NOT NULL,
    "last_polled_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_ticket_key" VARCHAR(50),

    CONSTRAINT "jira_poll_state_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_google_id_key" ON "users"("google_id");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_token_hash_key" ON "refresh_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "refresh_tokens_user_id_idx" ON "refresh_tokens"("user_id");

-- CreateIndex
CREATE INDEX "refresh_tokens_expires_at_idx" ON "refresh_tokens"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "tickets_ticket_key_key" ON "tickets"("ticket_key");

-- CreateIndex
CREATE UNIQUE INDEX "tickets_jira_issue_id_key" ON "tickets"("jira_issue_id");

-- CreateIndex
CREATE UNIQUE INDEX "agent_prompts_agent_name_key" ON "agent_prompts"("agent_name");

-- CreateIndex
CREATE UNIQUE INDEX "code_embeddings_repo_file_path_key" ON "code_embeddings"("repo", "file_path");

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "briefings" ADD CONSTRAINT "briefings_ticket_key_fkey" FOREIGN KEY ("ticket_key") REFERENCES "tickets"("ticket_key") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "llm_call_traces" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "run_id" TEXT NOT NULL,
    "task_type" TEXT NOT NULL,
    "provider" TEXT,
    "model" TEXT NOT NULL,
    "prompt_version" TEXT,
    "agent_turn_id" TEXT,
    "run_participant_id" TEXT,
    "job_id" TEXT,
    "profile_id" TEXT,
    "step_number" INTEGER NOT NULL DEFAULT 0,
    "finish_reason" TEXT,
    "input_tokens" INTEGER,
    "output_tokens" INTEGER,
    "total_tokens" INTEGER,
    "reasoning_tokens" INTEGER,
    "cache_read_tokens" INTEGER,
    "cache_write_tokens" INTEGER,
    "no_cache_input_tokens" INTEGER,
    "raw_usage_json" TEXT,
    "metadata_json" TEXT NOT NULL DEFAULT '{}',
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "llm_call_traces_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "test_runs" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "idx_llm_call_traces_run_task_time" ON "llm_call_traces"("run_id", "task_type", "created_at");

-- CreateIndex
CREATE INDEX "idx_llm_call_traces_run_time" ON "llm_call_traces"("run_id", "created_at");

-- CreateIndex
CREATE INDEX "idx_llm_call_traces_agent_turn_id" ON "llm_call_traces"("agent_turn_id");

-- CreateTable
CREATE TABLE "run_llm_usage_summaries" (
    "run_id" TEXT NOT NULL PRIMARY KEY,
    "call_count" INTEGER NOT NULL DEFAULT 0,
    "input_tokens" INTEGER NOT NULL DEFAULT 0,
    "output_tokens" INTEGER NOT NULL DEFAULT 0,
    "total_tokens" INTEGER NOT NULL DEFAULT 0,
    "reasoning_tokens" INTEGER NOT NULL DEFAULT 0,
    "cache_read_tokens" INTEGER NOT NULL DEFAULT 0,
    "cache_write_tokens" INTEGER NOT NULL DEFAULT 0,
    "no_cache_input_tokens" INTEGER NOT NULL DEFAULT 0,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "run_llm_usage_summaries_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "test_runs" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

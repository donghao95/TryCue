-- CreateTable
CREATE TABLE "test_runs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "mode" TEXT NOT NULL DEFAULT 'single',
    "content_version_count" INTEGER NOT NULL DEFAULT 1,
    "audience_count" INTEGER NOT NULL,
    "audience_revision" INTEGER NOT NULL DEFAULT 0,
    "concurrency" INTEGER NOT NULL DEFAULT 5,
    "simulation_speed" TEXT NOT NULL DEFAULT 'fast_replay',
    "config_json" TEXT NOT NULL DEFAULT '{}',
    "error_message" TEXT,
    "clock_elapsed_ms" INTEGER NOT NULL DEFAULT 0,
    "clock_anchor_at" DATETIME,
    "clock_scale" INTEGER NOT NULL DEFAULT 10,
    "admission_window" INTEGER,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "started_at" DATETIME,
    "completed_at" DATETIME,
    "terminal_reason" TEXT,
    "updated_at" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "content_versions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "run_id" TEXT NOT NULL,
    "version_name" TEXT NOT NULL DEFAULT 'version_a',
    "title" TEXT NOT NULL,
    "cover_image_url" TEXT,
    "image_urls_json" TEXT NOT NULL DEFAULT '[]',
    "body_text" TEXT NOT NULL,
    "scale" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "content_versions_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "test_runs" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "assets" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "storage" TEXT NOT NULL DEFAULT 'local',
    "url" TEXT NOT NULL,
    "storage_key" TEXT,
    "original_name" TEXT,
    "mime_type" TEXT,
    "width" INTEGER,
    "height" INTEGER,
    "size_bytes" INTEGER,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "content_version_images" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "content_version_id" TEXT NOT NULL,
    "asset_id" TEXT,
    "url" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "content_version_images_content_version_id_fkey" FOREIGN KEY ("content_version_id") REFERENCES "content_versions" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "content_version_images_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "assets" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_type" TEXT NOT NULL DEFAULT 'human',
    "nickname" TEXT NOT NULL,
    "avatar_url" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "agents" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL,
    "origin_run_id" TEXT,
    "source_profile_id" TEXT,
    "retention_policy" TEXT NOT NULL DEFAULT 'retain',
    "favorited_at" DATETIME,
    "persona_json" TEXT NOT NULL DEFAULT '{}',
    "memory_summary" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "agents_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "agents_origin_run_id_fkey" FOREIGN KEY ("origin_run_id") REFERENCES "test_runs" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "agents_source_profile_id_fkey" FOREIGN KEY ("source_profile_id") REFERENCES "audience_profiles" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "platform_accounts" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "platform_accounts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "run_participants" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "run_id" TEXT NOT NULL,
    "source_profile_id" TEXT,
    "sampling_directive_id" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "user_id" TEXT NOT NULL,
    "agent_id" TEXT NOT NULL,
    "platform_account_id" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'generated',
    "display_name_snapshot" TEXT NOT NULL,
    "avatar_url_snapshot" TEXT,
    "profile_snapshot_json" TEXT NOT NULL DEFAULT '{}',
    "agent_snapshot_json" TEXT NOT NULL DEFAULT '{}',
    "platform_account_snapshot_json" TEXT NOT NULL DEFAULT '{}',
    "runtime_status" TEXT NOT NULL DEFAULT 'ready',
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "run_participants_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "test_runs" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "run_participants_source_profile_id_fkey" FOREIGN KEY ("source_profile_id") REFERENCES "audience_profiles" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "run_participants_sampling_directive_id_fkey" FOREIGN KEY ("sampling_directive_id") REFERENCES "audience_sampling_directives" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "run_participants_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "run_participants_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "agents" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "run_participants_platform_account_id_fkey" FOREIGN KEY ("platform_account_id") REFERENCES "platform_accounts" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "audience_sampling_plans" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "run_id" TEXT NOT NULL,
    "generation_job_id" TEXT,
    "total_count" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "plan_markdown" TEXT NOT NULL DEFAULT '',
    "dimensions_json" TEXT NOT NULL DEFAULT '[]',
    "error_message" TEXT,
    "confirmed_at" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "audience_sampling_plans_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "test_runs" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "audience_sampling_plans_generation_job_id_fkey" FOREIGN KEY ("generation_job_id") REFERENCES "audience_generation_jobs" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "audience_sampling_directives" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "plan_id" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "diversity_axes_json" TEXT NOT NULL DEFAULT '[]',
    "rationale" TEXT NOT NULL,
    "expansion_status" TEXT NOT NULL DEFAULT 'pending',
    "expansion_error" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "audience_sampling_directives_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "audience_sampling_plans" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "audience_profiles" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "run_id" TEXT NOT NULL,
    "sampling_plan_id" TEXT,
    "sampling_directive_id" TEXT,
    "sample_index" INTEGER NOT NULL DEFAULT 0,
    "generation_job_id" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "sampling_label" TEXT NOT NULL,
    "demographics_json" TEXT NOT NULL,
    "identity_status" TEXT NOT NULL DEFAULT 'profile_only',
    "identity_error" TEXT,
    "identity_generated_at" DATETIME,
    "generated_user_id" TEXT,
    "generated_agent_id" TEXT,
    "generated_platform_account_id" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "audience_profiles_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "test_runs" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "audience_profiles_sampling_plan_id_fkey" FOREIGN KEY ("sampling_plan_id") REFERENCES "audience_sampling_plans" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "audience_profiles_sampling_directive_id_fkey" FOREIGN KEY ("sampling_directive_id") REFERENCES "audience_sampling_directives" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "audience_profiles_generation_job_id_fkey" FOREIGN KEY ("generation_job_id") REFERENCES "audience_generation_jobs" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "audience_profiles_generated_user_id_fkey" FOREIGN KEY ("generated_user_id") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "audience_profiles_generated_agent_id_fkey" FOREIGN KEY ("generated_agent_id") REFERENCES "agents" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "audience_profiles_generated_platform_account_id_fkey" FOREIGN KEY ("generated_platform_account_id") REFERENCES "platform_accounts" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "audience_generation_jobs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "run_id" TEXT NOT NULL,
    "scope" TEXT NOT NULL DEFAULT 'sampling_plan',
    "status" TEXT NOT NULL DEFAULT 'queued',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "profile_id" TEXT,
    "sampling_plan_id" TEXT,
    "sampling_directive_id" TEXT,
    "target_count" INTEGER NOT NULL,
    "batch_size" INTEGER NOT NULL DEFAULT 10,
    "error_message" TEXT,
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "locked_by" TEXT,
    "locked_until" DATETIME,
    "heartbeat_at" DATETIME,
    "started_at" DATETIME,
    "completed_at" DATETIME,
    "canceled_at" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "audience_generation_jobs_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "test_runs" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "audience_generation_jobs_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "audience_profiles" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "audience_generation_jobs_sampling_plan_id_fkey" FOREIGN KEY ("sampling_plan_id") REFERENCES "audience_sampling_plans" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "audience_generation_jobs_sampling_directive_id_fkey" FOREIGN KEY ("sampling_directive_id") REFERENCES "audience_sampling_directives" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "agent_journeys" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "run_id" TEXT NOT NULL,
    "run_participant_id" TEXT NOT NULL,
    "actor_user_id" TEXT NOT NULL,
    "platform_account_id" TEXT NOT NULL,
    "content_version_id" TEXT NOT NULL,
    "prompt_version" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "runner_status" TEXT NOT NULL DEFAULT 'queued',
    "queue_seq" BIGINT NOT NULL DEFAULT 0,
    "last_transcript_seq" INTEGER NOT NULL DEFAULT 0,
    "current_step_index" INTEGER NOT NULL DEFAULT 0,
    "thought_summary" TEXT,
    "final_summary" TEXT,
    "exit_outcome" TEXT,
    "exit_reason" TEXT,
    "error_message" TEXT,
    "locked_by" TEXT,
    "locked_at" DATETIME,
    "heartbeat_at" DATETIME,
    "started_at" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    "completed_at" DATETIME,
    CONSTRAINT "agent_journeys_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "test_runs" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "agent_journeys_run_participant_id_fkey" FOREIGN KEY ("run_participant_id") REFERENCES "run_participants" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "agent_journeys_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "agent_journeys_platform_account_id_fkey" FOREIGN KEY ("platform_account_id") REFERENCES "platform_accounts" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "agent_journeys_content_version_id_fkey" FOREIGN KEY ("content_version_id") REFERENCES "content_versions" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "agent_transcript_items" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "run_id" TEXT NOT NULL,
    "journey_id" TEXT NOT NULL,
    "agent_turn_id" TEXT,
    "agent_tool_call_id" TEXT,
    "seq" INTEGER NOT NULL,
    "item_type" TEXT NOT NULL,
    "content" TEXT,
    "reasoning_content" TEXT,
    "observation_json" TEXT,
    "tool_calls_json" TEXT,
    "tool_result_json" TEXT,
    "metadata_json" TEXT NOT NULL DEFAULT '{}',
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "agent_transcript_items_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "test_runs" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "agent_transcript_items_journey_id_fkey" FOREIGN KEY ("journey_id") REFERENCES "agent_journeys" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "agent_transcript_items_agent_turn_id_fkey" FOREIGN KEY ("agent_turn_id") REFERENCES "agent_turns" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "agent_transcript_items_agent_tool_call_id_fkey" FOREIGN KEY ("agent_tool_call_id") REFERENCES "agent_tool_calls" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "agent_turns" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "run_id" TEXT NOT NULL,
    "run_participant_id" TEXT NOT NULL,
    "actor_user_id" TEXT NOT NULL,
    "platform_account_id" TEXT NOT NULL,
    "journey_id" TEXT NOT NULL,
    "content_version_id" TEXT NOT NULL,
    "step_index" INTEGER NOT NULL,
    "queue_seq" BIGINT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'created',
    "thought_text" TEXT,
    "reasoning_content" TEXT,
    "raw_agent_output_json" TEXT,
    "request_json" TEXT,
    "raw_response_json" TEXT,
    "parsed_tool_calls_json" TEXT,
    "model" TEXT,
    "prompt_version" TEXT,
    "retry_count" INTEGER NOT NULL DEFAULT 0,
    "error_message" TEXT,
    "locked_by" TEXT,
    "locked_at" DATETIME,
    "started_at" DATETIME,
    "completed_at" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "agent_turns_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "test_runs" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "agent_turns_run_participant_id_fkey" FOREIGN KEY ("run_participant_id") REFERENCES "run_participants" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "agent_turns_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "agent_turns_platform_account_id_fkey" FOREIGN KEY ("platform_account_id") REFERENCES "platform_accounts" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "agent_turns_journey_id_fkey" FOREIGN KEY ("journey_id") REFERENCES "agent_journeys" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "agent_turns_content_version_id_fkey" FOREIGN KEY ("content_version_id") REFERENCES "content_versions" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "agent_turn_contexts" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "agent_turn_id" TEXT NOT NULL,
    "screen_before_json" TEXT NOT NULL,
    "post_state_before_json" TEXT NOT NULL,
    "comments_page_json" TEXT NOT NULL DEFAULT '{}',
    "thought_summary" TEXT,
    "available_tools_json" TEXT NOT NULL DEFAULT '[]',
    "input_context_json" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "prompt_version" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "agent_turn_contexts_agent_turn_id_fkey" FOREIGN KEY ("agent_turn_id") REFERENCES "agent_turns" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "agent_tool_calls" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "agent_turn_id" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "journey_id" TEXT NOT NULL,
    "run_participant_id" TEXT NOT NULL,
    "actor_user_id" TEXT NOT NULL,
    "platform_account_id" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'agent_tool',
    "content_version_id" TEXT NOT NULL,
    "call_index" INTEGER NOT NULL,
    "sdk_call_id" TEXT,
    "idempotency_key" TEXT NOT NULL,
    "raw_tool_call_json" TEXT,
    "tool_name" TEXT NOT NULL,
    "tool_category" TEXT NOT NULL,
    "input" TEXT NOT NULL,
    "output" TEXT NOT NULL DEFAULT '{}',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "simulated_time" INTEGER NOT NULL,
    "error_message" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "agent_tool_calls_agent_turn_id_fkey" FOREIGN KEY ("agent_turn_id") REFERENCES "agent_turns" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "agent_tool_calls_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "test_runs" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "agent_tool_calls_journey_id_fkey" FOREIGN KEY ("journey_id") REFERENCES "agent_journeys" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "agent_tool_calls_run_participant_id_fkey" FOREIGN KEY ("run_participant_id") REFERENCES "run_participants" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "agent_tool_calls_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "agent_tool_calls_platform_account_id_fkey" FOREIGN KEY ("platform_account_id") REFERENCES "platform_accounts" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "agent_tool_calls_content_version_id_fkey" FOREIGN KEY ("content_version_id") REFERENCES "content_versions" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "live_events" (
    "sequence" INTEGER PRIMARY KEY AUTOINCREMENT,
    "run_id" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "live_events_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "test_runs" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "simulated_post_states" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "content_version_id" TEXT NOT NULL,
    "exposure_count" INTEGER NOT NULL DEFAULT 0,
    "open_count" INTEGER NOT NULL DEFAULT 0,
    "like_count" INTEGER NOT NULL DEFAULT 0,
    "favorite_count" INTEGER NOT NULL DEFAULT 0,
    "comment_count" INTEGER NOT NULL DEFAULT 0,
    "share_count" INTEGER NOT NULL DEFAULT 0,
    "exit_count" INTEGER NOT NULL DEFAULT 0,
    "current_phase" TEXT NOT NULL DEFAULT 'running',
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "simulated_post_states_content_version_id_fkey" FOREIGN KEY ("content_version_id") REFERENCES "content_versions" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "social_interaction_events" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "content_version_id" TEXT NOT NULL,
    "actor_user_id" TEXT NOT NULL,
    "platform_account_id" TEXT NOT NULL,
    "run_participant_id" TEXT,
    "agent_id" TEXT,
    "source" TEXT NOT NULL,
    "journey_id" TEXT,
    "journey_action_id" TEXT,
    "tool_call_id" TEXT,
    "interaction_type" TEXT NOT NULL,
    "target_type" TEXT,
    "target_id" TEXT,
    "cursor" TEXT,
    "simulated_time" INTEGER NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "social_interaction_events_content_version_id_fkey" FOREIGN KEY ("content_version_id") REFERENCES "content_versions" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "social_interaction_events_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "social_interaction_events_platform_account_id_fkey" FOREIGN KEY ("platform_account_id") REFERENCES "platform_accounts" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "social_interaction_events_run_participant_id_fkey" FOREIGN KEY ("run_participant_id") REFERENCES "run_participants" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "social_interaction_events_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "agents" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "social_interaction_events_journey_id_fkey" FOREIGN KEY ("journey_id") REFERENCES "agent_journeys" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "social_interaction_events_journey_action_id_fkey" FOREIGN KEY ("journey_action_id") REFERENCES "agent_turns" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "social_interaction_events_tool_call_id_fkey" FOREIGN KEY ("tool_call_id") REFERENCES "agent_tool_calls" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "social_reactions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "content_version_id" TEXT NOT NULL,
    "actor_user_id" TEXT NOT NULL,
    "platform_account_id" TEXT NOT NULL,
    "run_participant_id" TEXT,
    "agent_id" TEXT,
    "source" TEXT NOT NULL,
    "target_type" TEXT NOT NULL,
    "target_id" TEXT NOT NULL,
    "reaction_type" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "simulated_time" INTEGER NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "social_reactions_content_version_id_fkey" FOREIGN KEY ("content_version_id") REFERENCES "content_versions" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "social_reactions_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "social_reactions_platform_account_id_fkey" FOREIGN KEY ("platform_account_id") REFERENCES "platform_accounts" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "social_reactions_run_participant_id_fkey" FOREIGN KEY ("run_participant_id") REFERENCES "run_participants" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "social_reactions_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "agents" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "loaded_comment_pages" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "content_version_id" TEXT NOT NULL,
    "actor_user_id" TEXT NOT NULL,
    "platform_account_id" TEXT NOT NULL,
    "run_participant_id" TEXT,
    "source" TEXT NOT NULL,
    "journey_id" TEXT,
    "journey_action_id" TEXT,
    "tool_call_id" TEXT,
    "cursor" TEXT NOT NULL DEFAULT '',
    "next_cursor" TEXT,
    "sort" TEXT NOT NULL DEFAULT 'latest',
    "comment_ids_json" TEXT NOT NULL DEFAULT '[]',
    "has_more" BOOLEAN NOT NULL DEFAULT false,
    "simulated_time" INTEGER NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "loaded_comment_pages_content_version_id_fkey" FOREIGN KEY ("content_version_id") REFERENCES "content_versions" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "loaded_comment_pages_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "loaded_comment_pages_platform_account_id_fkey" FOREIGN KEY ("platform_account_id") REFERENCES "platform_accounts" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "loaded_comment_pages_run_participant_id_fkey" FOREIGN KEY ("run_participant_id") REFERENCES "run_participants" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "loaded_comment_pages_journey_id_fkey" FOREIGN KEY ("journey_id") REFERENCES "agent_journeys" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "loaded_comment_pages_journey_action_id_fkey" FOREIGN KEY ("journey_action_id") REFERENCES "agent_turns" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "loaded_comment_pages_tool_call_id_fkey" FOREIGN KEY ("tool_call_id") REFERENCES "agent_tool_calls" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "simulated_comments" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "content_version_id" TEXT NOT NULL,
    "actor_user_id" TEXT NOT NULL,
    "platform_account_id" TEXT NOT NULL,
    "run_participant_id" TEXT,
    "agent_id" TEXT,
    "source" TEXT NOT NULL,
    "journey_id" TEXT,
    "journey_action_id" TEXT,
    "tool_call_id" TEXT,
    "parent_comment_id" TEXT,
    "root_comment_id" TEXT,
    "comment_text" TEXT NOT NULL,
    "mentioned_user_ids_json" TEXT NOT NULL DEFAULT '[]',
    "mentioned_comment_ids_json" TEXT NOT NULL DEFAULT '[]',
    "like_count" INTEGER NOT NULL DEFAULT 0,
    "reply_count" INTEGER NOT NULL DEFAULT 0,
    "simulated_time" INTEGER NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "simulated_comments_content_version_id_fkey" FOREIGN KEY ("content_version_id") REFERENCES "content_versions" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "simulated_comments_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "simulated_comments_platform_account_id_fkey" FOREIGN KEY ("platform_account_id") REFERENCES "platform_accounts" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "simulated_comments_run_participant_id_fkey" FOREIGN KEY ("run_participant_id") REFERENCES "run_participants" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "simulated_comments_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "agents" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "simulated_comments_journey_id_fkey" FOREIGN KEY ("journey_id") REFERENCES "agent_journeys" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "simulated_comments_journey_action_id_fkey" FOREIGN KEY ("journey_action_id") REFERENCES "agent_turns" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "simulated_comments_tool_call_id_fkey" FOREIGN KEY ("tool_call_id") REFERENCES "agent_tool_calls" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "action_logs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "run_id" TEXT NOT NULL,
    "content_version_id" TEXT NOT NULL,
    "run_participant_id" TEXT,
    "actor_user_id" TEXT,
    "platform_account_id" TEXT,
    "journey_id" TEXT NOT NULL,
    "journey_action_id" TEXT NOT NULL,
    "tool_call_id" TEXT,
    "simulated_time" INTEGER NOT NULL,
    "log_text" TEXT NOT NULL,
    "action" TEXT,
    "thought_text" TEXT,
    "emotion" TEXT,
    "topic_tags_json" TEXT NOT NULL DEFAULT '[]',
    "risk_tags_json" TEXT NOT NULL DEFAULT '[]',
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "action_logs_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "test_runs" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "action_logs_content_version_id_fkey" FOREIGN KEY ("content_version_id") REFERENCES "content_versions" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "action_logs_run_participant_id_fkey" FOREIGN KEY ("run_participant_id") REFERENCES "run_participants" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "action_logs_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "action_logs_platform_account_id_fkey" FOREIGN KEY ("platform_account_id") REFERENCES "platform_accounts" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "action_logs_journey_id_fkey" FOREIGN KEY ("journey_id") REFERENCES "agent_journeys" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "action_logs_journey_action_id_fkey" FOREIGN KEY ("journey_action_id") REFERENCES "agent_turns" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "action_logs_tool_call_id_fkey" FOREIGN KEY ("tool_call_id") REFERENCES "agent_tool_calls" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "run_logs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "run_id" TEXT NOT NULL,
    "log_type" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "run_participant_id" TEXT,
    "actor_user_id" TEXT,
    "platform_account_id" TEXT,
    "metadata_json" TEXT NOT NULL DEFAULT '{}',
    "simulated_time" INTEGER NOT NULL DEFAULT 0,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "run_logs_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "test_runs" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "run_logs_run_participant_id_fkey" FOREIGN KEY ("run_participant_id") REFERENCES "run_participants" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "run_logs_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "run_logs_platform_account_id_fkey" FOREIGN KEY ("platform_account_id") REFERENCES "platform_accounts" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "insights" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "content_version_id" TEXT NOT NULL,
    "level" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "evidence" TEXT NOT NULL,
    "related_participant_ids_json" TEXT NOT NULL DEFAULT '[]',
    "related_user_ids_json" TEXT NOT NULL DEFAULT '[]',
    "related_tool_call_ids_json" TEXT NOT NULL DEFAULT '[]',
    "related_comment_ids_json" TEXT NOT NULL DEFAULT '[]',
    "simulated_time" INTEGER NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "insights_content_version_id_fkey" FOREIGN KEY ("content_version_id") REFERENCES "content_versions" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "reports" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "run_id" TEXT NOT NULL,
    "content_version_id" TEXT NOT NULL,
    "recommendation" TEXT NOT NULL,
    "summary_json" TEXT NOT NULL,
    "dimensions_json" TEXT NOT NULL,
    "comment_preview_json" TEXT NOT NULL,
    "risk_json" TEXT NOT NULL,
    "revision_suggestions_json" TEXT NOT NULL,
    "evidence_index_json" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "prompt_version" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "reports_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "test_runs" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "reports_content_version_id_fkey" FOREIGN KEY ("content_version_id") REFERENCES "content_versions" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "idx_test_runs_status" ON "test_runs"("status");

-- CreateIndex
CREATE INDEX "idx_test_runs_created_at" ON "test_runs"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "ux_content_versions_run_id" ON "content_versions"("run_id");

-- CreateIndex
CREATE UNIQUE INDEX "assets_url_key" ON "assets"("url");

-- CreateIndex
CREATE UNIQUE INDEX "assets_storage_key_key" ON "assets"("storage_key");

-- CreateIndex
CREATE INDEX "idx_assets_storage" ON "assets"("storage");

-- CreateIndex
CREATE INDEX "idx_content_version_images_asset_id" ON "content_version_images"("asset_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_content_version_images_sort" ON "content_version_images"("content_version_id", "sort_order");

-- CreateIndex
CREATE UNIQUE INDEX "ux_content_version_images_url" ON "content_version_images"("content_version_id", "url");

-- CreateIndex
CREATE INDEX "idx_users_user_type" ON "users"("user_type");

-- CreateIndex
CREATE INDEX "idx_agents_origin_retention" ON "agents"("origin_run_id", "retention_policy");

-- CreateIndex
CREATE INDEX "idx_agents_source_profile_id" ON "agents"("source_profile_id");

-- CreateIndex
CREATE INDEX "idx_agents_favorited_at" ON "agents"("favorited_at");

-- CreateIndex
CREATE UNIQUE INDEX "ux_agents_user_id" ON "agents"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_platform_accounts_user_platform" ON "platform_accounts"("user_id", "platform");

-- CreateIndex
CREATE INDEX "idx_run_participants_run_directive_sort" ON "run_participants"("run_id", "sampling_directive_id", "sort_order");

-- CreateIndex
CREATE INDEX "idx_run_participants_source_profile_id" ON "run_participants"("source_profile_id");

-- CreateIndex
CREATE INDEX "idx_run_participants_user_id" ON "run_participants"("user_id");

-- CreateIndex
CREATE INDEX "idx_run_participants_agent_id" ON "run_participants"("agent_id");

-- CreateIndex
CREATE INDEX "idx_run_participants_platform_account_id" ON "run_participants"("platform_account_id");

-- CreateIndex
CREATE INDEX "idx_run_participants_run_runtime_status" ON "run_participants"("run_id", "runtime_status");

-- CreateIndex
CREATE INDEX "idx_run_participants_run_id" ON "run_participants"("run_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_run_participants_run_platform_account" ON "run_participants"("run_id", "platform_account_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_audience_sampling_plans_run_id" ON "audience_sampling_plans"("run_id");

-- CreateIndex
CREATE INDEX "idx_audience_sampling_plans_generation_job_id" ON "audience_sampling_plans"("generation_job_id");

-- CreateIndex
CREATE INDEX "idx_audience_sampling_plans_run_status" ON "audience_sampling_plans"("run_id", "status");

-- CreateIndex
CREATE INDEX "idx_audience_sampling_directives_plan_id" ON "audience_sampling_directives"("plan_id");

-- CreateIndex
CREATE INDEX "idx_audience_sampling_directives_plan_expansion_status" ON "audience_sampling_directives"("plan_id", "expansion_status");

-- CreateIndex
CREATE UNIQUE INDEX "ux_audience_sampling_directives_plan_sort" ON "audience_sampling_directives"("plan_id", "sort_order");

-- CreateIndex
CREATE UNIQUE INDEX "ux_audience_profiles_generated_user_id" ON "audience_profiles"("generated_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_audience_profiles_generated_agent_id" ON "audience_profiles"("generated_agent_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_audience_profiles_generated_platform_account_id" ON "audience_profiles"("generated_platform_account_id");

-- CreateIndex
CREATE INDEX "idx_audience_profiles_run_directive_sort" ON "audience_profiles"("run_id", "sampling_directive_id", "sort_order");

-- CreateIndex
CREATE INDEX "idx_audience_profiles_sampling_plan_id" ON "audience_profiles"("sampling_plan_id");

-- CreateIndex
CREATE INDEX "idx_audience_profiles_generation_job_id" ON "audience_profiles"("generation_job_id");

-- CreateIndex
CREATE INDEX "idx_audience_profiles_run_identity_status" ON "audience_profiles"("run_id", "identity_status");

-- CreateIndex
CREATE UNIQUE INDEX "ux_audience_profiles_directive_sample" ON "audience_profiles"("sampling_directive_id", "sample_index");

-- CreateIndex
CREATE INDEX "idx_audience_generation_jobs_run_active_status" ON "audience_generation_jobs"("run_id", "active", "status");

-- CreateIndex
CREATE INDEX "idx_audience_generation_jobs_run_status" ON "audience_generation_jobs"("run_id", "status");

-- CreateIndex
CREATE INDEX "idx_audience_generation_jobs_run_scope" ON "audience_generation_jobs"("run_id", "scope");

-- CreateIndex
CREATE INDEX "idx_audience_generation_jobs_sampling_plan_id" ON "audience_generation_jobs"("sampling_plan_id");

-- CreateIndex
CREATE INDEX "idx_audience_generation_jobs_sampling_directive_id" ON "audience_generation_jobs"("sampling_directive_id");

-- CreateIndex
CREATE INDEX "idx_audience_generation_jobs_profile_id" ON "audience_generation_jobs"("profile_id");

-- CreateIndex
CREATE INDEX "idx_audience_generation_jobs_recovery" ON "audience_generation_jobs"("status", "locked_until");

-- CreateIndex
CREATE INDEX "idx_agent_journeys_run_status" ON "agent_journeys"("run_id", "status");

-- CreateIndex
CREATE INDEX "idx_agent_journeys_runner_claim" ON "agent_journeys"("run_id", "status", "runner_status", "queue_seq", "created_at");

-- CreateIndex
CREATE INDEX "idx_agent_journeys_actor_user_id" ON "agent_journeys"("actor_user_id");

-- CreateIndex
CREATE INDEX "idx_agent_journeys_platform_account_id" ON "agent_journeys"("platform_account_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_agent_journeys_run_participant_content" ON "agent_journeys"("run_id", "run_participant_id", "content_version_id");

-- CreateIndex
CREATE INDEX "idx_agent_transcript_items_run_journey_seq" ON "agent_transcript_items"("run_id", "journey_id", "seq");

-- CreateIndex
CREATE INDEX "idx_agent_transcript_items_turn_id" ON "agent_transcript_items"("agent_turn_id");

-- CreateIndex
CREATE INDEX "idx_agent_transcript_items_tool_call_id" ON "agent_transcript_items"("agent_tool_call_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_agent_transcript_items_journey_seq" ON "agent_transcript_items"("journey_id", "seq");

-- CreateIndex
CREATE UNIQUE INDEX "ux_agent_transcript_items_tool_call_item_type" ON "agent_transcript_items"("agent_tool_call_id", "item_type");

-- CreateIndex
CREATE INDEX "idx_agent_turns_pending" ON "agent_turns"("run_id", "status", "queue_seq", "created_at");

-- CreateIndex
CREATE INDEX "idx_agent_turns_run_status" ON "agent_turns"("run_id", "status");

-- CreateIndex
CREATE INDEX "idx_agent_turns_participant_id" ON "agent_turns"("run_participant_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_agent_turn_step" ON "agent_turns"("journey_id", "step_index");

-- CreateIndex
CREATE INDEX "idx_agent_turn_contexts_turn_id" ON "agent_turn_contexts"("agent_turn_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_agent_turn_contexts_turn_id" ON "agent_turn_contexts"("agent_turn_id");

-- CreateIndex
CREATE UNIQUE INDEX "agent_tool_calls_idempotency_key_key" ON "agent_tool_calls"("idempotency_key");

-- CreateIndex
CREATE INDEX "idx_agent_tool_calls_turn_sdk_call_id" ON "agent_tool_calls"("agent_turn_id", "sdk_call_id");

-- CreateIndex
CREATE INDEX "idx_agent_tool_calls_run_journey" ON "agent_tool_calls"("run_id", "journey_id");

-- CreateIndex
CREATE INDEX "idx_agent_tool_calls_participant_id" ON "agent_tool_calls"("run_participant_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_agent_tool_calls_turn_index" ON "agent_tool_calls"("agent_turn_id", "call_index");

-- CreateIndex
CREATE INDEX "idx_live_events_run_sequence" ON "live_events"("run_id", "sequence");

-- CreateIndex
CREATE INDEX "idx_live_events_created_at" ON "live_events"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "ux_post_state_content" ON "simulated_post_states"("content_version_id");

-- CreateIndex
CREATE INDEX "idx_social_events_content_type" ON "social_interaction_events"("content_version_id", "interaction_type");

-- CreateIndex
CREATE INDEX "idx_social_events_content_source_time" ON "social_interaction_events"("content_version_id", "source", "simulated_time");

-- CreateIndex
CREATE INDEX "idx_social_events_actor_user_id" ON "social_interaction_events"("actor_user_id");

-- CreateIndex
CREATE INDEX "idx_social_events_platform_account_id" ON "social_interaction_events"("platform_account_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_social_events_action_tool_type" ON "social_interaction_events"("journey_action_id", "tool_call_id", "interaction_type");

-- CreateIndex
CREATE INDEX "idx_social_reactions_content_target_active" ON "social_reactions"("content_version_id", "target_type", "target_id", "active");

-- CreateIndex
CREATE INDEX "idx_social_reactions_content_source_type" ON "social_reactions"("content_version_id", "source", "reaction_type");

-- CreateIndex
CREATE UNIQUE INDEX "ux_social_reactions_content_actor_target" ON "social_reactions"("content_version_id", "actor_user_id", "platform_account_id", "target_type", "target_id", "reaction_type");

-- CreateIndex
CREATE UNIQUE INDEX "ux_loaded_comment_pages_content_actor_cursor" ON "loaded_comment_pages"("content_version_id", "actor_user_id", "platform_account_id", "cursor", "sort");

-- CreateIndex
CREATE INDEX "idx_comments_content_time" ON "simulated_comments"("content_version_id", "simulated_time", "created_at", "id");

-- CreateIndex
CREATE INDEX "idx_comments_content_hot" ON "simulated_comments"("content_version_id", "like_count", "reply_count", "simulated_time", "created_at", "id");

-- CreateIndex
CREATE INDEX "idx_comments_actor_user_id" ON "simulated_comments"("actor_user_id");

-- CreateIndex
CREATE INDEX "idx_comments_platform_account_id" ON "simulated_comments"("platform_account_id");

-- CreateIndex
CREATE INDEX "idx_action_logs_run_time" ON "action_logs"("run_id", "simulated_time");

-- CreateIndex
CREATE INDEX "idx_action_logs_content_time" ON "action_logs"("content_version_id", "simulated_time");

-- CreateIndex
CREATE INDEX "idx_action_logs_participant_id" ON "action_logs"("run_participant_id");

-- CreateIndex
CREATE INDEX "idx_run_logs_run_type_time" ON "run_logs"("run_id", "log_type", "simulated_time", "created_at");

-- CreateIndex
CREATE INDEX "idx_run_logs_run_time" ON "run_logs"("run_id", "simulated_time", "created_at");

-- CreateIndex
CREATE INDEX "idx_insights_content_time" ON "insights"("content_version_id", "simulated_time");

-- CreateIndex
CREATE UNIQUE INDEX "ux_reports_run_id" ON "reports"("run_id");


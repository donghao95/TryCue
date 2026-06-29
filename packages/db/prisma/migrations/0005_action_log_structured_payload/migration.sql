-- AlterTable: action_logs - add structured event fields
ALTER TABLE "action_logs" ADD COLUMN "event_kind" TEXT NOT NULL DEFAULT 'tool_call';
ALTER TABLE "action_logs" ADD COLUMN "event_payload_json" TEXT NOT NULL DEFAULT '{}';

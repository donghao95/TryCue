-- AlterTable: audience_sampling_directives
-- SQLite stores enums as TEXT; group_role defaults to 'unknown'
ALTER TABLE "audience_sampling_directives" ADD COLUMN "group_role" TEXT NOT NULL DEFAULT 'unknown';
ALTER TABLE "audience_sampling_directives" ADD COLUMN "sampling_reason" TEXT NOT NULL DEFAULT '';

-- AlterTable: reports - drop old JSON columns
ALTER TABLE "reports" DROP COLUMN "summary_json";
ALTER TABLE "reports" DROP COLUMN "dimensions_json";
ALTER TABLE "reports" DROP COLUMN "comment_preview_json";
ALTER TABLE "reports" DROP COLUMN "risk_json";
ALTER TABLE "reports" DROP COLUMN "revision_suggestions_json";
ALTER TABLE "reports" DROP COLUMN "evidence_index_json";

-- AlterTable: reports - add new JSON columns
ALTER TABLE "reports" ADD COLUMN "report_output_json" TEXT NOT NULL DEFAULT '{}';
ALTER TABLE "reports" ADD COLUMN "evidence_pack_json" TEXT NOT NULL DEFAULT '{}';

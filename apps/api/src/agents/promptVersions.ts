/**
 * Centralized prompt version constants.
 *
 * Every LLM prompt that is persisted for audit/replay must be versioned here.
 * Bump the version string when the prompt content changes.
 */
export const PROMPT_VERSION_AUDIENCE_PLAN = "audience_generator_v1";
export const PROMPT_VERSION_PROFILE_EXPANSION = "audience_profile_expansion_v1";
export const PROMPT_VERSION_AUDIENCE_PERSONA = "audience_persona_v1";
export const PROMPT_VERSION_SAMPLING_PLAN_REVISION = "audience_sampling_plan_revision_v1";
export const PROMPT_VERSION_SEAT_REVISION = "audience_seat_revision_v1";
export const PROMPT_VERSION_AGENT = "audience_agent_behavior_v1";
/** Legacy v1 — used as fallback for pre-migration AgentTurn records with null promptVersion. */
export const PROMPT_VERSION_AGENT_V1 = "audience_agent_ai_sdk_v1";
/** Legacy report prompt — produced flat summary/dimensions/commentPreview/risks/revisionSuggestions/evidenceIndex. */
export const PROMPT_VERSION_REPORT_V1 = "report_generator_v1";
/** Decision-dashboard report prompt — consumes an EvidencePack and emits a structured ReportOutput. */
export const PROMPT_VERSION_REPORT = "report_decision_dashboard_v1";

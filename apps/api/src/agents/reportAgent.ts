import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { generateText } from "ai";
import { getSharedCapacityManager, getSharedRateLimitedFetch } from "../llm/rateLimitedFetch.js";
import { aiSdkTrace } from "../llm/aiSdkTracing.js";
import { PROMPT_VERSION_REPORT } from "./promptVersions.js";
import {
  ReportOutputSchema,
  type EvidencePack,
  type Recommendation,
  type EvidenceBlocker,
  type ReportOutput
} from "@trycue/shared/report";
import { buildSystemPrompt, buildUserPrompt } from "./reportPrompts.js";
import { coerceReportOutput, parseJsonLoose } from "./reportCoercion.js";
import { assertNoInventedEvidenceRefs, assertNoBannedScoreFields, assertNoRealPlatformClaims } from "./reportGuards.js";

export interface ReportLLMInput {
  runId?: string;
  model: string;
  apiKey: string;
  baseUrl?: string;
  /** Cover image (and any additional post images) to send to the vision-capable report model. */
  imageUrls?: string[];
  /** Compact content snapshot used for the prompt header. */
  contentHeader: { title: string; bodyPreview: string; imageCount: number };
  /** Deterministically-built EvidencePack — the only source of truth the LLM may cite. */
  evidencePack: EvidencePack;
  /** Code-generated recommendation candidate; the LLM may agree or downgrade but cannot upgrade past it. */
  recommendationCandidate: Recommendation;
  /** Code-selected main blocker; the LLM may pick a different one but must justify it. */
  mainBlocker: EvidenceBlocker | null;
}

export interface ReportLLMResult {
  /** Validated, fully-formed ReportOutput. */
  reportOutput: ReportOutput;
  /** Recommendation that was actually emitted in the verdict (always a valid enum value, never `backup_version`). */
  recommendation: Recommendation;
  model: string;
  promptVersion: string;
}

/**
 * Build the report via the decision-dashboard LLM. The LLM receives a deterministically
 * generated EvidencePack and must emit a structured ReportOutput that validates against
 * ReportOutputSchema. The LLM is explicitly told it may only cite evidenceRef ids that
 * already exist in `evidencePack.evidenceIndex`.
 */
export async function generateReportWithLLM(input: ReportLLMInput): Promise<ReportLLMResult> {
  if (!input.apiKey) throw new Error("generateReportWithLLM: apiKey is required");
  if (!input.baseUrl) throw new Error("generateReportWithLLM: baseUrl is required");
  const provider = createOpenAICompatible({
    name: "trycue-report",
    apiKey: input.apiKey,
    baseURL: input.baseUrl,
    fetch: getSharedRateLimitedFetch()
  });

  const evidencePack = input.evidencePack;
  const validEvidenceIds = new Set(Object.keys(evidencePack.evidenceIndex));
  const candidate = input.recommendationCandidate;
  const mainBlocker = input.mainBlocker;

  const systemPrompt = buildSystemPrompt({
    validEvidenceIds,
    recommendationCandidate: candidate,
    mainBlocker
  });
  const userPrompt = buildUserPrompt({
    contentHeader: input.contentHeader,
    evidencePack,
    recommendationCandidate: candidate,
    mainBlocker
  });

  const imageUrls = input.imageUrls?.length ? input.imageUrls : [];

  const result = await generateText({
    model: provider.chatModel(input.model),
    system: systemPrompt,
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: userPrompt },
          ...imageUrls.map((url) => ({
            type: "image" as const,
            image: url
          }))
        ]
      }
    ],
    temperature: 0.3,
    maxRetries: getSharedCapacityManager().getMaxRetries(),
    ...aiSdkTrace({ runId: input.runId, taskType: "report", promptVersion: PROMPT_VERSION_REPORT })
  });

  const raw = result.text || "{}";
  const parsed = parseJsonLoose(raw);
  const reportOutput = coerceReportOutput(parsed, evidencePack, candidate, mainBlocker);

  // Final Zod validation — guarantees the persisted blob conforms to the shared contract.
  // ReportOutputSchema is `.strict()`, so unknown keys (e.g. sneaked-in score fields) fail here.
  const validation = ReportOutputSchema.safeParse(reportOutput);
  if (!validation.success) {
    throw new Error(`ReportOutput schema 校验失败: ${validation.error.issues.map((i) => `${i.path.join(".")}:${i.message}`).join("; ")}`);
  }

  // Reject any report that still claims `backup_version` or invents evidence refs.
  assertNoInventedEvidenceRefs(validation.data, validEvidenceIds);
  // Scan the *raw* LLM JSON (pre-Zod) for banned score/grade patterns that may have
  // been stripped by `.strict()` parsing. Catching them here lets us fail loudly instead
  // of silently dropping the violation.
  assertNoBannedScoreFields(parsed);
  // Scan for forbidden "real platform performance" claims in any string field.
  assertNoRealPlatformClaims(validation.data);

  return {
    reportOutput: validation.data,
    recommendation: validation.data.verdict.recommendation,
    model: input.model,
    promptVersion: PROMPT_VERSION_REPORT
  };
}

// Re-export coercion & guards so existing test imports (`./reportAgent.js`) keep working.
export { coerceReportOutput } from "./reportCoercion.js";
export { assertNoInventedEvidenceRefs, assertNoBannedScoreFields, assertNoRealPlatformClaims } from "./reportGuards.js";

import type {
  AgentToolCall,
  AgentTranscriptItem,
  AgentTurn,
  ContentVersion,
  Prisma,
  SimulatedPostState
} from "@trycue/db";
import type { ToolName } from "@trycue/shared";
import type { ModelMessage } from "ai";
import type { ParsedToolCall } from "../agents/types.js";
import { prepareModelImageUrls } from "./modelImages.js";

/** All tools available to the agent — no session-based filtering. */
export const ALL_TOOLS: ToolName[] = [
  "open_post",
  "read_post",
  "view_comments",
  "like_post",
  "favorite_post",
  "share_post",
  "write_comment",
  "like_comment",
  "exit_browsing"
];

type AppendItemInput = {
  itemType: "initial_observation" | "assistant_message" | "assistant_tool_calls" | "tool_result" | "system_notice";
  agentTurnId?: string | null;
  toolCallId?: string | null;
  content?: string | null;
  reasoningContent?: string | null;
  observationJson?: Prisma.InputJsonValue | null;
  toolCallsJson?: Prisma.InputJsonValue | null;
  toolResultJson?: Prisma.InputJsonValue | null;
  metadataJson?: Prisma.InputJsonValue;
};

export async function appendInitialObservation(
  tx: Prisma.TransactionClient,
  journeyId: string,
  runId: string,
  observationJson: Prisma.InputJsonValue
) {
  return appendTranscriptItem(tx, journeyId, runId, {
    itemType: "initial_observation",
    observationJson
  });
}

export async function appendAssistantMessageItem(
  tx: Prisma.TransactionClient,
  journeyId: string,
  runId: string,
  action: AgentTurn,
  content: string,
  metadataJson: Prisma.InputJsonValue,
  options?: { reasoningContent?: string | null; toolCalls?: ParsedToolCall[] }
) {
  return appendTranscriptItem(tx, journeyId, runId, {
    itemType: "assistant_message",
    agentTurnId: action.id,
    content,
    reasoningContent: options?.reasoningContent ?? null,
    toolCallsJson: options?.toolCalls?.length ? (options.toolCalls as unknown as Prisma.InputJsonValue) : undefined,
    metadataJson
  });
}

export async function appendAssistantToolCallsItem(
  tx: Prisma.TransactionClient,
  journeyId: string,
  runId: string,
  action: AgentTurn,
  toolCalls: ParsedToolCall[],
  metadataJson: Prisma.InputJsonValue
) {
  return appendTranscriptItem(tx, journeyId, runId, {
    itemType: "assistant_tool_calls",
    agentTurnId: action.id,
    toolCallsJson: toolCalls as unknown as Prisma.InputJsonValue,
    metadataJson
  });
}

export async function appendToolResultItem(
  tx: Prisma.TransactionClient,
  action: AgentTurn,
  toolCall: AgentToolCall
) {
  return appendTranscriptItem(tx, action.journeyId, action.runId, {
    itemType: "tool_result",
    agentTurnId: action.id,
    toolCallId: toolCall.id,
    toolResultJson: toolCall.output as Prisma.InputJsonValue,
    metadataJson: {
      toolName: toolCall.toolName,
      callIndex: toolCall.callIndex,
      sdkCallId: toolCall.sdkCallId,
      status: toolCall.status
    } as Prisma.InputJsonValue
  });
}

export async function appendSystemNoticeItem(
  tx: Prisma.TransactionClient,
  journeyId: string,
  runId: string,
  content: string,
  metadataJson: Prisma.InputJsonValue = {}
) {
  return appendTranscriptItem(tx, journeyId, runId, {
    itemType: "system_notice",
    content,
    metadataJson
  });
}

export async function loadJourneyTranscript(
  tx: Prisma.TransactionClient,
  journeyId: string
): Promise<AgentTranscriptItem[]> {
  return tx.agentTranscriptItem.findMany({
    where: { journeyId },
    orderBy: { seq: "asc" }
  });
}

export async function renderSessionMessages(
  items: AgentTranscriptItem[],
  options?: { uploadDir?: string }
): Promise<ModelMessage[]> {
  const messages: ModelMessage[] = [];
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index]!;
    if (item.itemType === "initial_observation" || item.itemType === "system_notice") {
      const raw = item.itemType === "initial_observation"
        ? await observationMessageContent(item.observationJson, "当前 observation", options)
        : item.content ?? "";
      if (typeof raw === "string") {
        messages.push({ role: "user", content: raw });
      } else {
        // multimodal: convert image_url parts to AI SDK image parts
        const content = raw.map((part: { type: string; text?: string; image_url?: { url: string } }) => {
          if (part.type === "image_url" && part.image_url?.url) {
            return { type: "image" as const, image: part.image_url.url };
          }
          return { type: "text" as const, text: part.text ?? "" };
        });
        messages.push({ role: "user", content });
      }
      continue;
    }
    if (item.itemType === "assistant_message") {
      // Build content parts for this assistant message
      const parts: Array<
        | { type: "text"; text: string }
        | { type: "reasoning"; text: string }
        | { type: "tool-call"; toolCallId: string; toolName: string; input: unknown }
      > = [];
      if (item.content) {
        parts.push({ type: "text", text: item.content });
      }
      if (item.reasoningContent) {
        parts.push({ type: "reasoning", text: item.reasoningContent });
      }
      // Inline toolCallsJson on the assistant_message item
      const inlineCalls = parseToolCalls(item.toolCallsJson);
      for (const tc of inlineCalls) {
        parts.push({
          type: "tool-call",
          toolCallId: tc.sdkCallId ?? `call_${tc.callIndex ?? 0}`,
          toolName: tc.toolName,
          input: tc.args
        });
      }
      // Merge next assistant_tool_calls item if same turn
      const next = items[index + 1];
      if (next?.itemType === "assistant_tool_calls" && next.agentTurnId === item.agentTurnId) {
        const nextCalls = parseToolCalls(next.toolCallsJson);
        for (const tc of nextCalls) {
          parts.push({
            type: "tool-call",
            toolCallId: tc.sdkCallId ?? `call_${tc.callIndex ?? 0}`,
            toolName: tc.toolName,
            input: tc.args
          });
        }
        index += 1; // skip the merged item
      }
      if (parts.length === 1 && parts[0]!.type === "text") {
        messages.push({ role: "assistant", content: parts[0]!.text });
      } else if (parts.length > 0) {
        messages.push({ role: "assistant", content: parts });
      }
      continue;
    }
    if (item.itemType === "assistant_tool_calls") {
      // Orphan tool_calls item (old data, no preceding assistant_message in same turn)
      const calls = parseToolCalls(item.toolCallsJson);
      const parts = calls.map((tc) => ({
        type: "tool-call" as const,
        toolCallId: tc.sdkCallId ?? `call_${tc.callIndex ?? 0}`,
        toolName: tc.toolName,
        input: tc.args
      }));
      if (parts.length > 0) {
        messages.push({ role: "assistant", content: parts });
      }
      continue;
    }
    if (item.itemType === "tool_result") {
      const metadata = objectRecord(item.metadataJson);
      const toolCallId = stringValue(metadata.sdkCallId) ?? item.toolCallId ?? "unknown_call";
      const toolName = stringValue(metadata.toolName) ?? "unknown_tool";
      const output = item.toolResultJson ?? {};
      // Keep tool results JSON-only. AI SDK serializes OpenAI-compatible tool
      // output content into tool.content text, so image data URLs here would be
      // tokenized as huge base64 strings instead of provider-native images.
      messages.push({
        role: "tool" as const,
        content: [{
          type: "tool-result" as const,
          toolCallId,
          toolName,
          output: { type: "json" as const, value: output as never }
        }]
      });
    }
  }
  return messages;
}

export function contentImageUrls(imageUrlsJson: unknown, coverImageUrl: string | null): string[] {
  const stored = Array.isArray(imageUrlsJson) ? imageUrlsJson : [];
  const urls = [...stored, coverImageUrl]
    .filter((value): value is string => typeof value === "string")
    .map((value) => value.trim())
    .filter(Boolean);
  return [...new Set(urls)];
}

export function buildFeedObservation(contentVersion: ContentVersion, postState: SimulatedPostState) {
  // Runtime vision input is injected once at journey start as a user
  // observation. This preserves image semantics and avoids carrying images
  // through tool results, where OpenAI-compatible providers treat them as text.
  const imageUrls = contentImageUrls(contentVersion.imageUrlsJson, contentVersion.coverImageUrl);
  return {
    post: {
      title: contentVersion.title,
      author: postAuthor(),
      coverImageUrl: imageUrls[0] ?? null,
      imageUrls,
      bodyPreview: previewText(contentVersion.bodyText),
      feedCounts: feedCounts(postState)
    }
  };
}

export function buildPostObservation(
  contentVersion: ContentVersion,
  postState: SimulatedPostState,
  viewerState: { liked: boolean; favorited: boolean }
) {
  return {
    post: {
      title: contentVersion.title,
      author: postAuthor(),
      bodyText: contentVersion.bodyText,
      postState: {
        ...postCounts(postState),
        viewer: viewerState
      }
    }
  };
}

// ── Internal helpers ──

async function appendTranscriptItem(
  tx: Prisma.TransactionClient,
  journeyId: string,
  runId: string,
  input: AppendItemInput
) {
  // Atomic increment to guarantee unique seq under concurrency
  const updated = await tx.agentJourney.update({
    where: { id: journeyId },
    data: { lastTranscriptSeq: { increment: 1 } },
    select: { lastTranscriptSeq: true }
  });
  return tx.agentTranscriptItem.create({
    data: {
      runId,
      journeyId,
      agentTurnId: input.agentTurnId ?? null,
      toolCallId: input.toolCallId ?? null,
      seq: updated.lastTranscriptSeq,
      itemType: input.itemType,
      content: input.content ?? null,
      reasoningContent: input.reasoningContent ?? null,
      observationJson: input.observationJson ?? undefined,
      toolCallsJson: input.toolCallsJson ?? undefined,
      toolResultJson: input.toolResultJson ?? undefined,
      metadataJson: input.metadataJson ?? {}
    }
  });
}

async function observationMessageContent(observation: unknown, label: string, options?: { uploadDir?: string }) {
  const record = objectRecord(observation);
  const images = options?.uploadDir
    ? await prepareModelImageUrls(imageUrlsForObservation(record), options.uploadDir)
    : imageUrlsForObservation(record);
  const text = `${label}:\n${JSON.stringify(record, null, 2)}`;
  if (!images.length) return text;
  return [
    { type: "text" as const, text },
    ...images.map((url) => ({
      type: "image_url" as const,
      image_url: { url }
    }))
  ];
}

function imageUrlsForObservation(observation: Record<string, unknown>) {
  const post = objectRecord(observation.post);
  const imageUrls = Array.isArray(post.imageUrls)
    ? post.imageUrls.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    : [];
  if (imageUrls.length) return [...new Set(imageUrls.map((value) => value.trim()))];
  const cover = stringValue(post.coverImageUrl);
  return cover ? [cover] : [];
}

function previewText(value: string) {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > 120 ? `${normalized.slice(0, 120)}...` : normalized;
}

function postAuthor() {
  return {
    displayName: "陈琳",
    accountLabel: "家居研究所"
  };
}

function feedCounts(state: SimulatedPostState) {
  return {
    likeCount: state.likeCount,
    favoriteCount: state.favoriteCount,
    commentCount: state.commentCount
  };
}

function postCounts(state: SimulatedPostState) {
  return {
    exposureCount: state.exposureCount,
    openCount: state.openCount,
    likeCount: state.likeCount,
    favoriteCount: state.favoriteCount,
    commentCount: state.commentCount,
    shareCount: state.shareCount,
    exitCount: state.exitCount
  };
}

function parseToolCalls(value: unknown): ParsedToolCall[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => objectRecord(item))
    .map((item) => {
      const call: ParsedToolCall = {
        toolName: stringValue(item.toolName) as ToolName,
        args: objectRecord(item.args),
        sdkCallId: stringValue(item.sdkCallId) ?? undefined
      };
      if (typeof item.callIndex === "number") call.callIndex = item.callIndex;
      if (stringValue(item.idempotencyKey)) call.idempotencyKey = stringValue(item.idempotencyKey)!;
      if (item.rawToolCall && typeof item.rawToolCall === "object") call.rawToolCall = objectRecord(item.rawToolCall);
      return call;
    })
    .filter((item) => Boolean(item.toolName));
}

function objectRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

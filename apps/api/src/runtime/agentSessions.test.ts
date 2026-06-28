import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { AgentTranscriptItem } from "@trycue/db";
import { renderSessionMessages } from "./agentSessions.js";

let uploadDir: string;

beforeAll(async () => {
  uploadDir = join(tmpdir(), `agentSessions-test-${Date.now()}`);
  await mkdir(uploadDir, { recursive: true });
  // Create a tiny 1x1 PNG
  const pngHeader = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
    0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
    0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53,
    0xde, 0x00, 0x00, 0x00, 0x0c, 0x49, 0x44, 0x41,
    0x54, 0x08, 0xd7, 0x63, 0xf8, 0xcf, 0xc0, 0x00,
    0x00, 0x00, 0x02, 0x00, 0x01, 0xe2, 0x21, 0xbc,
    0x33, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e,
    0x44, 0xae, 0x42, 0x60, 0x82
  ]);
  await writeFile(join(uploadDir, "cover.png"), pngHeader);
  await writeFile(join(uploadDir, "detail1.png"), pngHeader);
});

afterAll(async () => {
  await rm(uploadDir, { recursive: true, force: true });
});

function makeItem(overrides: Partial<AgentTranscriptItem>): AgentTranscriptItem {
  return {
    id: "item-" + Math.random().toString(36).slice(2, 8),
    runId: "run-1",
    journeyId: "journey-1",
    agentTurnId: "turn-1",
    toolCallId: null,
    seq: 1,
    itemType: "initial_observation",
    content: null,
    reasoningContent: null,
    observationJson: null,
    toolCallsJson: null,
    toolResultJson: null,
    metadataJson: {},
    createdAt: new Date(),
    ...overrides
  };
}

describe("renderSessionMessages", () => {
  it("renders all initial observation imageUrls as image parts", async () => {
    const items: AgentTranscriptItem[] = [
      makeItem({
        itemType: "initial_observation",
        seq: 1,
        observationJson: {
          post: {
            title: "Test Post",
            coverImageUrl: "/uploads/cover.png",
            imageUrls: ["/uploads/cover.png", "/uploads/detail1.png"],
            bodyPreview: "Body preview"
          }
        }
      })
    ];

    const messages = await renderSessionMessages(items, { uploadDir });
    expect(messages).toHaveLength(1);
    const content = messages[0]!.content;
    expect(Array.isArray(content)).toBe(true);
    const imageParts = (content as Array<Record<string, unknown>>).filter((part) => part.type === "image");
    expect(imageParts).toHaveLength(2);
    expect(imageParts.map((part) => part.image)).toEqual([
      expect.stringMatching(/^data:image\/png;base64,/),
      expect.stringMatching(/^data:image\/png;base64,/)
    ]);
  });

  it("keeps tool result image URLs as JSON only when uploadDir is provided", async () => {
    const items: AgentTranscriptItem[] = [
      makeItem({
        itemType: "tool_result",
        seq: 5,
        toolCallId: "call-open-post",
        metadataJson: { sdkCallId: "call-open-post", toolName: "open_post" },
        toolResultJson: {
          ok: true,
          postId: "post-1",
          post: {
            postId: "post-1",
            title: "Test Post",
            bodyText: "Body text",
            postState: { likeCount: 0 }
          },
          imageUrls: ["/uploads/cover.png", "/uploads/detail1.png"],
          transition: "post_detail_observed"
        }
      })
    ];

    const messages = await renderSessionMessages(items, { uploadDir });
    expect(messages).toHaveLength(1);

    const toolMsg = messages[0]!;
    expect(toolMsg.role).toBe("tool");
    expect(Array.isArray(toolMsg.content)).toBe(true);

    const parts = toolMsg.content as Array<Record<string, unknown>>;
    expect(parts[0]).toMatchObject({ type: "tool-result", toolCallId: "call-open-post" });
    expect(JSON.stringify(parts[0])).toContain("/uploads/cover.png");
    expect(JSON.stringify(messages)).not.toContain("data:image");
  });

  it("does not add image parts when uploadDir is not provided", async () => {
    const items: AgentTranscriptItem[] = [
      makeItem({
        itemType: "tool_result",
        seq: 5,
        toolCallId: "call-open-post",
        metadataJson: { sdkCallId: "call-open-post", toolName: "open_post" },
        toolResultJson: {
          ok: true,
          imageUrls: ["/uploads/cover.png", "/uploads/detail1.png"]
        }
      })
    ];

    const messages = await renderSessionMessages(items);
    const parts = messages[0]!.content as Array<Record<string, unknown>>;
    const imageParts = parts.filter((p) => p.type === "image");
    expect(imageParts).toHaveLength(0);
  });

  it("does not add image parts when tool result has no imageUrls", async () => {
    const items: AgentTranscriptItem[] = [
      makeItem({
        itemType: "tool_result",
        seq: 5,
        toolCallId: "call-like",
        metadataJson: { sdkCallId: "call-like", toolName: "like_post" },
        toolResultJson: { ok: true, status: "liked", liked: true, likeCount: 1 }
      })
    ];

    const messages = await renderSessionMessages(items, { uploadDir });
    const parts = messages[0]!.content as Array<Record<string, unknown>>;
    expect(parts).toHaveLength(1);
    expect(parts[0]).toMatchObject({ type: "tool-result" });
  });
});

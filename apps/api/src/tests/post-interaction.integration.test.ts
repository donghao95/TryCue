import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@trycue/db";
import { buildApp } from "../app.js";
import { loadConfig } from "../config.js";
import {
  cleanupIntegrationTest,
  integrationLlmConfigPath,
  prepareAudienceReady
} from "./helpers.js";

describe("post interaction integration", () => {
  const llmConfigPath = integrationLlmConfigPath;

  beforeEach(cleanupIntegrationTest);

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("returns frontend comment like state and supports idempotent unlike", async () => {
    const app = await buildApp({ ...loadConfig(), appEnv: "test", llmConfigPath, enableScheduler: false });
    const create = await app.inject({
      method: "POST",
      url: "/api/runs",
      payload: {
        title: "评论点赞测试",
        coverImageUrl: "/uploads/test.png",
        bodyText: "这是一段超过二十个字的正文，用来测试前端用户评论点赞和取消点赞。",
        scale: "quick"
      }
    });
    expect(create.statusCode).toBe(200);
    const runId = create.json().data.runId as string;
    const commentResponse = await app.inject({
      method: "POST",
      url: `/api/runs/${runId}/comments`,
      payload: { content: "这条评论用于测试点赞状态" }
    });
    expect(commentResponse.statusCode).toBe(200);
    const commentId = commentResponse.json().data.comment.id as string;

    const liked = await app.inject({
      method: "POST",
      url: `/api/runs/${runId}/comments/${commentId}/like`,
      payload: { active: true }
    });
    expect(liked.statusCode).toBe(200);
    expect(liked.json().data.comment).toMatchObject({ id: commentId, likeCount: 1, likedByMe: true });
    const likeUpdateEvent = await prisma.liveEvent.findFirstOrThrow({
      where: { runId, eventType: "comment.updated" },
      orderBy: { sequence: "desc" }
    });
    const likeUpdatePayload = likeUpdateEvent.payload as Record<string, unknown>;
    expect(likeUpdatePayload.commentId).toBe(commentId);
    expect(likeUpdatePayload.comment).toBeUndefined();
    expect(likeUpdatePayload.patch).toMatchObject({ likeCount: 1, replyCount: 0 });

    const listAfterLike = await app.inject({ method: "GET", url: `/api/runs/${runId}/comments` });
    expect(listAfterLike.statusCode).toBe(200);
    expect(listAfterLike.json().data.comments[0]).toMatchObject({ id: commentId, likeCount: 1, likedByMe: true });

    const unliked = await app.inject({
      method: "POST",
      url: `/api/runs/${runId}/comments/${commentId}/like`,
      payload: { active: false }
    });
    expect(unliked.statusCode).toBe(200);
    expect(unliked.json().data.comment).toMatchObject({ id: commentId, likeCount: 0, likedByMe: false });

    const repeatedUnlike = await app.inject({
      method: "POST",
      url: `/api/runs/${runId}/comments/${commentId}/like`,
      payload: { active: false }
    });
    expect(repeatedUnlike.statusCode).toBe(200);
    expect(repeatedUnlike.json().data.comment).toMatchObject({ id: commentId, likeCount: 0, likedByMe: false });
    const content = await prisma.contentVersion.findUniqueOrThrow({ where: { runId } });
    expect(await prisma.socialReaction.count({ where: { contentVersionId: content.id, targetType: "comment", targetId: commentId, reactionType: "like" } })).toBe(1);

    await app.close();
  });

  it("starts after a frontend post interaction has already created post state", async () => {
    const app = await buildApp({ ...loadConfig(), appEnv: "test", llmConfigPath, enableScheduler: false });
    const create = await app.inject({
      method: "POST",
      url: "/api/runs",
      payload: {
        title: "启动前互动测试",
        coverImageUrl: "/uploads/test.png",
        bodyText: "这是一段超过二十个字的正文，用来测试启动前用户互动不会阻塞试映启动。",
        scale: "quick"
      }
    });
    expect(create.statusCode).toBe(200);
    const runId = create.json().data.runId as string;
    const liked = await app.inject({
      method: "POST",
      url: `/api/runs/${runId}/post/like`,
      payload: { active: true }
    });
    expect(liked.statusCode).toBe(200);

    await prepareAudienceReady(app, runId);
    const startResponse = await app.inject({
      method: "POST",
      url: `/api/runs/${runId}/start`,
      payload: { force: false }
    });
    expect(startResponse.statusCode).toBe(200);
    const content = await prisma.contentVersion.findUniqueOrThrow({ where: { runId } });
    const postState = await prisma.simulatedPostState.findUniqueOrThrow({ where: { contentVersionId: content.id } });
    expect(postState.likeCount).toBe(1);
    expect(postState.currentPhase).toBe("running");

    await app.close();
  });

  it("enforces unique image URLs within one content version", async () => {
    const app = await buildApp({ ...loadConfig(), appEnv: "test", llmConfigPath, enableScheduler: false });
    const create = await app.inject({
      method: "POST",
      url: "/api/runs",
      payload: {
        title: "图片引用唯一约束测试",
        coverImageUrl: "/uploads/test.png",
        bodyText: "这是一段超过二十个字的正文，用来验证同一内容版本不能重复引用同一个图片 URL。",
        scale: "quick"
      }
    });
    expect(create.statusCode).toBe(200);
    const runId = create.json().data.runId as string;
    const content = await prisma.contentVersion.findUniqueOrThrow({ where: { runId } });
    const image = await prisma.contentVersionImage.findFirstOrThrow({ where: { contentVersionId: content.id } });

    await expect(prisma.contentVersionImage.create({
      data: {
        contentVersionId: content.id,
        assetId: image.assetId,
        url: image.url,
        sortOrder: image.sortOrder + 1
      }
    })).rejects.toMatchObject({ code: "P2002" });

    await app.close();
  });

  it("tracks frontend post reaction state and makes share idempotent", async () => {
    const app = await buildApp({ ...loadConfig(), appEnv: "test", llmConfigPath, enableScheduler: false });
    const create = await app.inject({
      method: "POST",
      url: "/api/runs",
      payload: {
        title: "帖子互动状态测试",
        coverImageUrl: "/uploads/test.png",
        bodyText: "这是一段超过二十个字的正文，用来测试前端用户点赞收藏分享状态。",
        scale: "quick"
      }
    });
    expect(create.statusCode).toBe(200);
    const runId = create.json().data.runId as string;

    const liked = await app.inject({
      method: "POST",
      url: `/api/runs/${runId}/post/like`,
      payload: { active: true }
    });
    expect(liked.statusCode).toBe(200);
    expect(liked.json().data.postState).toMatchObject({ likeCount: 1, likedByMe: true });

    const unliked = await app.inject({
      method: "POST",
      url: `/api/runs/${runId}/post/like`,
      payload: { active: false }
    });
    expect(unliked.statusCode).toBe(200);
    expect(unliked.json().data.postState).toMatchObject({ likeCount: 0, likedByMe: false });

    const favorited = await app.inject({
      method: "POST",
      url: `/api/runs/${runId}/post/favorite`,
      payload: { active: true }
    });
    expect(favorited.statusCode).toBe(200);
    expect(favorited.json().data.postState).toMatchObject({ favoriteCount: 1, favoritedByMe: true });

    const unfavorited = await app.inject({
      method: "POST",
      url: `/api/runs/${runId}/post/favorite`,
      payload: { active: false }
    });
    expect(unfavorited.statusCode).toBe(200);
    expect(unfavorited.json().data.postState).toMatchObject({ favoriteCount: 0, favoritedByMe: false });

    const shared = await app.inject({ method: "POST", url: `/api/runs/${runId}/post/share` });
    expect(shared.statusCode).toBe(200);
    expect(shared.json().data.postState).toMatchObject({ shareCount: 1, sharedByMe: true });

    const repeatedShare = await app.inject({ method: "POST", url: `/api/runs/${runId}/post/share` });
    expect(repeatedShare.statusCode).toBe(200);
    expect(repeatedShare.json().data.postState).toMatchObject({ shareCount: 1, sharedByMe: true });

    const state = await app.inject({ method: "GET", url: `/api/runs/${runId}/post-state` });
    expect(state.statusCode).toBe(200);
    expect(state.json().data.postState).toMatchObject({
      likeCount: 0,
      likedByMe: false,
      favoriteCount: 0,
      favoritedByMe: false,
      shareCount: 1,
      sharedByMe: true
    });

    await app.close();
  });

  it("returns validation error when uploaded image exceeds the API file limit", async () => {
    const app = await buildApp({ ...loadConfig(), appEnv: "test", llmConfigPath, enableScheduler: false });
    const boundary = "----trycue-upload-limit-test";
    const head = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="too-large.png"\r\nContent-Type: image/png\r\n\r\n`);
    const fileBytes = Buffer.alloc(6 * 1024 * 1024, 0x61);
    const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
    const payload = Buffer.concat([head, fileBytes, tail]);

    const response = await app.inject({
      method: "POST",
      url: "/api/upload",
      headers: {
        "content-type": `multipart/form-data; boundary=${boundary}`,
        "content-length": String(payload.length)
      },
      payload
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("VALIDATION_ERROR");
    await app.close();
  });
});

import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@trycue/db";
import { buildApp } from "../app.js";
import { loadConfig } from "../config.js";
import { recordLiveEvent } from "../liveEvents.js";
import {
  cleanupIntegrationTest,
  integrationLlmConfigPath
} from "./helpers.js";

describe("live events integration", () => {
  const llmConfigPath = integrationLlmConfigPath;

  beforeEach(cleanupIntegrationTest);

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("returns latestLiveEventSequence in run overview", async () => {
    const app = await buildApp({ ...loadConfig(), appEnv: "test", llmConfigPath, enableScheduler: false });
    const create = await app.inject({
      method: "POST",
      url: "/api/runs",
      payload: {
        title: "事件序列测试",
        coverImageUrl: "/uploads/test.png",
        bodyText: "这是一段超过二十个字的正文，用于验证 overview 返回 latestLiveEventSequence。",
        scale: "quick"
      }
    });
    expect(create.statusCode).toBe(200);
    const runId = create.json().data.runId as string;

    const beforeEvents = await app.inject({ method: "GET", url: `/api/runs/${runId}` });
    expect(beforeEvents.statusCode).toBe(200);
    expect(beforeEvents.json().data.latestLiveEventSequence).toBeNull();

    await prisma.liveEvent.create({
      data: { runId, eventType: "run.started", payload: { type: "run.started", runId, eventId: "0", createdAt: new Date().toISOString() } }
    });
    await prisma.liveEvent.create({
      data: { runId, eventType: "run_log.created", payload: { type: "run_log.created", runId, eventId: "0", createdAt: new Date().toISOString() } }
    });

    const afterEvents = await app.inject({ method: "GET", url: `/api/runs/${runId}` });
    expect(afterEvents.statusCode).toBe(200);
    const latestSeq = afterEvents.json().data.latestLiveEventSequence as string;
    expect(latestSeq).toBeTruthy();
    const allEvents = await prisma.liveEvent.findMany({ where: { runId }, orderBy: { sequence: "desc" }, take: 1 });
    expect(allEvents).toHaveLength(1);
    expect(latestSeq).toBe(allEvents[0]!.sequence.toString());

    await app.close();
  });

  it("returns only events after the given sequence via listLiveEvents", async () => {
    const app = await buildApp({ ...loadConfig(), appEnv: "test", llmConfigPath, enableScheduler: false });
    const create = await app.inject({
      method: "POST",
      url: "/api/runs",
      payload: {
        title: "SSE after 查询测试",
        coverImageUrl: "/uploads/test.png",
        bodyText: "这是一段超过二十个字的正文，用于验证 SSE ?after= 查询只返回之后的事件。",
        scale: "quick"
      }
    });
    expect(create.statusCode).toBe(200);
    const runId = create.json().data.runId as string;

    const ev1 = await prisma.liveEvent.create({
      data: { runId, eventType: "run.started", payload: { type: "run.started", runId, eventId: "0", createdAt: new Date().toISOString() } }
    });
    const ev2 = await prisma.liveEvent.create({
      data: { runId, eventType: "run_log.created", payload: { type: "run_log.created", runId, eventId: "0", createdAt: new Date().toISOString() } }
    });
    const ev3 = await prisma.liveEvent.create({
      data: { runId, eventType: "run.completed", payload: { type: "run.completed", runId, eventId: "0", createdAt: new Date().toISOString() } }
    });

    const { listLiveEvents } = await import("../liveEvents.js");

    const allEvents = await listLiveEvents(runId);
    expect(allEvents).toHaveLength(3);
    expect(allEvents.map((e) => e.eventType)).toEqual(["run.started", "run_log.created", "run.completed"]);

    const afterFirst = await listLiveEvents(runId, ev1.sequence.toString());
    expect(afterFirst).toHaveLength(2);
    expect(afterFirst[0]!.sequence).toBe(ev2.sequence.toString());
    expect(afterFirst[1]!.sequence).toBe(ev3.sequence.toString());

    const afterSecond = await listLiveEvents(runId, ev2.sequence.toString());
    expect(afterSecond).toHaveLength(1);
    expect(afterSecond[0]!.eventType).toBe("run.completed");

    const afterLast = await listLiveEvents(runId, ev3.sequence.toString());
    expect(afterLast).toHaveLength(0);

    const afterUndefined = await listLiveEvents(runId, undefined);
    expect(afterUndefined).toHaveLength(3);

    await app.close();
  });

  it("guards durable live_events from debug events and malformed plan frames", async () => {
    const app = await buildApp({ ...loadConfig(), appEnv: "test", llmConfigPath, enableScheduler: false });
    const create = await app.inject({
      method: "POST",
      url: "/api/runs",
      payload: {
        title: "事件分层测试",
        coverImageUrl: "/uploads/test.png",
        bodyText: "这是一段超过二十个字的正文，用于验证 durable live_events 的事件分层边界。",
        scale: "quick"
      }
    });
    expect(create.statusCode).toBe(200);
    const runId = create.json().data.runId as string;

    await expect(recordLiveEvent(prisma, {
      runId,
      eventType: "audience.plan.reasoning.delta",
      payload: { jobId: "job-1", delta: "debug token" } as never
    })).rejects.toThrow("not allowed in durable live_events");

    await expect(recordLiveEvent(prisma, {
      runId,
      eventType: "audience.plan.frame",
      payload: { jobId: "job-1", frame: {}, preview: {} } as never
    })).rejects.toThrow("frameSeq");

    const frameEvent = await recordLiveEvent(prisma, {
      runId,
      eventType: "audience.plan.frame",
      payload: { jobId: "job-1", previewId: "job-1", frameSeq: 0, frame: {}, preview: {} } as never
    });
    expect(frameEvent.eventType).toBe("audience.plan.frame");
    expect(await prisma.liveEvent.count({ where: { runId } })).toBe(1);

    await app.close();
  });
});

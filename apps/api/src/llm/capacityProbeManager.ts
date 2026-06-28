import { randomUUID } from "node:crypto";
import type {
  LlmCapacityProbeJobStartView,
  LlmCapacityProbeJobView,
  LlmCapacityProbeRequest,
  LlmCapacityProbeResult
} from "@trycue/shared";
import {
  PROBE_MAX_TOTAL_MS,
  ProbeCancelledError,
  probeLlmCapacity,
  type ProbeProgress
} from "./capacityProbe.js";
import { log } from "../logger.js";

type ProbeJobRecord = LlmCapacityProbeJobView & {
  controller: AbortController;
  startedAt: number;
  updatedAt: number;
};

type StartProbeInput = {
  apiKey: string;
  baseUrl: string;
  model: string;
  request: LlmCapacityProbeRequest;
  hardMaxRpm: number;
  hardMaxConcurrency: number;
};

export class LlmCapacityProbeManager {
  private jobs = new Map<string, ProbeJobRecord>();

  start(input: StartProbeInput): LlmCapacityProbeJobStartView {
    const active = [...this.jobs.values()].find((job) => job.status === "running");
    if (active) {
      throw new ProbeAlreadyRunningError(active.id);
    }

    this.cleanup();
    const id = randomUUID();
    const controller = new AbortController();
    const now = Date.now();
    const job: ProbeJobRecord = {
      id,
      status: "running",
      phase: "starting",
      currentRpm: 0,
      currentConcurrency: 0,
      currentLevelSentRequests: 0,
      currentLevelSuccessfulRequests: 0,
      currentLevelFailedRequests: 0,
      currentLevelInputTokens: 0,
      currentLevelOutputTokens: 0,
      currentLevelTotalTokens: 0,
      currentLevelAvgLatencyMs: 0,
      currentLevelElapsedMs: 0,
      currentLevelDurationMs: 0,
      cooldownRemainingMs: 0,
      cooldownTotalMs: 0,
      sentRequests: 0,
      elapsedMs: 0,
      maxElapsedMs: PROBE_MAX_TOTAL_MS,
      successfulRequests: 0,
      failedRequests: 0,
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      stableRpm: 0,
      stableConcurrency: 1,
      levels: [],
      message: "准备开始校准",
      controller,
      startedAt: now,
      updatedAt: now
    };
    this.jobs.set(id, job);

    void this.run(job, input);
    return { jobId: id, status: job.status };
  }

  get(id: string): LlmCapacityProbeJobView | null {
    const job = this.jobs.get(id);
    return job ? this.view(job) : null;
  }

  cancel(id: string): LlmCapacityProbeJobView | null {
    const job = this.jobs.get(id);
    if (!job) return null;
    if (job.status !== "running") return this.view(job);
    job.status = "cancelled";
    job.phase = "done";
    job.message = "校准已取消";
    job.updatedAt = Date.now();
    job.elapsedMs = job.updatedAt - job.startedAt;
    job.controller.abort();
    return this.view(job);
  }

  private async run(job: ProbeJobRecord, input: StartProbeInput): Promise<void> {
    try {
      const probeLimits = input.request.mode === "high_quota"
        ? { maxRpm: 300, maxConcurrency: 16, startConcurrency: 4 }
        : input.request.mode === "custom"
          ? { maxRpm: input.request.maxRpm ?? 60, maxConcurrency: input.request.maxConcurrency ?? 4, startConcurrency: Math.min(input.request.maxConcurrency ?? 4, 4) }
          : { maxRpm: 60, maxConcurrency: 4, startConcurrency: 2 };

      const maxConcurrency = Math.min(probeLimits.maxConcurrency, input.hardMaxConcurrency);
      const result = await probeLlmCapacity(
        {
          apiKey: input.apiKey,
          baseUrl: input.baseUrl,
          model: input.model,
          maxConcurrency,
          startConcurrency: Math.min(probeLimits.startConcurrency, maxConcurrency)
        },
        {
          signal: job.controller.signal,
          onProgress: (progress) => this.updateProgress(job, progress)
        }
      );
      if (job.status === "cancelled") return;
      this.complete(job, result);
    } catch (error) {
      if (error instanceof ProbeCancelledError || job.controller.signal.aborted || job.status === "cancelled") {
        this.cancel(job.id);
        return;
      }
      job.status = "failed";
      job.phase = "done";
      job.error = error instanceof Error ? error.message : String(error);
      job.message = "校准失败";
      job.updatedAt = Date.now();
      job.elapsedMs = job.updatedAt - job.startedAt;
      log.warn({ err: error, jobId: job.id }, "[probe] calibration job failed");
    }
  }

  private updateProgress(job: ProbeJobRecord, progress: ProbeProgress): void {
    if (job.status !== "running") return;
    job.phase = progress.phase;
    job.currentRpm = progress.currentRpm;
    job.currentConcurrency = progress.currentConcurrency;
    job.currentLevelSentRequests = progress.currentLevelSentRequests;
    job.currentLevelSuccessfulRequests = progress.currentLevelSuccessfulRequests;
    job.currentLevelFailedRequests = progress.currentLevelFailedRequests;
    job.currentLevelInputTokens = progress.currentLevelInputTokens;
    job.currentLevelOutputTokens = progress.currentLevelOutputTokens;
    job.currentLevelTotalTokens = progress.currentLevelTotalTokens;
    job.currentLevelAvgLatencyMs = progress.currentLevelAvgLatencyMs;
    job.currentLevelElapsedMs = progress.currentLevelElapsedMs;
    job.currentLevelDurationMs = progress.currentLevelDurationMs;
    job.cooldownRemainingMs = progress.cooldownRemainingMs;
    job.cooldownTotalMs = progress.cooldownTotalMs;
    job.sentRequests = progress.sentRequests;
    job.maxElapsedMs = progress.maxElapsedMs;
    job.successfulRequests = progress.successfulRequests;
    job.failedRequests = progress.failedRequests;
    job.inputTokens = progress.inputTokens;
    job.outputTokens = progress.outputTokens;
    job.totalTokens = progress.totalTokens;
    job.stableRpm = progress.stableRpm;
    job.stableConcurrency = progress.stableConcurrency;
    job.levels = progress.levels;
    job.message = progress.message;
    job.updatedAt = Date.now();
    job.elapsedMs = job.updatedAt - job.startedAt;
  }

  private complete(job: ProbeJobRecord, result: LlmCapacityProbeResult): void {
    job.status = "completed";
    job.phase = "done";
    job.result = result;
    job.currentRpm = result.testedMaxRpm;
    job.currentConcurrency = result.testedMaxConcurrency;
    job.stableRpm = result.testedMaxRpm;
    job.stableConcurrency = result.testedMaxConcurrency;
    job.inputTokens = result.inputTokens;
    job.outputTokens = result.outputTokens;
    job.totalTokens = result.totalTokens;
    job.levels = result.levels;
    job.message = "校准完成";
    job.updatedAt = Date.now();
    job.elapsedMs = job.updatedAt - job.startedAt;
  }

  private view(job: ProbeJobRecord): LlmCapacityProbeJobView {
    const { controller: _controller, startedAt: _startedAt, updatedAt: _updatedAt, ...view } = job;
    return {
      ...view,
      elapsedMs: job.status === "running" ? Date.now() - job.startedAt : view.elapsedMs
    };
  }

  private cleanup(): void {
    const cutoff = Date.now() - 10 * 60_000;
    for (const [id, job] of this.jobs) {
      if (job.status !== "running" && job.updatedAt < cutoff) {
        this.jobs.delete(id);
      }
    }
  }
}

export class ProbeAlreadyRunningError extends Error {
  constructor(readonly jobId: string) {
    super("A capacity probe job is already running.");
  }
}

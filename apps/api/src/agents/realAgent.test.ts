import { describe, expect, it } from "vitest";
import { extractJson, NdjsonLineBuffer, PlanFrameAccumulator } from "./realAgent.js";
import type { AudiencePlanFrame } from "@trycue/shared/audience";

describe("extractJson", () => {
  it("extracts the first complete JSON object and ignores trailing model text", () => {
    const raw = `说明文字\n[{"label":"核心用户 1","brief":"预算敏感"}]\n{"重复":"输出"}`;

    expect(JSON.parse(extractJson(raw))).toEqual([{ label: "核心用户 1", brief: "预算敏感" }]);
  });

  it("keeps fenced JSON and arrays intact", () => {
    expect(extractJson("```json\n[{\"name\":\"核心用户\"}]\n```")).toBe("[{\"name\":\"核心用户\"}]");
  });
});

describe("NdjsonLineBuffer", () => {
  it("returns complete lines and holds incomplete trailing content", () => {
    const buf = new NdjsonLineBuffer();
    expect(buf.push('{"type":"plan_markdown_delta","text":"hello"}\n')).toEqual([
      '{"type":"plan_markdown_delta","text":"hello"}'
    ]);
    expect(buf.push('{"type":"dim')).toEqual([]);
    expect(buf.push('ension_upsert","key":"trust","label":"信任"}\n')).toEqual([
      '{"type":"dimension_upsert","key":"trust","label":"信任"}'
    ]);
  });

  it("handles multiple lines in a single chunk", () => {
    const buf = new NdjsonLineBuffer();
    const lines = buf.push('{"a":1}\n{"b":2}\n{"c":3}\n');
    expect(lines).toEqual(['{"a":1}', '{"b":2}', '{"c":3}']);
  });

  it("handles \\r\\n line endings", () => {
    const buf = new NdjsonLineBuffer();
    const lines = buf.push('{"a":1}\r\n{"b":2}\n');
    expect(lines).toEqual(['{"a":1}', '{"b":2}']);
  });

  it("flush returns remaining buffer content", () => {
    const buf = new NdjsonLineBuffer();
    buf.push('{"partial":');
    expect(buf.flush()).toEqual(['{"partial":']);
    expect(buf.flush()).toEqual([]);
  });

  it("flush returns empty for empty buffer", () => {
    const buf = new NdjsonLineBuffer();
    buf.push('complete\n');
    expect(buf.flush()).toEqual([]);
  });
});

describe("PlanFrameAccumulator", () => {
  function applyFrames(targetCount: number, frames: AudiencePlanFrame[]) {
    const acc = new PlanFrameAccumulator(targetCount);
    for (const frame of frames) acc.apply(frame);
    return acc;
  }

  it("accumulates plan_markdown_delta into planMarkdown", () => {
    const acc = applyFrames(12, [
      { type: "plan_markdown_delta", text: "第一段。\n\n" },
      { type: "plan_markdown_delta", text: "第二段。" }
    ]);
    const preview = acc.toPreview();
    expect(preview.planMarkdown).toBe("第一段。\n\n第二段。");
    expect(preview.completed).toBe(false);
  });

  it("normalizes escaped newline text in plan_markdown_delta once", () => {
    const acc = applyFrames(12, [
      { type: "plan_markdown_delta", text: "第一段。\\n\\n第二段。" }
    ]);
    expect(acc.toPreview().planMarkdown).toBe("第一段。\n\n第二段。");
  });

  it("accumulates dimensions via dimension_upsert", () => {
    const acc = applyFrames(12, [
      { type: "dimension_upsert", key: "trust", label: "信任阈值" },
      { type: "dimension_upsert", key: "budget", label: "预算压力" },
      { type: "dimension_upsert", key: "trust", label: "信任度" } // update
    ]);
    const preview = acc.toPreview();
    expect(preview.dimensions).toEqual([
      { key: "trust", label: "信任度" },
      { key: "budget", label: "预算压力" }
    ]);
  });

  it("accumulates directives and marks complete when fields are valid", () => {
    const acc = applyFrames(12, [
      { type: "directive_started", key: "d1", sortOrder: 0 },
      { type: "directive_patch", key: "d1", patch: { name: "核心用户" } },
      { type: "directive_patch", key: "d1", patch: { description: "正在认真评估的新手爸妈", quantity: 5, diversityAxes: ["预算压力"], rationale: "观察收藏行为" } },
      { type: "directive_completed", key: "d1" }
    ]);
    const preview = acc.toPreview();
    expect(preview.directives).toHaveLength(1);
    expect(preview.directives[0]!.status).toBe("complete");
    expect(preview.directives[0]!.name).toBe("核心用户");
    expect(preview.directives[0]!.quantity).toBe(5);
    expect(preview.quantityTotal).toBe(5);
  });

  it("marks directive as invalid when fields are incomplete", () => {
    const acc = applyFrames(12, [
      { type: "directive_started", key: "d1", sortOrder: 0 },
      { type: "directive_patch", key: "d1", patch: { name: "核心用户" } },
      // Missing description, quantity, diversityAxes, rationale
      { type: "directive_completed", key: "d1" }
    ]);
    const preview = acc.toPreview();
    expect(preview.directives[0]!.status).toBe("invalid");
    expect(preview.validationIssues.length).toBeGreaterThan(0);
  });

  it("tracks plan_completed and sets completed flag", () => {
    const acc = applyFrames(12, [
      { type: "plan_completed", totalCount: 12 }
    ]);
    const preview = acc.toPreview();
    expect(preview.completed).toBe(true);
  });

  it("compiles to AudienceSamplingPlanDraft on valid complete plan", () => {
    const acc = applyFrames(12, [
      { type: "plan_markdown_delta", text: "计划说明。" },
      { type: "dimension_upsert", key: "trust", label: "信任阈值" },
      { type: "directive_started", key: "d1", sortOrder: 0 },
      { type: "directive_patch", key: "d1", patch: { name: "核心用户", description: "高需求用户", quantity: 7, diversityAxes: ["预算"], rationale: "观察收藏" } },
      { type: "directive_completed", key: "d1" },
      { type: "directive_started", key: "d2", sortOrder: 1 },
      { type: "directive_patch", key: "d2", patch: { name: "路人用户", description: "低意向", quantity: 5, diversityAxes: ["兴趣"], rationale: "观察退出" } },
      { type: "directive_completed", key: "d2" },
      { type: "plan_completed", totalCount: 12 }
    ]);
    const draft = acc.compile();
    expect(draft.totalCount).toBe(12);
    expect(draft.planMarkdown).toBe("计划说明。");
    expect(draft.dimensions).toEqual(["信任阈值"]);
    expect(draft.directives).toHaveLength(2);
    expect(draft.directives[0]!.name).toBe("核心用户");
    expect(draft.directives[0]!.quantity).toBe(7);
    expect(draft.directives[1]!.name).toBe("路人用户");
    expect(draft.directives[1]!.quantity).toBe(5);
  });

  it("throws on compile without plan_completed", () => {
    const acc = applyFrames(12, [
      { type: "directive_started", key: "d1", sortOrder: 0 },
      { type: "directive_patch", key: "d1", patch: { name: "核心用户", description: "高需求用户", quantity: 12, diversityAxes: ["预算"], rationale: "观察收藏" } },
      { type: "directive_completed", key: "d1" }
    ]);
    expect(() => acc.compile()).toThrow("未收到 plan_completed");
  });

  it("throws on compile with incomplete directive", () => {
    const acc = applyFrames(12, [
      { type: "plan_markdown_delta", text: "计划说明。" },
      { type: "directive_started", key: "d1", sortOrder: 0 },
      { type: "directive_patch", key: "d1", patch: { name: "核心用户" } },
      { type: "directive_completed", key: "d1" },
      { type: "plan_completed", totalCount: 12 }
    ]);
    expect(() => acc.compile()).toThrow();
  });

  it("throws on compile when directive fields are present but directive_completed is missing", () => {
    const acc = applyFrames(12, [
      { type: "plan_markdown_delta", text: "计划说明。" },
      { type: "directive_started", key: "d1", sortOrder: 0 },
      { type: "directive_patch", key: "d1", patch: { name: "核心用户", description: "高需求用户", quantity: 12, diversityAxes: ["预算"], rationale: "观察收藏" } },
      { type: "plan_completed", totalCount: 12 }
    ]);
    expect(() => acc.compile()).toThrow("未收到完整 directive_completed");
  });

  it("throws on compile with empty planMarkdown", () => {
    const acc = applyFrames(12, [
      { type: "directive_started", key: "d1", sortOrder: 0 },
      { type: "directive_patch", key: "d1", patch: { name: "核心用户", description: "高需求用户", quantity: 12, diversityAxes: ["预算"], rationale: "观察收藏" } },
      { type: "directive_completed", key: "d1" },
      { type: "plan_completed", totalCount: 12 }
    ]);
    expect(() => acc.compile()).toThrow("planMarkdown 不能为空");
  });

  it("records parser_error frames as validation issues", () => {
    const acc = applyFrames(12, [
      { type: "parser_error", line: "not json", message: "parse failed" }
    ]);
    const preview = acc.toPreview();
    expect(preview.validationIssues).toHaveLength(1);
    expect(preview.validationIssues[0]).toContain("parse failed");
  });

  it("throws on compile when any parser_error was seen", () => {
    const acc = applyFrames(12, [
      { type: "parser_error", line: "not json", message: "parse failed" },
      { type: "plan_markdown_delta", text: "计划说明。" },
      { type: "directive_started", key: "d1", sortOrder: 0 },
      { type: "directive_patch", key: "d1", patch: { name: "核心用户", description: "高需求用户", quantity: 12, diversityAxes: ["预算"], rationale: "观察收藏" } },
      { type: "directive_completed", key: "d1" },
      { type: "plan_completed", totalCount: 12 }
    ]);
    expect(() => acc.compile()).toThrow("frame 流存在解析或校验问题");
  });

  it("handles directive_patch for unknown key gracefully", () => {
    const acc = applyFrames(12, [
      { type: "directive_patch", key: "unknown", patch: { name: "test" } }
    ]);
    const preview = acc.toPreview();
    expect(preview.validationIssues).toHaveLength(1);
    expect(preview.validationIssues[0]).toContain("未知 key");
  });

  it("records duplicate directive_started as a validation issue", () => {
    const acc = applyFrames(12, [
      { type: "directive_started", key: "d1", sortOrder: 0 },
      { type: "directive_started", key: "d1", sortOrder: 1 }
    ]);
    const preview = acc.toPreview();
    expect(preview.directives).toHaveLength(1);
    expect(preview.validationIssues[0]).toContain("重复 key");
  });

  it("computes quantityTotal across multiple directives", () => {
    const acc = applyFrames(30, [
      { type: "directive_started", key: "d1", sortOrder: 0 },
      { type: "directive_patch", key: "d1", patch: { quantity: 12 } },
      { type: "directive_started", key: "d2", sortOrder: 1 },
      { type: "directive_patch", key: "d2", patch: { quantity: 8 } },
      { type: "directive_started", key: "d3", sortOrder: 2 },
      { type: "directive_patch", key: "d3", patch: { quantity: 10 } }
    ]);
    const preview = acc.toPreview();
    expect(preview.quantityTotal).toBe(30);
    expect(preview.targetCount).toBe(30);
  });
});

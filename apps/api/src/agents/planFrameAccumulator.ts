import {
  type AudiencePlanFrame,
  type AudiencePlanPreview,
  type AudiencePlanPreviewDirective,
  type AudiencePlanPreviewDirectiveStatus
} from "@trycue/shared/audience";
import type {
  AudienceSamplingDirectiveDraft,
  AudienceSamplingPlanDraft
} from "./types.js";

// ---------------------------------------------------------------------------
// NdjsonLineBuffer — incremental line parser for NDJSON streams
// ---------------------------------------------------------------------------

export class NdjsonLineBuffer {
  private buffer = "";

  /**
   * Push a text-delta chunk. Returns all complete lines found.
   * Incomplete trailing content is held in the buffer.
   */
  push(chunk: string): string[] {
    this.buffer += chunk;
    const lines: string[] = [];
    let newlineIndex: number;
    while ((newlineIndex = this.buffer.indexOf("\n")) !== -1) {
      let line = this.buffer.slice(0, newlineIndex);
      if (line.endsWith("\r")) line = line.slice(0, -1);
      lines.push(line);
      this.buffer = this.buffer.slice(newlineIndex + 1);
    }
    return lines;
  }

  /**
   * Flush remaining buffer content as a final line (if non-empty).
   */
  flush(): string[] {
    const remaining = this.buffer;
    this.buffer = "";
    return remaining.trim() ? [remaining] : [];
  }
}

// ---------------------------------------------------------------------------
// PlanFrameAccumulator — accumulates frames into preview state and compiles
// to AudienceSamplingPlanDraft
// ---------------------------------------------------------------------------

type InternalDirectiveState = {
  key: string;
  sortOrder: number;
  status: AudiencePlanPreviewDirectiveStatus;
  name?: string;
  description?: string;
  quantity?: number;
  diversityAxes?: string[];
  rationale?: string;
};

export class PlanFrameAccumulator {
  private planMarkdown = "";
  private dimensions: Array<{ key: string; label: string }> = [];
  private directives: Map<string, InternalDirectiveState> = new Map();
  private directiveOrder: string[] = [];
  private totalCount: number | null = null;
  private completed = false;
  private validationIssues: string[] = [];
  private readonly targetCount: number;

  constructor(targetCount: number) {
    this.targetCount = targetCount;
  }

  apply(frame: AudiencePlanFrame): void {
    switch (frame.type) {
      case "plan_markdown_delta":
        this.planMarkdown += normalizePlanMarkdownDelta(frame.text);
        break;

      case "dimension_upsert": {
        const existing = this.dimensions.find(d => d.key === frame.key);
        if (existing) {
          existing.label = frame.label;
        } else {
          this.dimensions.push({ key: frame.key, label: frame.label });
        }
        break;
      }

      case "directive_started": {
        if (this.directives.has(frame.key)) {
          this.validationIssues.push(`directive_started 重复 key: ${frame.key}`);
          return;
        }
        this.directiveOrder.push(frame.key);
        this.directives.set(frame.key, {
          key: frame.key,
          sortOrder: frame.sortOrder,
          status: "streaming"
        });
        break;
      }

      case "directive_patch": {
        const directive = this.directives.get(frame.key);
        if (!directive) {
          this.validationIssues.push(`directive_patch 收到未知 key: ${frame.key}`);
          return;
        }
        if (frame.patch.name !== undefined) directive.name = frame.patch.name;
        if (frame.patch.description !== undefined) directive.description = frame.patch.description;
        if (frame.patch.quantity !== undefined) directive.quantity = frame.patch.quantity;
        if (frame.patch.diversityAxes !== undefined) directive.diversityAxes = frame.patch.diversityAxes;
        if (frame.patch.rationale !== undefined) directive.rationale = frame.patch.rationale;
        break;
      }

      case "directive_completed": {
        const directive = this.directives.get(frame.key);
        if (!directive) {
          this.validationIssues.push(`directive_completed 收到未知 key: ${frame.key}`);
          return;
        }
        // Validate completeness
        const isComplete =
          directive.name?.trim() &&
          directive.description?.trim() &&
          typeof directive.quantity === "number" && directive.quantity > 0 &&
          Array.isArray(directive.diversityAxes) && directive.diversityAxes.length > 0 &&
          directive.rationale?.trim();
        directive.status = isComplete ? "complete" : "invalid";
        if (!isComplete) {
          this.validationIssues.push(`directive "${frame.key}" 字段不完整，标记为 invalid`);
        }
        break;
      }

      case "plan_completed":
        this.totalCount = frame.totalCount;
        this.completed = true;
        break;

      case "parser_error":
        this.validationIssues.push(`解析错误: ${frame.message} (${frame.line.slice(0, 80)})`);
        break;

      case "validation_issue":
        this.validationIssues.push(frame.message);
        break;
    }
  }

  toPreview(): AudiencePlanPreview {
    const directives: AudiencePlanPreviewDirective[] = this.directiveOrder
      .map(key => this.directives.get(key)!)
      .filter(Boolean)
      .map(d => ({
        key: d.key,
        sortOrder: d.sortOrder,
        status: d.status,
        name: d.name,
        description: d.description,
        quantity: d.quantity,
        diversityAxes: d.diversityAxes,
        rationale: d.rationale
      }));

    const quantityTotal = directives.reduce((sum, d) => sum + (d.quantity ?? 0), 0);

    return {
      planMarkdown: this.planMarkdown,
      dimensions: this.dimensions.map(d => ({ key: d.key, label: d.label })),
      directives,
      quantityTotal,
      targetCount: this.targetCount,
      completed: this.completed,
      validationIssues: [...this.validationIssues]
    };
  }

  compile(): AudienceSamplingPlanDraft {
    if (!this.completed) {
      throw new Error("AUDIENCE_PLAN_FAILED: 未收到 plan_completed frame。");
    }
    if (!this.planMarkdown.trim()) {
      throw new Error("AUDIENCE_PLAN_FAILED: planMarkdown 不能为空。");
    }
    if (this.validationIssues.length > 0) {
      throw new Error(`AUDIENCE_PLAN_FAILED: frame 流存在解析或校验问题：${this.validationIssues.join("；")}`);
    }

    const orderedDirectives = this.directiveOrder
      .map(key => this.directives.get(key)!)
      .filter(Boolean);

    const directiveDrafts: AudienceSamplingDirectiveDraft[] = orderedDirectives.map(d => {
      if (d.status !== "complete") {
        throw new Error(`AUDIENCE_PLAN_FAILED: directive "${d.key}" 未收到完整 directive_completed frame。`);
      }
      return {
        name: requireNonEmpty(d.name, "directive name"),
        description: requireNonEmpty(d.description, "directive description"),
        quantity: requirePositiveInt(d.quantity, "directive quantity"),
        diversityAxes: requireNonEmptyArray(d.diversityAxes, "directive diversityAxes"),
        rationale: requireNonEmpty(d.rationale, "directive rationale")
      };
    });

    return {
      totalCount: this.totalCount ?? this.targetCount,
      planMarkdown: this.planMarkdown,
      dimensions: this.dimensions.map(d => d.label),
      directives: directiveDrafts
    };
  }
}

function requireNonEmpty(value: string | undefined, field: string): string {
  if (!value?.trim()) throw new Error(`AUDIENCE_PLAN_FAILED: ${field} 不能为空。`);
  return value.trim();
}

function normalizePlanMarkdownDelta(text: string): string {
  return text.replace(/\\n/g, "\n");
}

function requirePositiveInt(value: number | undefined, field: string): number {
  if (!Number.isInteger(value) || (value as number) <= 0) throw new Error(`AUDIENCE_PLAN_FAILED: ${field} 必须为正整数。`);
  return value as number;
}

function requireNonEmptyArray(value: string[] | undefined, field: string): string[] {
  if (!Array.isArray(value) || value.length === 0) throw new Error(`AUDIENCE_PLAN_FAILED: ${field} 不能为空。`);
  return value;
}

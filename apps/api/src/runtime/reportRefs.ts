import type {
  Recommendation,
  EvidenceRef,
  SegmentKey,
  BlockerType,
  DiagnosticCard
} from "@trycue/shared/report";

// ── Shared constants (used by both report.ts fallback path and reportAgent.ts real-LLM fallback) ──

export const RECOMMENDATION_LABELS: Record<Recommendation, string> = {
  recommend_publish: "建议发布",
  modify_then_publish: "修改后发布",
  not_recommend_current_version: "不建议当前版本发布",
  recommend_retest: "建议重测"
};

export const SEGMENT_NAMES: Record<SegmentKey, string> = {
  persuaded: "被打动的人",
  interested_but_not_convinced: "高兴趣低信任的人",
  skipped: "直接流失的人",
  skeptical: "质疑/反驳的人"
};

export const SEGMENT_ACTIONS: Record<SegmentKey, string> = {
  persuaded: "保留当前打动他们的标题与开头，在下一轮继续放大这类信号。",
  interested_but_not_convinced: "在正文开头补充数据来源、检测报告或非广告说明，降低 need_more_evidence 离开。",
  skipped: "重写信息流首图标题，强化与该人群痛点的关联，减少直接划走。",
  skeptical: "提前准备置顶评论回应质疑，正文补充适用边界和个人经验。"
};

export const BLOCKER_TITLES: Record<BlockerType, string> = {
  feed_attraction: "信息流吸引力不足",
  opening_retention: "点开后开头留存不足",
  trust_evidence: "信任证据不足",
  action_motivation: "行动刺激不足",
  comment_risk: "评论风险偏高",
  target_mismatch: "目标人群未命中",
  evidence_quality: "证据质量不足"
};

export const DIAGNOSTIC_TITLES: Record<DiagnosticCard["area"], string> = {
  feed_attraction: "信息流吸引力",
  reading_retention: "正文留存力",
  trust_evidence: "信任证据",
  save_value: "收藏价值",
  comment_risk: "评论风险与机会"
};

// ── Helpers ──

export function ref(id: string, type: EvidenceRef["type"], label: string, participantId?: string): EvidenceRef {
  return participantId ? { id, type, label, participantId } : { id, type, label };
}

export function fallbackBlockerAction(type: BlockerType): string {
  switch (type) {
    case "feed_attraction": return "重写标题与封面，强化与目标人群痛点的关联。";
    case "opening_retention": return "优化正文开头 3 行，加入悬念或关键结论。";
    case "trust_evidence": return "补充检测数据来源、使用边界和非广告说明。";
    case "action_motivation": return "在正文结尾加入行动引导。";
    case "comment_risk": return "提前准备置顶评论回应质疑。";
    case "target_mismatch": return "重新评估选题与目标人群的匹配度。";
    case "evidence_quality": return "扩大样本量重测，确保证据质量。";
  }
}

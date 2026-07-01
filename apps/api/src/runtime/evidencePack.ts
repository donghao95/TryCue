import type {
  EvidencePack,
  EvidencePackMeta,
  EvidenceContentSnapshot,
  EvidenceFunnel,
  EvidenceExitAnalysis,
  EvidenceCommentAnalysis,
  EvidenceComment,
  EvidenceThoughtAnalysis,
  EvidenceThought,
  ThoughtTheme,
  ThoughtPhase,
  EvidenceSegments,
  SegmentEvidence,
  EvidenceBlocker,
  BlockerType,
  Severity,
  AudienceGroupAnalysis,
  AudienceGroupStats,
  JourneySample,
  EvidenceRef,
  EvidenceItem,
  Recommendation,
  SegmentKey,
  EvidenceQuality,
  TargetAudienceFit,
  ModificationWeight
} from "@trycue/shared/report";
import type {
  ExitReasonCategory,
  ExitReadingDepth,
  InterestTrustLevel,
  CommentIntent,
  ReadDepth
} from "@trycue/shared/tool";
import type { AudienceGroupRole } from "@trycue/shared/audience";

// ── 输入类型 ──

export interface EvidencePackInput {
  runId: string;
  contentVersionId: string;
  content: { title: string; bodyText: string; imageUrlsJson: unknown; coverImageUrl: string | null };
  postState: { exposureCount: number; openCount: number; likeCount: number; favoriteCount: number; commentCount: number; shareCount: number; exitCount: number };
  journeys: Array<{ id: string; status: string; exitOutcome: string | null; exitReason: string | null; participantId: string | null; thoughtSummary: string | null; finalSummary: string | null }>;
  participants: Array<{ id: string; displayNameSnapshot: string; profileSnapshotJson: unknown; samplingDirectiveId: string | null }>;
  directives: Array<{ id: string; name: string; description: string; groupRole: string; samplingReason: string }>;
  comments: Array<{ id: string; commentText: string; participantId: string | null; simulatedTime: number | null }>;
  logs: Array<{ id: string; logText: string; action: string | null; thoughtText: string | null; participantId: string | null; journeyActionId: string; toolCallId: string | null; simulatedTime: number | null }>;
  toolCalls: Array<{ id: string; agentTurnId: string | null; journeyId: string | null; participantId: string | null; callIndex: number; toolName: string; status: string; input: unknown; output: unknown; simulatedTime: number | null }>;
  turns: Array<{ id: string; thoughtText: string | null }>;
  audienceCount: number;
  completedCount: number;
  failedCount: number;
  skippedCount: number;
  wasEndedEarly: boolean;
}

// ── 通用工具函数 ──

function objectRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function safeString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function ref(id: string, type: EvidenceRef["type"], label: string, participantId?: string): EvidenceRef {
  return participantId ? { id, type, label, participantId } : { id, type, label };
}

function item(id: string, type: EvidenceItem["type"], title: string, content: string, participantId?: string, raw?: unknown): EvidenceItem {
  const result: EvidenceItem = { id, type, title, content };
  if (participantId) result.participantId = participantId;
  if (raw !== undefined) result.raw = raw;
  return result;
}

function addEvidence(index: Record<string, EvidenceItem>, evidence: EvidenceItem): void {
  index[evidence.id] = evidence;
}

function countTop(values: string[], n: number): string[] {
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts.entries()]
    .filter(([, c]) => c > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([k]) => k);
}

// ── 枚举解析 ──

const EXIT_REASONS: ExitReasonCategory[] = [
  "not_relevant", "not_interested", "low_trust", "too_ad_like",
  "content_too_long", "need_more_evidence", "finished_normally", "no_more_action"
];
const EXIT_READING_DEPTHS: ExitReadingDepth[] = ["feed_only", "skimmed", "partial", "full"];
const LEVELS: InterestTrustLevel[] = ["low", "medium", "high"];
const INTENTS: CommentIntent[] = ["ask", "doubt", "share_experience", "agree", "joke", "pushback"];
const READ_DEPTHS: ReadDepth[] = ["skim", "partial", "full"];
const GROUP_ROLES: AudienceGroupRole[] = ["core_target", "peripheral_target", "contrast", "exploratory", "unknown"];

function parseExitReason(value: unknown): ExitReasonCategory | null {
  return typeof value === "string" && (EXIT_REASONS as string[]).includes(value) ? value as ExitReasonCategory : null;
}
function parseExitReadingDepth(value: unknown): ExitReadingDepth | null {
  return typeof value === "string" && (EXIT_READING_DEPTHS as string[]).includes(value) ? value as ExitReadingDepth : null;
}
function parseLevel(value: unknown): InterestTrustLevel | null {
  return typeof value === "string" && (LEVELS as string[]).includes(value) ? value as InterestTrustLevel : null;
}
function parseIntent(value: unknown): CommentIntent | null {
  return typeof value === "string" && (INTENTS as string[]).includes(value) ? value as CommentIntent : null;
}
function parseReadDepth(value: unknown): ReadDepth | null {
  return typeof value === "string" && (READ_DEPTHS as string[]).includes(value) ? value as ReadDepth : null;
}
function parseGroupRole(value: unknown): AudienceGroupRole {
  return typeof value === "string" && (GROUP_ROLES as string[]).includes(value) ? value as AudienceGroupRole : "unknown";
}

const RISK_EXIT_REASONS: ExitReasonCategory[] = ["low_trust", "too_ad_like", "need_more_evidence"];

// ── 中文标签 ──

const SEGMENT_NAMES: Record<SegmentKey, string> = {
  persuaded: "被打动的人",
  interested_but_not_convinced: "高兴趣低信任的人",
  skipped: "直接流失的人",
  skeptical: "质疑/反驳的人"
};

const BLOCKER_TITLES: Record<BlockerType, string> = {
  feed_attraction: "信息流吸引力不足",
  opening_retention: "点开后开头留存不足",
  trust_evidence: "信任证据不足",
  action_motivation: "行动刺激不足",
  comment_risk: "评论风险偏高",
  target_mismatch: "目标人群未命中",
  evidence_quality: "证据质量不足"
};

const EXIT_REASON_LABELS: Record<ExitReasonCategory, string> = {
  not_relevant: "不相关",
  not_interested: "不感兴趣",
  low_trust: "信任感低",
  too_ad_like: "广告感强",
  content_too_long: "内容过长",
  need_more_evidence: "证据不足",
  finished_normally: "正常结束",
  no_more_action: "无更多动作"
};

const READ_DEPTH_LABELS: Record<ReadDepth, string> = {
  skim: "快速扫读",
  partial: "看了一部分",
  full: "基本看完"
};

const INTENT_LABELS: Record<CommentIntent, string> = {
  ask: "提问",
  doubt: "质疑",
  share_experience: "分享经验",
  agree: "认同",
  joke: "玩笑",
  pushback: "反驳"
};

// ── Phase 映射（逻辑和 report.ts 一致） ──
// 首个 committed open_post 所在 turn 仍为 feed，后续为 post

function buildPhaseMaps(input: EvidencePackInput): {
  phaseByTurnId: Map<string, "feed" | "post">;
  phaseByToolCallId: Map<string, "feed" | "post">;
} {
  const turnsWithOpenPost = new Set(
    input.toolCalls
      .filter((tc) => tc.toolName === "open_post" && tc.status === "committed" && tc.agentTurnId)
      .map((tc) => tc.agentTurnId as string)
  );

  const phaseByTurnId = new Map<string, "feed" | "post">();
  let postStarted = false;
  for (const turn of input.turns) {
    phaseByTurnId.set(turn.id, postStarted ? "post" : "feed");
    if (!postStarted && turnsWithOpenPost.has(turn.id)) {
      postStarted = true;
    }
  }

  // 对于 toolCall，按 journey 分组、callIndex 排序，首个 committed open_post 之后为 post
  const toolCallsByJourney = new Map<string, EvidencePackInput["toolCalls"]>();
  for (const tc of input.toolCalls) {
    if (!tc.journeyId) continue;
    const list = toolCallsByJourney.get(tc.journeyId) ?? [];
    list.push(tc);
    toolCallsByJourney.set(tc.journeyId, list);
  }
  const phaseByToolCallId = new Map<string, "feed" | "post">();
  for (const [, list] of toolCallsByJourney) {
    const sorted = [...list].sort((a, b) => a.callIndex - b.callIndex);
    let opened = false;
    for (const tc of sorted) {
      phaseByToolCallId.set(tc.id, opened ? "post" : "feed");
      if (!opened && tc.toolName === "open_post" && tc.status === "committed") {
        opened = true;
      }
    }
  }

  return { phaseByTurnId, phaseByToolCallId };
}

// ── 参与者事实聚合 ──

interface ParticipantThought {
  evidenceId: string;
  text: string;
  phase: ThoughtPhase;
  beforeAction?: string;
  simulatedTime?: number;
}

interface ParticipantFacts {
  id: string;
  displayName: string;
  directiveId: string | null;
  demographics: Record<string, string>;
  toolCalls: EvidencePackInput["toolCalls"];
  opened: boolean;
  readDepth: "none" | ReadDepth;
  viewedComments: boolean;
  liked: boolean;
  favorited: boolean;
  shared: boolean;
  commented: boolean;
  commentIntents: CommentIntent[];
  exit: { reasonCategory: ExitReasonCategory; readingDepth: ExitReadingDepth; interestLevel: InterestTrustLevel; trustLevel: InterestTrustLevel } | null;
  thoughts: ParticipantThought[];
  segments: SegmentKey[];
}

const DEPTH_RANK: Record<ReadDepth, number> = { skim: 1, partial: 2, full: 3 };

function determineThoughtPhase(toolNames: Set<string>, turnPhase: "feed" | "post" | undefined): ThoughtPhase {
  if (toolNames.has("view_comments")) return "comments";
  if (toolNames.has("exit_browsing")) return "exit";
  if (toolNames.has("open_post")) return "feed";
  if (
    toolNames.has("read_post") ||
    toolNames.has("like_post") ||
    toolNames.has("favorite_post") ||
    toolNames.has("share_post") ||
    toolNames.has("write_comment") ||
    toolNames.has("like_comment")
  ) {
    return "post";
  }
  return turnPhase ?? "feed";
}

function buildParticipantFacts(input: EvidencePackInput, phaseByTurnId: Map<string, "feed" | "post">): Map<string, ParticipantFacts> {
  const participantName = new Map<string, string>();
  const participantDirective = new Map<string, string | null>();
  const participantDemo = new Map<string, Record<string, string>>();
  for (const p of input.participants) {
    participantName.set(p.id, p.displayNameSnapshot);
    participantDirective.set(p.id, p.samplingDirectiveId);
    participantDemo.set(p.id, extractDemographics(p.profileSnapshotJson));
  }

  // turn → 关联的 toolName 集合、首个 participantId
  const turnToolNames = new Map<string, Set<string>>();
  const turnParticipant = new Map<string, string>();
  for (const tc of input.toolCalls) {
    if (!tc.agentTurnId) continue;
    const set = turnToolNames.get(tc.agentTurnId) ?? new Set<string>();
    set.add(tc.toolName);
    turnToolNames.set(tc.agentTurnId, set);
    if (!turnParticipant.has(tc.agentTurnId) && tc.participantId) {
      turnParticipant.set(tc.agentTurnId, tc.participantId);
    }
  }

  // log → thoughtText 关联
  const thoughtByToolCallId = new Map<string, string>();
  for (const log of input.logs) {
    if (log.thoughtText && log.toolCallId) {
      thoughtByToolCallId.set(log.toolCallId, log.thoughtText);
    }
  }
  const thoughtByTurnId = new Map<string, string>();
  for (const turn of input.turns) {
    if (turn.thoughtText) thoughtByTurnId.set(turn.id, turn.thoughtText);
  }

  // 工具调用按参与者分组
  const toolCallsByParticipant = new Map<string, EvidencePackInput["toolCalls"]>();
  for (const tc of input.toolCalls) {
    if (!tc.participantId) continue;
    const list = toolCallsByParticipant.get(tc.participantId) ?? [];
    list.push(tc);
    toolCallsByParticipant.set(tc.participantId, list);
  }

  const facts = new Map<string, ParticipantFacts>();
  const allParticipantIds = new Set<string>([...participantName.keys(), ...toolCallsByParticipant.keys()]);

  for (const pid of allParticipantIds) {
    const tcs = toolCallsByParticipant.get(pid) ?? [];
    const committed = tcs.filter((tc) => tc.status === "committed");
    const opened = committed.some((tc) => tc.toolName === "open_post");
    const viewedComments = committed.some((tc) => tc.toolName === "view_comments");
    const liked = committed.some((tc) => tc.toolName === "like_post");
    const favorited = committed.some((tc) => tc.toolName === "favorite_post");
    const shared = committed.some((tc) => tc.toolName === "share_post");
    const commented = committed.some((tc) => tc.toolName === "write_comment");

    // 阅读深度取最高
    let bestDepthRank = 0;
    let readDepth: ParticipantFacts["readDepth"] = "none";
    for (const tc of committed) {
      if (tc.toolName !== "read_post") continue;
      const out = objectRecord(tc.output);
      const depth = parseReadDepth(out.depth) ?? "skim";
      const rank = DEPTH_RANK[depth];
      if (rank > bestDepthRank) {
        bestDepthRank = rank;
        readDepth = depth;
      }
    }

    const commentIntents: CommentIntent[] = [];
    let exit: ParticipantFacts["exit"] = null;
    for (const tc of committed) {
      const out = objectRecord(tc.output);
      if (tc.toolName === "write_comment") {
        const intent = parseIntent(out.intent);
        if (intent) commentIntents.push(intent);
      } else if (tc.toolName === "exit_browsing") {
        const reasonCategory = parseExitReason(out.reasonCategory);
        const readingDepth = parseExitReadingDepth(out.readingDepth);
        const interestLevel = parseLevel(out.interestLevel);
        const trustLevel = parseLevel(out.trustLevel);
        if (reasonCategory && readingDepth && interestLevel && trustLevel) {
          exit = { reasonCategory, readingDepth, interestLevel, trustLevel };
        }
      }
    }

    // 收集参与者想法
    const thoughts: ParticipantThought[] = [];
    for (const turn of input.turns) {
      if (!turn.thoughtText) continue;
      if (turnParticipant.get(turn.id) !== pid) continue;
      const text = turn.thoughtText.trim();
      if (text.length < 5 || text.length > 200) continue;
      const toolNames = turnToolNames.get(turn.id) ?? new Set<string>();
      const phase = determineThoughtPhase(toolNames, phaseByTurnId.get(turn.id));
      const beforeAction = [...toolNames][0];
      thoughts.push({
        evidenceId: `thought:${turn.id}`,
        text,
        phase,
        ...(beforeAction ? { beforeAction } : {})
      });
    }
    for (const log of input.logs) {
      if (!log.thoughtText || log.participantId !== pid) continue;
      const text = log.thoughtText.trim();
      if (text.length < 5 || text.length > 200) continue;
      const toolNames = new Set<string>();
      let beforeAction: string | undefined;
      if (log.toolCallId) {
        const tc = tcs.find((c) => c.id === log.toolCallId);
        if (tc) {
          toolNames.add(tc.toolName);
          beforeAction = tc.toolName;
        }
      } else if (log.action) {
        toolNames.add(log.action);
        beforeAction = log.action;
      }
      const phase = determineThoughtPhase(toolNames, phaseByTurnId.get(log.journeyActionId));
      thoughts.push({
        evidenceId: `thought:${log.id}`,
        text,
        phase,
        ...(beforeAction ? { beforeAction } : {}),
        ...(log.simulatedTime != null ? { simulatedTime: log.simulatedTime } : {})
      });
    }

    facts.set(pid, {
      id: pid,
      displayName: participantName.get(pid) ?? "AI 观众",
      directiveId: participantDirective.get(pid) ?? null,
      demographics: participantDemo.get(pid) ?? {},
      toolCalls: tcs,
      opened,
      readDepth,
      viewedComments,
      liked,
      favorited,
      shared,
      commented,
      commentIntents,
      exit,
      thoughts,
      segments: []
    });
  }

  // 分类人群（可多分类）
  for (const fact of facts.values()) {
    const keys: SegmentKey[] = [];
    const hasPositiveComment = fact.commentIntents.some((i) => i === "agree" || i === "share_experience");
    // persuaded
    if (fact.opened && (fact.liked || fact.favorited || fact.shared || hasPositiveComment)) {
      keys.push("persuaded");
    }
    // interested_but_not_convinced
    const highInterestLowTrust = fact.exit
      ? (fact.exit.interestLevel === "medium" || fact.exit.interestLevel === "high") && fact.exit.trustLevel === "low"
      : false;
    const riskExitReason = fact.exit ? RISK_EXIT_REASONS.includes(fact.exit.reasonCategory) : false;
    const deepReadOrComments = fact.readDepth === "partial" || fact.readDepth === "full" || fact.viewedComments;
    if (fact.opened && ((deepReadOrComments && highInterestLowTrust) || riskExitReason)) {
      keys.push("interested_but_not_convinced");
    }
    // skipped
    const feedOnlyExit = fact.exit?.readingDepth === "feed_only";
    const skipReason = fact.exit ? (fact.exit.reasonCategory === "not_relevant" || fact.exit.reasonCategory === "not_interested") : false;
    if (!fact.opened || feedOnlyExit || skipReason) {
      keys.push("skipped");
    }
    // skeptical
    const doubtComment = fact.commentIntents.some((i) => i === "doubt" || i === "pushback");
    const skepticalExit = fact.exit ? (fact.exit.reasonCategory === "low_trust" || fact.exit.reasonCategory === "too_ad_like") : false;
    const skepticalThought = fact.thoughts.some((t) => /广告|软广|没依据|太绝对/.test(t.text));
    if (doubtComment || skepticalExit || skepticalThought) {
      keys.push("skeptical");
    }
    fact.segments = keys.length > 0 ? keys : ["skipped"];
  }

  return facts;
}

function extractDemographics(profileSnapshotJson: unknown): Record<string, string> {
  const snapshot = objectRecord(profileSnapshotJson);
  const demo = objectRecord(snapshot.demographicsJson);
  const out: Record<string, string> = {};
  for (const key of ["gender", "ageRange", "cityTier", "lifeStage", "role", "spendingPower"] as const) {
    const v = demo[key];
    if (typeof v === "string" && v.length > 0) out[key] = v;
  }
  return out;
}

// ── meta ──

function buildMeta(input: EvidencePackInput): EvidencePackMeta {
  const { audienceCount, completedCount, failedCount, skippedCount, wasEndedEarly } = input;
  let quality: EvidenceQuality = "medium";
  let reason = "样本基本可用，结论可用但需要谨慎。";
  if (audienceCount < 3) {
    quality = "low";
    reason = "试映观众数过少（少于 3 人），证据不足以支撑发布判断。";
  } else if (completedCount < audienceCount * 0.5) {
    quality = "low";
    reason = `完成观众数（${completedCount}/${audienceCount}）不足一半，证据不足以支撑发布判断。`;
  } else if (failedCount > audienceCount * 0.3) {
    quality = "low";
    reason = `失败观众数（${failedCount}/${audienceCount}）超过 30%，证据不足以支撑发布判断。`;
  } else if (completedCount >= audienceCount * 0.8 && failedCount < audienceCount * 0.1) {
    quality = "high";
    reason = "大部分观众完成试映，行为证据完整。";
  }
  if (wasEndedEarly && quality !== "low") {
    reason += " 本场试映为提前结束，未完成观众未计入完整判断。";
  }
  return {
    runId: input.runId,
    contentVersionId: input.contentVersionId,
    audienceCount,
    completedCount,
    failedCount,
    skippedCount,
    generatedAt: new Date().toISOString(),
    evidenceQuality: quality,
    evidenceQualityReason: reason
  };
}

function buildContentSnapshot(content: EvidencePackInput["content"]): EvidenceContentSnapshot {
  const bodyPreview = content.bodyText.length > 500 ? content.bodyText.slice(0, 500) : content.bodyText;
  const imageUrls = Array.isArray(content.imageUrlsJson) ? content.imageUrlsJson : [];
  const imageCount = imageUrls.length + (content.coverImageUrl ? 1 : 0);
  return {
    title: content.title,
    bodyPreview,
    platformName: "小红书",
    imageCount
  };
}

// ── funnel ──

/**
 * 从 ParticipantFacts 聚合漏斗指标。
 * 所有人数指标按 participant 去重（actor count），事件指标从 committed tool calls 计数。
 */
function buildFunnel(input: EvidencePackInput, facts: Map<string, ParticipantFacts>, index: Record<string, EvidenceItem>): EvidenceFunnel {
  // ── 人数指标（从 ParticipantFacts 按人去重）──
  let exposedActors = 0;
  let openedActors = 0;
  let readActors = 0;
  let deepReadActors = 0;
  let readSkimActors = 0;
  let readPartialActors = 0;
  let readFullActors = 0;
  let viewedCommentsActors = 0;
  let likedActors = 0;
  let favoritedActors = 0;
  let commentedActors = 0;
  let sharedActors = 0;
  let exitedActors = 0;
  let positiveActionActors = 0;

  for (const fact of facts.values()) {
    // exposedActors：V1 进入试映的每个 participant 算一次"曝光"
    // 注：V1 exposure 是进入测试人数的近似，不是真实的"信息流曝光"事件
    exposedActors++;
    if (fact.opened) openedActors++;
    if (fact.readDepth !== "none") {
      readActors++;
      if (fact.readDepth === "skim") readSkimActors++;
      else if (fact.readDepth === "partial") readPartialActors++;
      else if (fact.readDepth === "full") readFullActors++;
      // deepRead = partial + full
      if (fact.readDepth === "partial" || fact.readDepth === "full") deepReadActors++;
    }
    if (fact.viewedComments) viewedCommentsActors++;
    if (fact.liked) likedActors++;
    if (fact.favorited) favoritedActors++;
    if (fact.commented) commentedActors++;
    if (fact.shared) sharedActors++;
    if (fact.exit) exitedActors++;
    // positiveActionActors：至少做过 liked/favorited/commented/shared 之一的人数
    if (fact.liked || fact.favorited || fact.commented || fact.shared) {
      positiveActionActors++;
    }
  }

  // ── 事件/次数指标（从 committed tool calls 计数）──
  let openEvents = 0;
  let readEvents = 0;
  let commentEvents = 0;
  let shareEvents = 0;
  let exitEvents = 0;
  for (const tc of input.toolCalls) {
    if (tc.status !== "committed") continue;
    if (tc.toolName === "open_post") openEvents++;
    else if (tc.toolName === "read_post") readEvents++;
    else if (tc.toolName === "write_comment") commentEvents++;
    else if (tc.toolName === "share_post") shareEvents++;
    else if (tc.toolName === "exit_browsing") exitEvents++;
  }

  // ── 比率（全部用人数计算）──
  const openRate = exposedActors > 0 ? openedActors / exposedActors : null;
  const readRateAfterOpen = openedActors > 0 ? readActors / openedActors : null;
  const deepReadRateAfterOpen = openedActors > 0 ? deepReadActors / openedActors : null;
  const favoriteRateAfterOpen = openedActors > 0 ? favoritedActors / openedActors : null;
  const commentRateAfterOpen = openedActors > 0 ? commentedActors / openedActors : null;
  const shareRateAfterOpen = openedActors > 0 ? sharedActors / openedActors : null;
  const positiveActionRate = openedActors > 0 ? positiveActionActors / openedActors : null;

  // 写入 metric 证据（文案统一用"人"）
  if (openRate != null) {
    addEvidence(index, item("metric:openRate", "metric", "点开率", `${(openRate * 100).toFixed(1)}%（${openedActors}/${exposedActors} 人）`, undefined, { openRate, openedActors, exposedActors }));
  }
  if (readRateAfterOpen != null) {
    addEvidence(index, item("metric:readRateAfterOpen", "metric", "点开后阅读率", `${(readRateAfterOpen * 100).toFixed(1)}%（${readActors}/${openedActors} 人）`, undefined, { readRateAfterOpen, readActors, openedActors }));
  }
  if (positiveActionRate != null) {
    addEvidence(index, item("metric:positiveActionRate", "metric", "正向行为率", `${(positiveActionRate * 100).toFixed(1)}%（${positiveActionActors}/${openedActors} 人）`, undefined, { positiveActionRate, positiveActionActors, openedActors }));
  }
  if (favoriteRateAfterOpen != null) {
    addEvidence(index, item("metric:favoriteRateAfterOpen", "metric", "点开后收藏率", `${(favoriteRateAfterOpen * 100).toFixed(1)}%（${favoritedActors}/${openedActors} 人）`, undefined, { favoriteRateAfterOpen, favoritedActors, openedActors }));
  }
  if (commentRateAfterOpen != null) {
    addEvidence(index, item("metric:commentRateAfterOpen", "metric", "点开后评论率", `${(commentRateAfterOpen * 100).toFixed(1)}%（${commentedActors}/${openedActors} 人，${commentEvents} 条评论）`, undefined, { commentRateAfterOpen, commentedActors, openedActors, commentEvents }));
  }
  if (shareRateAfterOpen != null) {
    addEvidence(index, item("metric:shareRateAfterOpen", "metric", "点开后分享率", `${(shareRateAfterOpen * 100).toFixed(1)}%（${sharedActors}/${openedActors} 人）`, undefined, { shareRateAfterOpen, sharedActors, openedActors }));
  }
  addEvidence(index, item("metric:exposedActors", "metric", "曝光人数", `${exposedActors} 人`));
  addEvidence(index, item("metric:openedActors", "metric", "点开人数", `${openedActors} 人`));

  return {
    exposedActors,
    openedActors,
    readActors,
    deepReadActors,
    readSkimActors,
    readPartialActors,
    readFullActors,
    viewedCommentsActors,
    likedActors,
    favoritedActors,
    commentedActors,
    sharedActors,
    exitedActors,
    positiveActionActors,
    openEvents,
    readEvents,
    commentEvents,
    shareEvents,
    exitEvents,
    openRate,
    readRateAfterOpen,
    deepReadRateAfterOpen,
    favoriteRateAfterOpen,
    commentRateAfterOpen,
    shareRateAfterOpen,
    positiveActionRate
  };
}

// ── exitAnalysis ──

function buildExitAnalysis(input: EvidencePackInput, index: Record<string, EvidenceItem>): EvidenceExitAnalysis {
  const byReasonCategory: Record<ExitReasonCategory, number> = {
    not_relevant: 0, not_interested: 0, low_trust: 0, too_ad_like: 0,
    content_too_long: 0, need_more_evidence: 0, finished_normally: 0, no_more_action: 0
  };
  const byReadingDepth: Record<ExitReadingDepth, number> = { feed_only: 0, skimmed: 0, partial: 0, full: 0 };
  const byInterestLevel: Record<InterestTrustLevel, number> = { low: 0, medium: 0, high: 0 };
  const byTrustLevel: Record<InterestTrustLevel, number> = { low: 0, medium: 0, high: 0 };
  let totalExits = 0;

  for (const tc of input.toolCalls) {
    if (tc.status !== "committed" || tc.toolName !== "exit_browsing") continue;
    const out = objectRecord(tc.output);
    const reason = parseExitReason(out.reasonCategory);
    if (reason) byReasonCategory[reason]++;
    const readingDepth = parseExitReadingDepth(out.readingDepth);
    if (readingDepth) byReadingDepth[readingDepth]++;
    const interest = parseLevel(out.interestLevel);
    if (interest) byInterestLevel[interest]++;
    const trust = parseLevel(out.trustLevel);
    if (trust) byTrustLevel[trust]++;
    totalExits++;
  }

  const riskExitCount = byReasonCategory.low_trust + byReasonCategory.too_ad_like + byReasonCategory.need_more_evidence;
  const riskExitRate = totalExits > 0 ? riskExitCount / totalExits : null;

  addEvidence(index, item("metric:riskExitCount", "metric", "风险离开人数", String(riskExitCount), undefined, { riskExitCount }));
  addEvidence(
    index,
    item(
      "metric:riskExitRate",
      "metric",
      "风险离开率",
      riskExitRate != null ? `${(riskExitRate * 100).toFixed(1)}%（${riskExitCount}/${totalExits}）` : "未计算（无离开记录）",
      undefined,
      { riskExitRate }
    )
  );

  return { byReasonCategory, byReadingDepth, byInterestLevel, byTrustLevel, riskExitCount, riskExitRate };
}

// ── commentAnalysis ──

function buildCommentAnalysis(input: EvidencePackInput, index: Record<string, EvidenceItem>): EvidenceCommentAnalysis {
  const byIntent: Record<CommentIntent, number> = { ask: 0, doubt: 0, share_experience: 0, agree: 0, joke: 0, pushback: 0 };
  const participantName = new Map<string, string>();
  for (const p of input.participants) participantName.set(p.id, p.displayNameSnapshot);
  const commentTextById = new Map<string, string>();
  for (const c of input.comments) commentTextById.set(c.id, c.commentText);

  const all: EvidenceComment[] = [];
  for (const tc of input.toolCalls) {
    if (tc.status !== "committed" || tc.toolName !== "write_comment") continue;
    const out = objectRecord(tc.output);
    const intent = parseIntent(out.intent);
    if (!intent) continue;
    byIntent[intent]++;
    const commentId = safeString(out.commentId);
    const commentContent = commentId ? commentTextById.get(commentId) : undefined;
    const content = commentContent ?? safeString(objectRecord(tc.input).content) ?? "";
    const evidenceId = commentId ? `comment:${commentId}` : `comment:tc:${tc.id}`;
    const participantId = tc.participantId ?? "";
    const displayName = (participantId && participantName.get(participantId)) || "AI 观众";
    const ec: EvidenceComment = {
      evidenceId,
      participantId,
      displayName,
      intent,
      content
    };
    if (tc.simulatedTime != null) ec.simulatedTime = tc.simulatedTime;
    all.push(ec);
    addEvidence(index, item(evidenceId, "comment", `${displayName} 的评论（${INTENT_LABELS[intent]}）`, content, participantId || undefined, { intent, commentId }));
  }

  // 每种 intent 最多 2 条，总共最多 8 条
  const byIntentMap = new Map<CommentIntent, EvidenceComment[]>();
  for (const ec of all) {
    const list = byIntentMap.get(ec.intent) ?? [];
    list.push(ec);
    byIntentMap.set(ec.intent, list);
  }
  const representativeComments: EvidenceComment[] = [];
  for (const list of byIntentMap.values()) {
    representativeComments.push(...list.slice(0, 2));
  }
  if (representativeComments.length > 8) representativeComments.length = 8;

  return { totalComments: all.length, byIntent, representativeComments };
}

// ── thoughtAnalysis ──

const THEME_KEYWORDS: Array<{ theme: string; keywords: RegExp }> = [
  { theme: "信任相关", keywords: /依据|广告|来源|数据|检测|可信|软广|真假|信任/ },
  { theme: "价值相关", keywords: /有用|收藏|实用|保存|对照|参考|价值|避坑/ },
  { theme: "兴趣相关", keywords: /想看|好奇|感兴趣|吸引|戳到|点开|关注/ },
  { theme: "质疑相关", keywords: /不对|太绝对|夸张|怀疑|质疑|真的吗|吹/ }
];

function buildThoughtAnalysis(facts: Map<string, ParticipantFacts>, index: Record<string, EvidenceItem>): EvidenceThoughtAnalysis {
  interface CandidateThought extends EvidenceThought {
    category: "feed_open" | "post_read_favorite" | "trust_keyword" | "other";
  }

  const candidates: CandidateThought[] = [];
  for (const fact of facts.values()) {
    for (const t of fact.thoughts) {
      const toolNames = t.beforeAction ? new Set([t.beforeAction]) : new Set<string>();
      let category: CandidateThought["category"] = "other";
      const hasTrustKeyword = THEME_KEYWORDS[0]?.keywords.test(t.text) ?? false;
      if (t.phase === "feed" && toolNames.has("open_post")) {
        category = "feed_open";
      } else if (t.phase === "post" && (toolNames.has("read_post") || toolNames.has("favorite_post"))) {
        category = "post_read_favorite";
      } else if (hasTrustKeyword) {
        category = "trust_keyword";
      }
      const et: CandidateThought = {
        evidenceId: t.evidenceId,
        participantId: fact.id,
        displayName: fact.displayName,
        phase: t.phase,
        text: t.text,
        category
      };
      if (t.beforeAction) et.beforeAction = t.beforeAction;
      if (t.simulatedTime != null) et.simulatedTime = t.simulatedTime;
      candidates.push(et);

      addEvidence(index, item(t.evidenceId, "thought", `${fact.displayName} 的想法（${t.phase}）`, t.text, fact.id, { phase: t.phase }));
    }
  }

  // 每类最多 5 条，总共最多 15 条
  const categories: CandidateThought["category"][] = ["feed_open", "post_read_favorite", "trust_keyword", "other"];
  const representativeThoughts: EvidenceThought[] = [];
  for (const cat of categories) {
    const subset = candidates.filter((c) => c.category === cat).slice(0, 5);
    for (const c of subset) {
      const { category: _omit, ...rest } = c;
      void _omit;
      representativeThoughts.push(rest);
    }
    if (representativeThoughts.length >= 15) break;
  }
  if (representativeThoughts.length > 15) representativeThoughts.length = 15;

  // 主题分组
  const themes: ThoughtTheme[] = [];
  for (const { theme, keywords } of THEME_KEYWORDS) {
    const matching = candidates.filter((c) => keywords.test(c.text));
    if (matching.length === 0) continue;
    const examples = matching.slice(0, 3).map((c) => ref(c.evidenceId, "thought", c.text.slice(0, 30), c.participantId));
    themes.push({ theme, count: matching.length, examples });
  }

  return { representativeThoughts, themes };
}

// ── segments ──

function computeCommonTraits(groupFacts: ParticipantFacts[]): string[] {
  const traits: string[] = [];
  const lifeStages = groupFacts.map((f) => f.demographics.lifeStage).filter((v): v is string => Boolean(v));
  const roles = groupFacts.map((f) => f.demographics.role).filter((v): v is string => Boolean(v));
  const topLifeStage = countTop(lifeStages, 1)[0];
  const topRole = countTop(roles, 1)[0];
  if (topLifeStage) traits.push(`主要人生阶段：${topLifeStage}`);
  if (topRole) traits.push(`主要角色：${topRole}`);
  return traits;
}

function segmentSummary(key: SegmentKey, groupFacts: ParticipantFacts[]): string {
  const size = groupFacts.length;
  if (size === 0) return "无观众落入该人群。";
  const opened = groupFacts.filter((f) => f.opened).length;
  const liked = groupFacts.filter((f) => f.liked).length;
  const favorited = groupFacts.filter((f) => f.favorited).length;
  const commented = groupFacts.filter((f) => f.commented).length;
  const riskExit = groupFacts.filter((f) => f.exit && RISK_EXIT_REASONS.includes(f.exit.reasonCategory)).length;
  switch (key) {
    case "persuaded":
      return `${size} 人点开并产生正向行为（点赞 ${liked}、收藏 ${favorited}、评论 ${commented}）。`;
    case "interested_but_not_convinced":
      return `${size} 人愿意点开阅读或看评论，但在信任/证据上犹豫，其中 ${riskExit} 人风险离开。`;
    case "skipped":
      return `${size} 人未点开或在信息流直接流失（其中点开 ${opened} 人）。`;
    case "skeptical":
      return `${size} 人出现质疑或反驳信号（评论质疑、风险离开或想法含广告感）。`;
  }
}

function buildSegments(facts: Map<string, ParticipantFacts>, audienceCount: number, index: Record<string, EvidenceItem>): EvidenceSegments {
  const byKey = new Map<SegmentKey, ParticipantFacts[]>();
  for (const key of ["persuaded", "interested_but_not_convinced", "skipped", "skeptical"] as SegmentKey[]) {
    byKey.set(key, []);
  }
  for (const fact of facts.values()) {
    for (const key of fact.segments) {
      byKey.get(key)?.push(fact);
    }
  }

  const buildOne = (key: SegmentKey): SegmentEvidence => {
    const groupFacts = byKey.get(key) ?? [];
    const participantIds = groupFacts.map((f) => f.id);
    const size = groupFacts.length;
    const percentage = audienceCount > 0 ? size / audienceCount : null;
    const evidenceRefs: EvidenceRef[] = [
      ref(`segment:${key}`, "segment", SEGMENT_NAMES[key])
    ];
    // 引用一些代表性想法和评论
    const thoughtRefs = groupFacts
      .flatMap((f) => f.thoughts.slice(0, 1))
      .slice(0, 3)
      .map((t) => ref(t.evidenceId, "thought", t.text.slice(0, 30)));
    evidenceRefs.push(...thoughtRefs);
    if (key === "skeptical") {
      const commentRefs = groupFacts
        .flatMap((f) => f.commentIntents.filter((i) => i === "doubt" || i === "pushback").slice(0, 1))
        .slice(0, 3)
        .map((_, idx) => ref(`comment:segment:${key}:${idx}`, "comment", "质疑评论"));
      // 这些 ref 可能没有对应 item；改为引用风险离开 metric
      void commentRefs;
      evidenceRefs.push(ref("metric:riskExitCount", "metric", "风险离开人数"));
    }
    addEvidence(index, item(`segment:${key}`, "segment", SEGMENT_NAMES[key], segmentSummary(key, groupFacts), undefined, { size, percentage }));
    return {
      key,
      name: SEGMENT_NAMES[key],
      participantIds,
      size,
      percentage,
      summary: segmentSummary(key, groupFacts),
      commonTraits: computeCommonTraits(groupFacts),
      evidenceRefs
    };
  };

  return {
    persuaded: buildOne("persuaded"),
    interestedButNotConvinced: buildOne("interested_but_not_convinced"),
    skipped: buildOne("skipped"),
    skeptical: buildOne("skeptical")
  };
}

// ── blockers ──

function severityFromAffected(affectedCount: number, audienceCount: number): Severity {
  if (audienceCount <= 0) return affectedCount > 0 ? "medium" : "low";
  const ratio = affectedCount / audienceCount;
  if (ratio >= 0.4) return "high";
  if (ratio >= 0.2) return "medium";
  return "low";
}

function buildBlockers(facts: Map<string, ParticipantFacts>, input: EvidencePackInput, index: Record<string, EvidenceItem>): EvidenceBlocker[] {
  const audienceCount = input.audienceCount;
  const allFacts = [...facts.values()];
  const blockers: EvidenceBlocker[] = [];

  const makeBlocker = (blockerType: BlockerType, affected: ParticipantFacts[], summary: string, extraRefs: EvidenceRef[] = []): EvidenceBlocker => {
    const affectedCount = affected.length;
    const severity = severityFromAffected(affectedCount, audienceCount);
    const evidenceRefs: EvidenceRef[] = [
      ref(`blocker:${blockerType}`, "blocker", BLOCKER_TITLES[blockerType]),
      ...extraRefs
    ];
    const blocker: EvidenceBlocker = { blockerType, severity, affectedCount, summary, evidenceRefs };
    addEvidence(index, item(`blocker:${blockerType}`, "blocker", BLOCKER_TITLES[blockerType], summary, undefined, { severity, affectedCount }));
    return blocker;
  };

  // feed_attraction: feed_only / not_interested / not_relevant，尤其 core_target 也跳过
  const feedAttraction = allFacts.filter((f) => {
    if (!f.exit) return !f.opened;
    return f.exit.readingDepth === "feed_only" || f.exit.reasonCategory === "not_interested" || f.exit.reasonCategory === "not_relevant";
  });
  if (feedAttraction.length > 0) {
    const coreSkipped = feedAttraction.some((f) => f.directiveId && input.directives.some((d) => d.id === f.directiveId && d.groupRole === "core_target"));
    blockers.push(makeBlocker(
      "feed_attraction",
      feedAttraction,
      `${feedAttraction.length} 人在信息流阶段流失${coreSkipped ? "，其中包含核心目标人群" : ""}。`,
      [ref("metric:openRate", "metric", "点开率")]
    ));
  }

  // opening_retention: open_post 后 read_post=skim 或很快 no_more_action
  const openingRetention = allFacts.filter((f) => {
    if (!f.opened) return false;
    if (f.readDepth === "skim") return true;
    if (f.exit?.reasonCategory === "no_more_action") return true;
    return false;
  });
  if (openingRetention.length > 0) {
    blockers.push(makeBlocker(
      "opening_retention",
      openingRetention,
      `${openingRetention.length} 人点开后快速扫读或很快无更多动作离开，正文开头留存不足。`,
      [ref("metric:readRateAfterOpen", "metric", "点开后阅读率")]
    ));
  }

  // trust_evidence: low_trust / too_ad_like / need_more_evidence
  const trustEvidence = allFacts.filter((f) => f.exit && RISK_EXIT_REASONS.includes(f.exit.reasonCategory));
  if (trustEvidence.length > 0) {
    blockers.push(makeBlocker(
      "trust_evidence",
      trustEvidence,
      `${trustEvidence.length} 人因信任感低、广告感强或证据不足离开。`,
      [ref("metric:riskExitCount", "metric", "风险离开人数")]
    ));
  }

  // action_motivation: read_full / finished_normally 多但点赞收藏评论少
  const actionMotivation = allFacts.filter((f) => {
    const readFullOrFinished = f.readDepth === "full" || (f.exit?.reasonCategory === "finished_normally") === true;
    if (!readFullOrFinished) return false;
    return !f.liked && !f.favorited && !f.commented && !f.shared;
  });
  if (actionMotivation.length > 0) {
    blockers.push(makeBlocker(
      "action_motivation",
      actionMotivation,
      `${actionMotivation.length} 人阅读完整或正常结束但未产生点赞/收藏/评论/分享，行动刺激不足。`,
      [ref("metric:positiveActionRate", "metric", "正向行为率")]
    ));
  }

  // comment_risk: doubt/pushback 多，或 ask 集中
  const commentRisk = allFacts.filter((f) => f.commentIntents.some((i) => i === "doubt" || i === "pushback"));
  if (commentRisk.length > 0) {
    blockers.push(makeBlocker(
      "comment_risk",
      commentRisk,
      `${commentRisk.length} 人发表质疑或反驳评论，评论区风险偏高。`
    ));
  }

  // target_mismatch: core_target 组点开和互动都弱
  const coreDirectiveIds = new Set(input.directives.filter((d) => d.groupRole === "core_target").map((d) => d.id));
  const coreTargetFacts = allFacts.filter((f) => f.directiveId && coreDirectiveIds.has(f.directiveId));
  if (coreTargetFacts.length > 0) {
    const coreOpened = coreTargetFacts.filter((f) => f.opened).length;
    const corePositive = coreTargetFacts.filter((f) => f.liked || f.favorited || f.commented || f.shared).length;
    const coreOpenRate = coreOpened / coreTargetFacts.length;
    if (coreOpenRate < 0.5 && corePositive < coreTargetFacts.length * 0.3) {
      blockers.push(makeBlocker(
        "target_mismatch",
        coreTargetFacts,
        `核心目标人群 ${coreTargetFacts.length} 人中点开 ${coreOpened}、正向互动 ${corePositive}，目标人群未命中。`,
        [ref("metric:openRate", "metric", "点开率")]
      ));
    }
  }

  // evidence_quality: 证据质量不足，建议重测（severity 固定为 high，不依赖 affected 人数）
  const evidenceQualityLow = input.audienceCount < 3
    || input.completedCount < input.audienceCount * 0.5
    || input.failedCount > input.audienceCount * 0.3;
  if (evidenceQualityLow) {
    const affectedCount = Math.max(input.failedCount, input.audienceCount - input.completedCount);
    const blocker: EvidenceBlocker = {
      blockerType: "evidence_quality",
      severity: "high",
      affectedCount,
      summary: `证据质量不足（${input.completedCount}/${input.audienceCount} 完成${input.failedCount > 0 ? `，${input.failedCount} 失败` : ""}），建议重测。`,
      evidenceRefs: [ref("blocker:evidence_quality", "blocker", BLOCKER_TITLES.evidence_quality)]
    };
    blockers.push(blocker);
    addEvidence(index, item("blocker:evidence_quality", "blocker", BLOCKER_TITLES.evidence_quality, blocker.summary, undefined, { severity: "high", affectedCount }));
  }

  return blockers;
}

// ── audienceGroups ──

function buildAudienceGroups(facts: Map<string, ParticipantFacts>, input: EvidencePackInput, index: Record<string, EvidenceItem>): AudienceGroupAnalysis {
  const directiveById = new Map<string, EvidencePackInput["directives"][number]>();
  for (const d of input.directives) directiveById.set(d.id, d);

  // 按 directiveId 分组
  const groupByDirective = new Map<string, ParticipantFacts[]>();
  for (const fact of facts.values()) {
    const key = fact.directiveId ?? "__ungrouped__";
    const list = groupByDirective.get(key) ?? [];
    list.push(fact);
    groupByDirective.set(key, list);
  }

  const groups: AudienceGroupStats[] = [];
  for (const [directiveId, groupFacts] of groupByDirective) {
    const directive = directiveId !== "__ungrouped__" ? directiveById.get(directiveId) : undefined;
    const directiveName = directive?.name ?? "未分组";
    const role = directive ? parseGroupRole(directive.groupRole) : "unknown";
    const confidence: "low" | "high" = role === "unknown" ? "low" : "high";

    const total = groupFacts.length;
    const opened = groupFacts.filter((f) => f.opened).length;
    const readSkim = groupFacts.filter((f) => f.readDepth === "skim").length;
    const readPartial = groupFacts.filter((f) => f.readDepth === "partial").length;
    const readFull = groupFacts.filter((f) => f.readDepth === "full").length;
    const viewedComments = groupFacts.filter((f) => f.viewedComments).length;
    const liked = groupFacts.filter((f) => f.liked).length;
    const favorited = groupFacts.filter((f) => f.favorited).length;
    const commented = groupFacts.filter((f) => f.commented).length;
    const shared = groupFacts.filter((f) => f.shared).length;
    const riskExitCount = groupFacts.filter((f) => f.exit && RISK_EXIT_REASONS.includes(f.exit.reasonCategory)).length;

    const exitReasons = groupFacts
      .map((f) => f.exit?.reasonCategory)
      .filter((r): r is ExitReasonCategory => Boolean(r))
      .map((r) => String(r));
    const mainExitReasons = countTop(exitReasons, 2).map((r) => EXIT_REASON_LABELS[r as ExitReasonCategory] ?? r);

    const intents = groupFacts.flatMap((f) => f.commentIntents).map((i) => String(i));
    const mainCommentIntents = countTop(intents, 2).map((i) => INTENT_LABELS[i as CommentIntent] ?? i);

    const representativeThoughts = groupFacts
      .flatMap((f) => f.thoughts.slice(0, 1))
      .slice(0, 3)
      .map((t) => ref(t.evidenceId, "thought", t.text.slice(0, 30)));
    const representativeComments: EvidenceRef[] = [];
    const representativeJourneys: EvidenceRef[] = [];

    const evidenceRefs: EvidenceRef[] = [ref(`group:${directiveId}`, "group", directiveName)];

    // ── 阶段 3 新增：AudienceGroupStats 5 个 optional 字段推导 ──
    // targetAudienceFit：基于 groupRole 推导该组与内容目标人群的匹配度
    // - core_target: 高匹配（核心目标人群）
    // - peripheral_target / exploratory: 中匹配（相邻或探索人群）
    // - contrast: 低匹配（对照人群，仅提供边界参考）
    // - unknown: 低匹配（未声明角色）
    const targetAudienceFit: TargetAudienceFit =
      role === "core_target" ? "high"
      : role === "peripheral_target" || role === "exploratory" ? "medium"
      : "low";

    // modificationWeight：该组反馈对修改计划的影响权重
    // 高匹配 + 有正向互动 → high（核心人群的反馈应直接驱动修改方向）
    // 高匹配但无互动 → medium（核心人群但本次未激发足够行为，反馈仍可作参考）
    // 中匹配 → medium（相邻人群，反馈作次要信号）
    // 低匹配 → low（对照/未知，仅作边界参考）
    const positiveActionActors = groupFacts.filter((f) => f.liked || f.favorited || f.commented || f.shared).length;
    const hasPositiveAction = positiveActionActors > 0;
    const modificationWeight: ModificationWeight =
      targetAudienceFit === "high" && hasPositiveAction ? "high"
      : targetAudienceFit === "high" ? "medium"
      : targetAudienceFit === "medium" ? "medium"
      : "low";

    // typicalMotivation：从代表性 thought 提取该组典型动机
    // 先在代表性 thought 范围内匹配动机关键词，未命中则回退到全部 thought；
    // 仍无匹配时取首条代表性 thought 前 80 字，避免该字段轻易为 undefined。
    // 关键词覆盖规格 §13 示例（怕/需要/希望）+ 常见动机表达（喜欢/觉得/重要/值/应该/靠谱/为什么）。
    const allThoughts = groupFacts.flatMap((f) => f.thoughts);
    const motivationRegex = /想|需要|怕|希望|好奇|兴趣|担心|期待|图|求|喜欢|觉得|重要|为什么|值|应该|靠谱|贵|便宜/;
    const matchedThought = allThoughts.find((t) => motivationRegex.test(t.text));
    const fallbackThought = allThoughts[0];
    const typicalMotivation = matchedThought
      ? matchedThought.text.slice(0, 80)
      : fallbackThought
        ? fallbackThought.text.slice(0, 80)
        : undefined;

    // mainBarrier：从 mainExitReasons 推导该组主要障碍
    // 例如 "正常结束" → undefined（无明确障碍），"证据不足" → "证据不足导致离开"
    const rawMainExitReason = exitReasons[0];
    const mainBarrier = rawMainExitReason
      ? (() => {
          const label = EXIT_REASON_LABELS[rawMainExitReason as ExitReasonCategory] ?? rawMainExitReason;
          // 仅对真正表征障碍的离开原因生成 mainBarrier，正常离开不写
          if (rawMainExitReason === "finished_normally" || rawMainExitReason === "no_more_action") {
            return undefined;
          }
          return `${label}导致离开`;
        })()
      : undefined;

    // handlingSuggestion：基于规格 §11.4 二维矩阵（纵轴命中度 × 横轴反应强度）推导处理建议。
    // 四象限：
    //   高命中 + 高反应 → 核心机会人群：重点优化，保留打动他们的部分
    //   高命中 + 低反应 → 优先修复人群：核心目标但本次未激发，重审吸引力
    //   低命中 + 高反应 → 意外扩展人群：出现意外扩展信号，下一轮单独验证
    //   低命中 + 低反应 → 低参考权重人群：作为对照/边界参考
    // 中命中单列：相邻人群补充视角
    const handlingSuggestion: string =
      targetAudienceFit === "high" && hasPositiveAction
        ? "作为核心目标人群重点优化，保留打动他们的部分"
      : targetAudienceFit === "high" && !hasPositiveAction
        ? "作为核心目标人群重点优化，但本次未激发足够行为，需要重审吸引力"
      : targetAudienceFit === "medium"
        ? "作为相邻人群补充视角，关注其与核心人群的差异信号"
      : targetAudienceFit === "low" && hasPositiveAction
        ? "出现意外扩展信号，建议在下一轮单独验证是否值得扩展目标人群"
      : "作为对照/边界参考，不作为主要修改依据";

    const stats: AudienceGroupStats = {
      directiveId,
      directiveName,
      role,
      confidence,
      targetAudienceFit,
      modificationWeight,
      typicalMotivation,
      mainBarrier,
      handlingSuggestion,
      total,
      opened,
      readSkim,
      readPartial,
      readFull,
      viewedComments,
      liked,
      favorited,
      commented,
      shared,
      positiveActionActors,
      riskExitCount,
      mainExitReasons,
      mainCommentIntents,
      representativeThoughts,
      representativeComments,
      representativeJourneys,
      evidenceRefs
    };
    groups.push(stats);
    addEvidence(index, item(`group:${directiveId}`, "group", directiveName, `${directiveName}：${total} 人，点开 ${opened} 人，正向互动 ${positiveActionActors} 人，风险离开 ${riskExitCount} 人`, undefined, { role, total, opened, positiveActionActors, targetAudienceFit, modificationWeight }));
  }

  // 跨组判断
  const coreGroups = groups.filter((g) => g.role === "core_target");
  const peripheralGroups = groups.filter((g) => g.role === "peripheral_target");
  const contrastGroups = groups.filter((g) => g.role === "contrast");

  const coreTargetHit = coreGroups.some((g) => g.total > 0 && g.opened / g.total >= 0.5);
  // core_target 中 interested_but_not_convinced 人数 >= 2
  // 注意：外层不能遍历 coreGroups，否则同一 fact 会被按 core_target directive 数量重复计数。
  // 直接遍历 facts，每个 fact 只计一次。
  let coreInterestedLowTrust = 0;
  for (const f of facts.values()) {
    if (f.directiveId && input.directives.some((d) => d.id === f.directiveId && d.groupRole === "core_target")) {
      if (f.segments.includes("interested_but_not_convinced")) coreInterestedLowTrust++;
    }
  }
  const coreTargetHighInterestLowTrust = coreInterestedLowTrust >= 2;
  const peripheralExpansionOpportunity = peripheralGroups.some((g) => g.total > 0 && g.opened / g.total >= 0.4);
  const contrastSkipExpected = contrastGroups.length > 0 && contrastGroups.every((g) => g.total === 0 || g.opened / g.total < 0.3);
  const contrastUnexpectedRisk = contrastGroups.some((g) => g.riskExitCount > 0 || g.mainCommentIntents.some((i) => i === INTENT_LABELS.doubt || i === INTENT_LABELS.pushback));

  const allUnknown = groups.length === 0 || groups.every((g) => g.role === "unknown");
  const confidence: "low" | "high" = allUnknown ? "low" : "high";
  const inferredGroups = input.directives.map((d) => d.name);

  const crossSummaryParts: string[] = [];
  if (coreGroups.length === 0) {
    crossSummaryParts.push("未识别到核心目标人群分组。");
  } else if (coreTargetHit) {
    crossSummaryParts.push("核心目标人群点开率达标。");
  } else {
    crossSummaryParts.push("核心目标人群点开率未达标。");
  }
  if (coreTargetHighInterestLowTrust) crossSummaryParts.push("核心目标人群中存在高兴趣低信任观众。");
  if (peripheralExpansionOpportunity) crossSummaryParts.push("外围目标人群有扩展机会。");
  if (contrastUnexpectedRisk) crossSummaryParts.push("对照组出现非预期风险信号。");

  return {
    groups,
    inferredGroups,
    confidence,
    crossGroupSummary: crossSummaryParts.join(""),
    coreTargetHit,
    coreTargetHighInterestLowTrust,
    peripheralExpansionOpportunity,
    contrastSkipExpected,
    contrastUnexpectedRisk,
    evidenceRefs: groups.map((g) => ref(`group:${g.directiveId}`, "group", g.directiveName))
  };
}

// ── journeySamples ──

function summarizeToolOutput(toolName: string, output: unknown): string {
  const o = objectRecord(output);
  switch (toolName) {
    case "open_post": return "点开帖子";
    case "read_post": {
      const depth = parseReadDepth(o.depth) ?? "skim";
      return `阅读正文（${READ_DEPTH_LABELS[depth]}）`;
    }
    case "view_comments": return "查看评论";
    case "like_post": return "点赞";
    case "favorite_post": return "收藏";
    case "share_post": return "分享";
    case "write_comment": {
      const intent = parseIntent(o.intent);
      return intent ? `评论（${INTENT_LABELS[intent]}）` : "评论";
    }
    case "like_comment": return "点赞评论";
    case "exit_browsing": {
      const reason = parseExitReason(o.reasonCategory);
      return reason ? `离开（${EXIT_REASON_LABELS[reason]}）` : "离开";
    }
    default: return toolName;
  }
}

function pickRichestParticipant(groupFacts: ParticipantFacts[], exclude: Set<string> = new Set()): ParticipantFacts | null {
  const candidates = groupFacts.filter((f) => !exclude.has(f.id));
  if (candidates.length === 0) return null;
  const [first, ...rest] = candidates;
  if (!first) return null;
  return rest.reduce((best, f) => (f.toolCalls.length > best.toolCalls.length ? f : best), first);
}

function buildJourneySamples(facts: Map<string, ParticipantFacts>, input: EvidencePackInput, index: Record<string, EvidenceItem>): JourneySample[] {
  const bySegment = new Map<SegmentKey, ParticipantFacts[]>();
  for (const key of ["interested_but_not_convinced", "persuaded", "skeptical", "skipped"] as SegmentKey[]) {
    bySegment.set(key, []);
  }
  for (const fact of facts.values()) {
    for (const key of fact.segments) {
      bySegment.get(key)?.push(fact);
    }
  }

  // 每类 segment 选 1-2 个典型参与者，总共最多 6 个
  const segmentOrder: SegmentKey[] = ["interested_but_not_convinced", "persuaded", "skeptical", "skipped"];
  const selected: Array<{ key: SegmentKey; fact: ParticipantFacts }> = [];
  const usedIds = new Set<string>();
  // 第一轮：每类选 1 个
  for (const key of segmentOrder) {
    if (selected.length >= 6) break;
    const groupFacts = bySegment.get(key) ?? [];
    const picked = pickRichestParticipant(groupFacts, usedIds);
    if (picked) {
      selected.push({ key, fact: picked });
      usedIds.add(picked.id);
    }
  }
  // 第二轮：每类再选 1 个
  for (const key of segmentOrder) {
    if (selected.length >= 6) break;
    const groupFacts = bySegment.get(key) ?? [];
    const picked = pickRichestParticipant(groupFacts, usedIds);
    if (picked) {
      selected.push({ key, fact: picked });
      usedIds.add(picked.id);
    }
  }

  // thoughtByTurnId / thoughtByToolCallId
  const thoughtByTurnId = new Map<string, string>();
  for (const turn of input.turns) {
    if (turn.thoughtText) thoughtByTurnId.set(turn.id, turn.thoughtText);
  }
  const thoughtByToolCallId = new Map<string, string>();
  for (const log of input.logs) {
    if (log.thoughtText && log.toolCallId) thoughtByToolCallId.set(log.toolCallId, log.thoughtText);
  }
  const journeyByParticipant = new Map<string, EvidencePackInput["journeys"][number]>();
  for (const j of input.journeys) {
    if (j.participantId) journeyByParticipant.set(j.participantId, j);
  }

  const samples: JourneySample[] = [];
  for (const { key, fact } of selected) {
    const tcs = [...fact.toolCalls].sort((a, b) => {
      const ta = a.simulatedTime ?? 0;
      const tb = b.simulatedTime ?? 0;
      if (ta !== tb) return ta - tb;
      return a.callIndex - b.callIndex;
    });
    const steps: JourneySample["steps"] = [];
    for (const tc of tcs) {
      const thought = thoughtByToolCallId.get(tc.id) ?? (tc.agentTurnId ? thoughtByTurnId.get(tc.agentTurnId) : undefined);
      const step: JourneySample["steps"][number] = { action: tc.toolName };
      if (thought) step.thought = thought;
      step.toolOutputSummary = summarizeToolOutput(tc.toolName, tc.output);
      if (tc.simulatedTime != null) step.simulatedTime = tc.simulatedTime;
      steps.push(step);
      addEvidence(index, item(`tool_call:${tc.id}`, "tool_call", `${fact.displayName} - ${tc.toolName}`, summarizeToolOutput(tc.toolName, tc.output), fact.id, { toolName: tc.toolName, status: tc.status }));
    }
    const journey = journeyByParticipant.get(fact.id);
    const summary = journey?.finalSummary ?? journey?.thoughtSummary ?? `${fact.displayName} 的试映旅程（${steps.length} 步）`;
    const segmentKeys = fact.segments.length > 0 ? fact.segments : [key];
    const evidenceId = `journey:${fact.id}`;
    const evidenceRefs: EvidenceRef[] = [
      ref(evidenceId, "journey", `${fact.displayName} 的旅程`),
      ...tcs.slice(0, 3).map((tc) => ref(`tool_call:${tc.id}`, "tool_call", tc.toolName, fact.id))
    ];
    samples.push({ evidenceId, participantId: fact.id, displayName: fact.displayName, segmentKeys, summary, steps, evidenceRefs });
    addEvidence(index, item(evidenceId, "journey", `${fact.displayName} 的试映旅程`, summary, fact.id, { segmentKeys, stepCount: steps.length }));
  }

  return samples;
}

// ── 主构建函数 ──

export function buildEvidencePack(input: EvidencePackInput): EvidencePack {
  const { phaseByTurnId } = buildPhaseMaps(input);
  const facts = buildParticipantFacts(input, phaseByTurnId);
  const evidenceIndex: Record<string, EvidenceItem> = {};

  const meta = buildMeta(input);
  addEvidence(evidenceIndex, item("metric:audienceCount", "metric", "试映观众数", String(input.audienceCount), undefined, { audienceCount: input.audienceCount }));
  addEvidence(evidenceIndex, item("metric:completedCount", "metric", "完成观众数", String(input.completedCount)));
  addEvidence(evidenceIndex, item("metric:failedCount", "metric", "失败观众数", String(input.failedCount)));

  const content = buildContentSnapshot(input.content);
  const funnel = buildFunnel(input, facts, evidenceIndex);
  const exitAnalysis = buildExitAnalysis(input, evidenceIndex);
  const commentAnalysis = buildCommentAnalysis(input, evidenceIndex);
  const thoughtAnalysis = buildThoughtAnalysis(facts, evidenceIndex);
  const segments = buildSegments(facts, input.audienceCount, evidenceIndex);
  const blockers = buildBlockers(facts, input, evidenceIndex);
  const journeySamples = buildJourneySamples(facts, input, evidenceIndex);
  const audienceGroups = buildAudienceGroups(facts, input, evidenceIndex);

  return {
    meta,
    content,
    funnel,
    exitAnalysis,
    commentAnalysis,
    thoughtAnalysis,
    segments,
    blockers,
    audienceGroups,
    journeySamples,
    evidenceIndex
  };
}

// ── 推荐规则 ──

export function recommendFromEvidence(pack: EvidencePack): Recommendation {
  if (pack.meta.evidenceQuality === "low") {
    return "recommend_retest";
  }

  const coreGroup = pack.audienceGroups.groups.find((g) => g.role === "core_target");
  const coreOpenRate = coreGroup && coreGroup.total > 0
    ? coreGroup.opened / coreGroup.total
    : pack.funnel.openRate;
  const coreOpenRateHigh = coreOpenRate != null && coreOpenRate >= 0.6;
  const coreOpenRateNotLow = coreOpenRate != null && coreOpenRate >= 0.4;

  const riskExitRateVsAudience = pack.meta.audienceCount > 0
    ? pack.exitAnalysis.riskExitCount / pack.meta.audienceCount
    : 0;
  const riskExitLow = riskExitRateVsAudience < 0.2;

  const positiveActionMediumOrHigh = pack.funnel.positiveActionRate != null && pack.funnel.positiveActionRate > 0.3;

  const hasHighBlocker = pack.blockers.some((b) => b.severity === "high");
  const hasMediumOrHighBlocker = pack.blockers.some((b) => b.severity === "medium" || b.severity === "high");

  if (coreOpenRateHigh && !hasHighBlocker && riskExitLow && positiveActionMediumOrHigh) {
    return "recommend_publish";
  }
  if (coreOpenRateNotLow && hasMediumOrHighBlocker) {
    return "modify_then_publish";
  }
  return "not_recommend_current_version";
}

// ── 选择主阻断点 ──

export function selectMainBlocker(blockers: EvidenceBlocker[]): EvidenceBlocker | null {
  if (blockers.length === 0) return null;
  const severityRank: Record<Severity, number> = { high: 3, medium: 2, low: 1 };
  const sorted = [...blockers].sort((a, b) => {
    const sr = severityRank[b.severity] - severityRank[a.severity];
    if (sr !== 0) return sr;
    return b.affectedCount - a.affectedCount;
  });
  return sorted[0] ?? null;
}

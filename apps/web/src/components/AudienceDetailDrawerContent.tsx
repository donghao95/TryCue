import { useState } from "react";
import { useTranslation } from "react-i18next";
import type {
  ActionLogItem,
  ActionLogStructuredData,
  AudienceDetail,
  AudienceSeatStatus,
  JourneyExitOutcome
} from "@trycue/shared/run";
import i18n from "../i18n.js";
import { classifyDrawerTimelineItem, formatTime, statusLabel, type DrawerTimelineKind } from "../lib/format.js";
import { AudienceAvatar, DrawerField } from "./VenueWidgets.js";

export type DrawerTimelineEntry = {
  id?: string;
  turnId?: string;
  simulatedTime: number;
  action?: string;
  logType?: string;
  observableLog: string;
  kind: DrawerTimelineKind;
  data?: ActionLogStructuredData;
};

export function timelineKindLabel(kind: DrawerTimelineKind): string {
  if (kind === "thought") return i18n.t("venue.timeline.thought");
  if (kind === "action") return i18n.t("venue.timeline.action");
  if (kind === "comment") return i18n.t("venue.timeline.comment");
  if (kind === "exception") return i18n.t("venue.timeline.exception");
  return i18n.t("venue.timeline.result");
}

export function buildDrawerTimeline(audienceDetail: AudienceDetail, currentLiveLogs: ActionLogItem[]): DrawerTimelineEntry[] {
  const merged = [
    ...audienceDetail.timeline.map((item) => ({
      id: item.id ?? `tl-${item.simulatedTime}-${item.action}`,
      turnId: item.turnId,
      simulatedTime: item.simulatedTime,
      action: item.action,
      logType: undefined as string | undefined,
      observableLog: item.observableLog,
      data: item.data
    })),
    ...currentLiveLogs.map((log) => ({
      id: log.id,
      turnId: log.turnId,
      simulatedTime: log.simulatedTime,
      action: log.action ?? undefined,
      logType: log.logType,
      observableLog: log.text,
      data: log.data
    }))
  ];
  return merged
    .filter((item, index, items) => items.findIndex((other) => other.id === item.id) === index)
    .sort((a, b) => a.simulatedTime - b.simulatedTime)
    .map((item) => ({ ...item, kind: classifyDrawerTimelineItem(item.action, item.logType) }))
    .filter((item) => item.kind === "thought" || item.kind === "action" || item.kind === "comment" || item.kind === "exception");
}

export function drawerTimelineKey(item: DrawerTimelineEntry) {
  return item.id ?? `${item.simulatedTime}-${item.kind}-${item.action ?? ""}-${item.observableLog}`;
}

export function timelineKindOrder(kind: DrawerTimelineKind): number {
  if (kind === "thought") return 0;
  if (kind === "action") return 1;
  if (kind === "comment") return 2;
  if (kind === "exception") return 3;
  return 4;
}

export function stripAudienceNamePrefix(text: string, name: string) {
  const trimmedName = name.trim();
  if (!trimmedName || !text.startsWith(trimmedName)) return text;
  return text.slice(trimmedName.length).trimStart();
}

export function timelineActionDisplayText(entry: DrawerTimelineEntry, strippedObservableLog?: string): string {
  const { t } = i18n;
  const fallback = strippedObservableLog ?? entry.observableLog;
  const data = entry.data;
  if (!data?.toolName) return fallback;
  const input = data.input ?? {};
  const output = data.output ?? {};
  switch (data.toolName) {
    case "open_post":
      return t("venue.actionText.open_post");
    case "read_post": {
      const depth = typeof input.depth === "string" ? input.depth : typeof output.depth === "string" ? output.depth : undefined;
      const depthText = depth === "skim" ? t("venue.actionText.read_post_skim")
        : depth === "partial" ? t("venue.actionText.read_post_partial")
        : depth === "full" ? t("venue.actionText.read_post_full")
        : t("venue.actionText.read_post");
      const focus = Array.isArray(input.focus) ? input.focus.filter((f): f is string => typeof f === "string") : [];
      if (focus.length > 0) return `${depthText} ${t("venue.actionText.focusPrefix")}${focus.join(" / ")}`;
      return depthText;
    }
    case "view_comments":
      return t("venue.actionText.view_comments");
    case "like_post":
      return t("venue.actionText.like_post");
    case "favorite_post":
      return t("venue.actionText.favorite_post");
    case "share_post":
      return t("venue.actionText.share_post");
    case "write_comment": {
      const content = typeof input.content === "string" ? input.content : undefined;
      return content ? `${t("venue.actionText.write_comment_prefix")}${content}` : t("venue.actionText.write_comment");
    }
    case "like_comment":
      return t("venue.actionText.like_comment");
    case "exit_browsing": {
      const reasonCategory = typeof input.reasonCategory === "string" ? input.reasonCategory : typeof output.reasonCategory === "string" ? output.reasonCategory : undefined;
      const reasonText = reasonCategory ? t(`venue.exitReasonCategory.${reasonCategory}`, { defaultValue: "" }) : "";
      return reasonText ? `${t("venue.actionText.exit_browsing")}（${reasonText}）` : t("venue.actionText.exit_browsing");
    }
    default:
      return fallback;
  }
}

export function AudienceDetailDrawerContent({
  audienceDetail,
  currentLiveLogs
}: {
  audienceDetail: AudienceDetail;
  currentLiveLogs: ActionLogItem[];
}) {
  const { t } = useTranslation();
  const [timelineExpanded, setTimelineExpanded] = useState(false);
  const timeline = buildDrawerTimeline(audienceDetail, currentLiveLogs)
    .map((item) => ({
      ...item,
      observableLog: stripAudienceNamePrefix(item.observableLog, audienceDetail.persona.name)
    }))
    .sort((a, b) => {
      const timeDiff = b.simulatedTime - a.simulatedTime;
      return timeDiff !== 0 ? timeDiff : timelineKindOrder(a.kind) - timelineKindOrder(b.kind);
    });
  const recentTimeline = timeline.slice(0, 5);
  const olderTimeline = timeline.slice(5);
  const interactions = audienceDetail.interactions.map((item) => item.type);
  const badges: Array<{ key: string; icon: string; label: string }> = [];
  if (audienceDetail.journey.exitOutcome === "risk_exit") badges.push({ key: "doubt", icon: "!", label: t("venue.legend.doubt") });
  if (audienceDetail.comments.length > 0) badges.push({ key: "comment", icon: "●", label: t("venue.legend.comment") });
  if (interactions.includes("favorite_post")) badges.push({ key: "favorite", icon: "★", label: t("venue.legend.favorite") });
  if (interactions.includes("share_post")) badges.push({ key: "share", icon: "↗", label: t("venue.legend.share") });
  if (interactions.includes("like_post") || interactions.includes("like_comment")) badges.push({ key: "like", icon: "♥", label: t("venue.legend.like") });
  if (interactions.includes("open_post") || interactions.includes("view_comments")) badges.push({ key: "open", icon: "○", label: t("venue.legend.open") });
  const hasExitMetrics = Boolean(
    audienceDetail.journey.exitReasonCategory ||
    audienceDetail.journey.exitReadingDepth ||
    audienceDetail.journey.exitInterestLevel ||
    audienceDetail.journey.exitTrustLevel
  );
  const recapText = audienceDetail.journey.finalSummary || audienceDetail.journey.exitReason || t("venue.drawer.noFinalFeedback");

  return (
    <div className="drawerBody audienceReviewBody">
      <section className="drawerHero">
        <div className="drawerIdentity compact">
          <AudienceAvatar name={audienceDetail.persona.name} seed={audienceDetail.participantId} src={audienceDetail.avatarUrl} />
          <div>
            <h3>{audienceDetail.persona.name}</h3>
            <p>{audienceDetail.persona.segment}</p>
          </div>
        </div>
        <div className="drawerStatusRow">
          <span className="drawerStatusChip">{statusLabel(audienceDetail.journey.status as AudienceSeatStatus)}</span>
          {audienceDetail.journey.exitOutcome ? (
            <span className="drawerStatusChip muted">{journeyExitOutcomeLabel(audienceDetail.journey.exitOutcome)}</span>
          ) : null}
        </div>
        <div className="drawerBehaviorBadges">
          {badges.length ? badges.map((badge) => (
            <span className={`drawerBehaviorBadge ${badge.key}`} key={badge.key}>
              <i>{badge.icon}</i>
              {badge.label}
            </span>
          )) : <p className="muted">{t("venue.drawer.noBehavior")}</p>}
        </div>
      </section>

      <section className="drawerReviewCard primaryReview">
        <div className="drawerSectionTitle">
          <h4>{t("venue.drawer.recap")}</h4>
        </div>
        <div className="drawerInsightList">
          <DrawerInsight label={t("venue.drawer.finalFeedback")} value={recapText} />
          {audienceDetail.journey.exitOutcome ? <DrawerInsight label={t("venue.drawer.outcome")} value={journeyExitOutcomeLabel(audienceDetail.journey.exitOutcome)} /> : null}
          <DrawerInsight label={t("venue.drawer.comments")} value={audienceDetail.comments.length ? t("venue.drawer.commentCount", { count: audienceDetail.comments.length }) : t("venue.drawer.noCommentsCompact")} />
        </div>
        {hasExitMetrics ? (
          <div className="drawerMetricStrip">
            {audienceDetail.journey.exitReasonCategory ? (
              <span><i>{t("venue.drawer.exitReasonCategory")}</i>{t(`venue.exitReasonCategory.${audienceDetail.journey.exitReasonCategory}`)}</span>
            ) : null}
            {audienceDetail.journey.exitReadingDepth ? (
              <span><i>{t("venue.drawer.exitReadingDepth")}</i>{t(`venue.readingDepth.${audienceDetail.journey.exitReadingDepth}`)}</span>
            ) : null}
            {audienceDetail.journey.exitInterestLevel ? (
              <span><i>{t("venue.drawer.exitInterestLevel")}</i>{t(`venue.level.${audienceDetail.journey.exitInterestLevel}`)}</span>
            ) : null}
            {audienceDetail.journey.exitTrustLevel ? (
              <span><i>{t("venue.drawer.exitTrustLevel")}</i>{t(`venue.level.${audienceDetail.journey.exitTrustLevel}`)}</span>
            ) : null}
          </div>
        ) : null}
      </section>

      {audienceDetail.comments.length ? (
        <section className="drawerReviewCard drawerCommentsSection">
          <div className="drawerSectionTitle">
            <h4>{t("venue.drawer.comments")}</h4>
          </div>
          {audienceDetail.comments.map((comment, index) => (
            <div className="drawerCommentItem" key={index}>
              <p className="quote">{comment.commentText}</p>
              {comment.intent ? <span className="drawerCommentIntent">{t(`venue.commentIntent.${comment.intent}`)}</span> : null}
            </div>
          ))}
        </section>
      ) : null}

      <section className="drawerReviewCard drawerTimelineSection">
        <div className="drawerSectionTitle">
          <h4>{t("venue.drawer.timeline")}</h4>
        </div>
        <TimelineList items={recentTimeline} emptyText={t("venue.drawer.noTimeline")} />
        {timelineExpanded ? (
          <div className="remainingTimeline">
            <TimelineList items={olderTimeline} emptyText={t("venue.drawer.noTimeline")} />
          </div>
        ) : null}
        {olderTimeline.length > 0 ? (
          <button className="timelineToggleButton" type="button" onClick={() => setTimelineExpanded((expanded) => !expanded)}>
            {timelineExpanded ? t("venue.drawer.collapseTimeline") : t("venue.drawer.expandTimeline", { count: olderTimeline.length })}
          </button>
        ) : null}
      </section>

      <details className="drawerProfileDetails">
        <summary>{t("venue.drawer.profileContext")}</summary>
        <div className="drawerProfileGrid">
          <DrawerField label={t("venue.drawer.roleBackground")} value={audienceDetail.persona.profile} />
          <DrawerField label={t("venue.drawer.personality")} value={audienceDetail.persona.personality} />
          <DrawerField label={t("venue.drawer.mbti")} value={audienceDetail.persona.mbtiType} />
          <DrawerField label={t("venue.drawer.responseStyle")} value={audienceDetail.persona.responseStyle} />
        </div>
      </details>
    </div>
  );
}

export function DrawerInsight({ label, value }: { label: string; value: string }) {
  return (
    <div className="drawerInsight">
      <span>{label}</span>
      <p>{value}</p>
    </div>
  );
}

export function TimelineList({ items, emptyText }: { items: DrawerTimelineEntry[]; emptyText: string }) {
  if (items.length === 0) return <p className="muted">{emptyText}</p>;
  return (
    <div className="drawerTimeline">
      {items.map((item, index) => (
        <TimelineRow item={item} key={item.id ?? `${drawerTimelineKey(item)}-${index}`} />
      ))}
    </div>
  );
}

export function TimelineRow({ item }: { item: DrawerTimelineEntry }) {
  const text = timelineActionDisplayText(item);
  return (
    <div className={`timelineItem timelineItem-${item.kind}`}>
      <span className="timelineTime">{formatTime(item.simulatedTime)}</span>
      <div className="timelineContent">
        <span className="timelineKind">{timelineKindLabel(item.kind)}</span>
        <p title={text}>{text}</p>
      </div>
    </div>
  );
}

export function journeyExitOutcomeLabel(outcome: JourneyExitOutcome): string {
  if (outcome === "skipped") return i18n.t("venue.exitOutcome.skipped");
  if (outcome === "browsed_and_left") return i18n.t("venue.exitOutcome.browsed_and_left");
  if (outcome === "risk_exit") return i18n.t("venue.exitOutcome.risk_exit");
  return i18n.t("venue.exitOutcome.max_steps");
}

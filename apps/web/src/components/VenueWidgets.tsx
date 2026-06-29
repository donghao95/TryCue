import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { CheckCircle2, FileText, Heart, Home, Loader2, Pause, Play, RotateCcw } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { AudienceSeat, AudienceSeatStatus, CommentItem } from "@trycue/shared";
import type { UiStatus } from "../types.js";
import { formatClock, formatCompact, formatTime, formatValue, hashSeed, lifecycleLabel, statusLabelForRun } from "../lib/format.js";

export function VenueHud({
  status,
  totalAudience,
  finishedCount,
  failedCount,
  currentSimulatedTime,
  hasRuntimeData,
  onPause,
  onResume,
  onReport,
  onResetRuntime,
  onHome
}: {
  status: UiStatus;
  totalAudience: number;
  finishedCount: number;
  failedCount: number;
  currentSimulatedTime: number;
  hasRuntimeData: boolean;
  onPause: () => void;
  onResume: () => void;
  onReport: () => void;
  onResetRuntime: () => void;
  onHome: () => void;
}) {
  const { t } = useTranslation();
  const paused = status === "paused";
  const running = status === "running";
  const pausing = status === "pausing";
  const completed = status === "completed" || status === "report_generating";
  const audienceReady = status === "audience_ready";
  const resetRuntimeDisabled = !(hasRuntimeData && (audienceReady || paused || completed));
  const resetRuntimeTitle = audienceReady
    ? t("venueHud.resetRuntimeTitle")
    : paused
      ? t("venueHud.resetRuntimeTitle")
      : completed
        ? t("venueHud.resetRuntimeTitle")
        : running
          ? t("venueHud.resetRuntimeDisabledRunning")
          : pausing
            ? t("venueHud.resetRuntimeDisabledPausing")
            : t("venueHud.resetRuntimeDisabledOther");
  const clockControl = paused ? (
    <button className="hudTimeControl" type="button" onClick={onResume}><Play size={15} />{t("venueHud.resume")}</button>
  ) : pausing ? (
    <button className="hudTimeControl" type="button" disabled><Pause size={15} />{t("venueHud.pausing")}</button>
  ) : running ? (
    <button className="hudTimeControl" type="button" onClick={onPause}><Pause size={15} />{t("venueHud.pause")}</button>
  ) : completed ? (
    <button className="hudTimeControl" type="button" disabled><CheckCircle2 size={15} />{t("venueHud.completed")}</button>
  ) : (
    <button className="hudTimeControl" type="button" disabled><Pause size={15} />{t("venueHud.waiting")}</button>
  );
  const reportControlLabel = paused ? t("venueHud.endAndReport") : t("venueHud.viewReport");
  const reportControlDisabled = !(paused || completed);
  const reportControlTitle = paused
    ? t("venueHud.reportTitlePaused")
    : completed
      ? t("venueHud.reportTitleCompleted")
      : t("venueHud.reportTitleDisabled");
  return (
    <header className="venueHud">
      <div className="hudMain">
        <div className="brandBlock">
          <strong>{statusLabelForRun(status)}</strong>
          <span>{t("venueHud.aiSimulation")}</span>
          <i />
        </div>
        <div className="hudSnapshot">
          <HudMeasure title={`${finishedCount}`} suffix={`/ ${totalAudience}`} label={t("venueHud.simProgress")} />
          {failedCount > 0 ? <span className="hudAbnormalChip fail">{t("venueHud.failN", { count: failedCount })}</span> : null}
          <div className="hudClockGroup">
            <HudMeasure title={formatClock(currentSimulatedTime)} label={t("venueHud.simTime")} compact />
            {clockControl}
          </div>
        </div>
      </div>
      <div className="hudControls">
        <button
          className="hudReportControl hudResetControl"
          type="button"
          onClick={onResetRuntime}
          disabled={resetRuntimeDisabled}
          title={resetRuntimeTitle}
        >
          <RotateCcw size={15} />
          {t("venueHud.resetRun")}
        </button>
        <button
          className="hudReportControl"
          type="button"
          onClick={onReport}
          disabled={reportControlDisabled}
          title={reportControlTitle}
        >
          <FileText size={15} />
          {reportControlLabel}
        </button>
        <button
          className="hudReportControl hudHomeControl"
          type="button"
          onClick={onHome}
          title={t("venueHud.backHome")}
        >
          <Home size={15} />
          {t("venueHud.backHome")}
        </button>
      </div>
    </header>
  );
}

function HudMeasure({ title, suffix, label, compact }: { title: string; suffix?: string; label: string; compact?: boolean }) {
  return (
    <div className={`hudMeasure ${compact ? "compact" : ""}`}>
      <strong>{title}<span>{suffix}</span></strong>
      <em>{label}</em>
    </div>
  );
}

export function AnimatedCommentList({
  comments,
  enteringCommentIds,
  hasMoreComments,
  isLoadingComments,
  onLikeComment,
  onLoadMore,
  pulsingLikeCommentIds,
  totalComments
}: {
  comments: CommentItem[];
  enteringCommentIds: string[];
  hasMoreComments: boolean;
  isLoadingComments: boolean;
  onLikeComment: (comment: CommentItem) => void;
  onLoadMore: () => void;
  pulsingLikeCommentIds: string[];
  totalComments: number;
}) {
  const listRef = useRef<HTMLDivElement | null>(null);
  const previousRects = useRef<Map<string, DOMRect>>(new Map());
  const initialized = useRef(false);
  const enteringIdSet = useMemo(() => new Set(enteringCommentIds), [enteringCommentIds]);
  const pulsingLikeIdSet = useMemo(() => new Set(pulsingLikeCommentIds), [pulsingLikeCommentIds]);
  const commentTree = useMemo(() => buildCommentTree(comments), [comments]);
  const { t } = useTranslation();

  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const nodes = Array.from(list.querySelectorAll<HTMLElement>("[data-comment-id]"));
    const currentRects = new Map<string, DOMRect>();
    nodes.forEach((node) => {
      const commentId = node.dataset.commentId;
      if (commentId) currentRects.set(commentId, node.getBoundingClientRect());
    });

    if (initialized.current) {
      nodes.forEach((node) => {
        const commentId = node.dataset.commentId;
        if (!commentId) return;
        const current = currentRects.get(commentId);
        const previous = previousRects.current.get(commentId);
        if (previous && current) {
          const deltaY = previous.top - current.top;
          if (Math.abs(deltaY) > 1) {
            node.animate([
              { transform: `translateY(${deltaY}px)` },
              { transform: "translateY(0)" }
            ], {
              duration: 340,
              easing: "cubic-bezier(.16, 1, .3, 1)"
            });
          }
        } else if (enteringIdSet.has(commentId)) {
          node.classList.add("commentItemEntering");
          window.setTimeout(() => node.classList.remove("commentItemEntering"), 760);
        }
      });
    } else {
      initialized.current = true;
    }
    previousRects.current = currentRects;
  }, [comments, enteringIdSet]);

  return (
    <div className="commentList" ref={listRef}>
      {commentTree.map((comment) => (
        <CommentThread
          comment={comment}
          key={comment.id}
          onLikeComment={onLikeComment}
          pulsingLikeIdSet={pulsingLikeIdSet}
        />
      ))}
      {isLoadingComments ? (
        <p className="commentLoadState"><Loader2 className="spin" size={14} />{t("venue.comment.loadMore")}</p>
      ) : hasMoreComments ? (
        <button className="commentLoadMore" type="button" onClick={onLoadMore}>{t("venue.comment.loadMore")}</button>
      ) : totalComments ? (
        <p className="commentLoadState">{t("venue.comment.allLoaded")}</p>
      ) : null}
    </div>
  );
}

type CommentTreeItem = CommentItem & {
  replies: CommentTreeItem[];
};

function buildCommentTree(comments: CommentItem[]): CommentTreeItem[] {
  const nodeById = new Map<string, CommentTreeItem>();
  comments.forEach((comment) => {
    nodeById.set(comment.id, { ...comment, replies: [] });
  });

  const roots: CommentTreeItem[] = [];
  comments.forEach((comment) => {
    const node = nodeById.get(comment.id);
    if (!node) return;
    const parent = comment.parentCommentId ? nodeById.get(comment.parentCommentId) : null;
    if (parent) parent.replies.push(node);
    else roots.push(node);
  });
  return roots;
}

function CommentThread({
  comment,
  onLikeComment,
  pulsingLikeIdSet,
  depth = 0
}: {
  comment: CommentTreeItem;
  onLikeComment: (comment: CommentItem) => void;
  pulsingLikeIdSet: Set<string>;
  depth?: number;
}) {
  const { t } = useTranslation();
  const hasReplies = comment.replies.length > 0;
  return (
    <article className={`commentThread depth-${Math.min(depth, 3)}`}>
      <div className="commentItem" data-comment-id={comment.id} data-depth={depth}>
        <AudienceAvatar name={comment.audienceName} seed={comment.id} small />
        <div>
          <div className="commentMeta">
            <strong>{comment.audienceName}</strong>
            <button
              className={`commentLikeButton ${comment.likedByMe ? "active" : ""} ${pulsingLikeIdSet.has(comment.id) ? "pulsing" : ""}`}
              type="button"
              onClick={() => onLikeComment(comment)}
              aria-pressed={comment.likedByMe ? "true" : "false"}
              title={comment.likedByMe ? t("venue.comment.unlike") : t("venue.comment.like")}
            >
              <Heart size={16} fill={comment.likedByMe ? "currentColor" : "none"} />
              <span>{formatCompact(comment.likeCount ?? 0)}</span>
            </button>
          </div>
          <p>{comment.commentText}</p>
          <span>
            {comment.simulatedTime ? formatTime(comment.simulatedTime) : t("venue.comment.minuteAgo")} · {t("venue.comment.reply")}
            {(comment.replyCount ?? 0) > 0 ? ` · ${t("venue.comment.replies", { count: comment.replyCount })}` : ""}
          </span>
        </div>
      </div>
      {hasReplies ? (
        <div className="commentReplies">
          {comment.replies.map((reply) => (
            <CommentThread
              comment={reply}
              depth={depth + 1}
              key={reply.id}
              onLikeComment={onLikeComment}
              pulsingLikeIdSet={pulsingLikeIdSet}
            />
          ))}
        </div>
      ) : null}
    </article>
  );
}

export function PostAction({
  active,
  icon,
  label,
  onClick,
  pulseNonce,
  title
}: {
  active?: boolean;
  icon: ReactNode;
  label: string;
  onClick?: () => void;
  pulseNonce?: number;
  title?: string;
}) {
  return (
    <button
      aria-pressed={active === undefined ? undefined : active ? "true" : "false"}
      className={`postAction ${active ? "active" : ""} ${pulseNonce ? "pulsing" : ""}`}
      data-pulse={pulseNonce ?? undefined}
      title={title}
      type="button"
      onClick={onClick}
    >
      {icon}
      {label}
    </button>
  );
}

const BEHAVIOR_PRIORITY = [
  { key: "doubt", icon: "!" },
  { key: "comment", icon: "●" },
  { key: "favorite", icon: "★" },
  { key: "share", icon: "↗" },
  { key: "like", icon: "♥" },
  { key: "open", icon: "○" }
] as const;

function getSeatBehaviors(seat: AudienceSeat): Array<(typeof BEHAVIOR_PRIORITY)[number]["key"]> {
  const behaviors: Array<(typeof BEHAVIOR_PRIORITY)[number]["key"]> = [];
  if (seat.hasDoubt) behaviors.push("doubt");
  if (seat.hasCommented) behaviors.push("comment");
  if (seat.hasFavorited) behaviors.push("favorite");
  if (seat.hasShared) behaviors.push("share");
  if (seat.hasLiked) behaviors.push("like");
  if (seat.hasOpened) behaviors.push("open");
  return behaviors;
}

export function SeatCell({ seat, onClick }: { seat: AudienceSeat; onClick: () => void }) {
  const { t } = useTranslation();
  const behaviors = getSeatBehaviors(seat);
  const visibleBehaviors = behaviors.slice(0, 2);
  const remainingCount = Math.max(0, behaviors.length - 2);
  return (
    <button className={`seatCell seat-${seat.status}`} onClick={onClick} type="button">
      <div className="seatAvatarWrap">
        <AudienceAvatar name={seat.name} seed={seat.participantId} status={seat.status} src={seat.avatarUrl ?? undefined} />
        <div className={`seatBehaviorBar ${visibleBehaviors.length === 0 ? "empty" : ""}`} aria-hidden={visibleBehaviors.length === 0}>
          {visibleBehaviors.map((key) => {
            const behavior = BEHAVIOR_PRIORITY.find((item) => item.key === key);
            return behavior ? (
              <i className={`seatBehavior ${key}`} key={key} title={t(`venue.legend.${key}`)}>
                {behavior.icon}
              </i>
            ) : null;
          })}
          {remainingCount > 0 ? <i className="seatBehaviorMore">+{remainingCount}</i> : null}
        </div>
      </div>
      <strong>{seat.name}</strong>
      <span>{seat.segment}</span>
      <em className="seatLifecycle">{lifecycleLabel(seat.status)}</em>
    </button>
  );
}

export function AudienceAvatar({
  name,
  seed,
  status,
  src,
  small
}: {
  name: string;
  seed: string;
  status?: AudienceSeatStatus;
  src?: string | null;
  small?: boolean;
}) {
  const [imageFailed, setImageFailed] = useState(false);
  const hue = hashSeed(seed) % 360;
  const style = {
    "--hue": hue,
    "--hue2": (hue + 38) % 360
  } as CSSProperties;
  const imageSrc = src?.trim();
  useEffect(() => {
    setImageFailed(false);
  }, [imageSrc]);
  return (
    <span className={`avatarFace ${small ? "small" : ""} ${status === "watching" ? "watching" : ""}`} style={style}>
      {imageSrc && !imageFailed ? (
        <img alt="" src={imageSrc} onError={() => setImageFailed(true)} />
      ) : (
        <>
          <span className="hair" />
          <span className="face" />
        </>
      )}
    </span>
  );
}

export function DrawerField({ label, value }: { label: string; value: unknown }) {
  const text = formatValue(value);
  if (!text) return null;
  return (
    <section>
      <h4>{label}</h4>
      <p>{text}</p>
    </section>
  );
}

import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { CheckCircle2, Loader2, Search, Send, Sparkles, X, AlertTriangle } from "lucide-react";
import type {
  AudienceSamplingPlanRevisionOperation,
  AudienceSamplingPlanRevisionProposal,
  AudienceSeatRevisionOperation,
  AudienceSeatRevisionProposal
} from "@trycue/shared/audience";
import i18n from "../i18n.js";

export type AssistantStage = "plan" | "seat";

export type AssistantMentionCandidate = {
  id: string;
  refId: string;
  kind: "directive" | "profile";
  label: string;
  detail: string;
  searchText: string;
  context: unknown;
};

export type AssistantMention = AssistantMentionCandidate;

export type AssistantOperation = AudienceSamplingPlanRevisionOperation | AudienceSeatRevisionOperation;
export type AssistantProposal = AudienceSamplingPlanRevisionProposal | AudienceSeatRevisionProposal;

export type AssistantOperationStatus = "idle" | "running" | "success" | "failed" | "not_applicable";

export type AssistantOperationState = {
  status: AssistantOperationStatus;
  message?: string;
};

export type AssistantDialogMessage = {
  id: string;
  role: "user" | "assistant";
  visibleText: string;
  mentions: AssistantMention[];
  proposal?: AssistantProposal;
  operationStates?: Record<string, AssistantOperationState>;
};

export function AssistantDialog({
  isOpen,
  stage,
  title,
  subtitle,
  targetLabels = {},
  messages,
  mentionCandidates,
  placeholder,
  isSending,
  onClose,
  onSend,
  onApplyOperation,
  onApplyAll
}: {
  isOpen: boolean;
  stage: AssistantStage;
  title: string;
  subtitle?: string;
  targetLabels?: Record<string, string>;
  messages: AssistantDialogMessage[];
  mentionCandidates: AssistantMentionCandidate[];
  placeholder: string;
  isSending: boolean;
  onClose: () => void;
  onSend: (text: string, mentions: AssistantMention[]) => void;
  onApplyOperation: (messageId: string, operationId: string) => void;
  onApplyAll: (messageId: string) => void;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState("");
  const [mentions, setMentions] = useState<AssistantMention[]>([]);
  const [activeMentionQuery, setActiveMentionQuery] = useState<string | null>(null);
  const [activeMentionStart, setActiveMentionStart] = useState<number | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const filteredCandidates = useMemo(() => {
    const query = activeMentionQuery ?? "";
    return mentionCandidates
      .filter((candidate) => fuzzyMatch(`${candidate.label} ${candidate.detail} ${candidate.searchText}`, query))
      .slice(0, 8);
  }, [activeMentionQuery, mentionCandidates]);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    textarea.style.height = `${textarea.scrollHeight}px`;
  }, [draft]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  function handleDraftChange(value: string, caretIndex?: number) {
    setDraft(value);
    const caret = caretIndex ?? textareaRef.current?.selectionStart ?? value.length;
    const beforeCaret = value.slice(0, caret);
    const match = /@([^\s@]*)$/.exec(beforeCaret);
    if (!match) {
      setActiveMentionQuery(null);
      setActiveMentionStart(null);
      return;
    }
    setActiveMentionQuery(match[1] ?? "");
    setActiveMentionStart(caret - match[0].length);
  }

  function insertMention(candidate: AssistantMentionCandidate) {
    const textarea = textareaRef.current;
    const caret = textarea?.selectionStart ?? draft.length;
    const start = activeMentionStart ?? caret;
    const nextDraft = `${draft.slice(0, start)}@${candidate.label} ${draft.slice(caret)}`;
    const nextCaret = start + candidate.label.length + 2;
    setDraft(nextDraft);
    setMentions((current) => mergeMentions(current, [candidate]));
    setActiveMentionQuery(null);
    setActiveMentionStart(null);
    window.setTimeout(() => {
      textarea?.focus();
      textarea?.setSelectionRange(nextCaret, nextCaret);
    });
  }

  function submitDraft() {
    const text = draft.trim();
    if (!text || isSending) return;
    const resolvedMentions = resolveMentions(text, mentions, mentionCandidates);
    onSend(text, resolvedMentions);
    setDraft("");
    setMentions([]);
    setActiveMentionQuery(null);
    setActiveMentionStart(null);
  }

  function insertDraftNewline() {
    const textarea = textareaRef.current;
    const selectionStart = textarea?.selectionStart ?? draft.length;
    const selectionEnd = textarea?.selectionEnd ?? selectionStart;
    const nextDraft = `${draft.slice(0, selectionStart)}\n${draft.slice(selectionEnd)}`;
    const nextCaret = selectionStart + 1;
    setDraft(nextDraft);
    setActiveMentionQuery(null);
    setActiveMentionStart(null);
    window.setTimeout(() => {
      textarea?.focus();
      textarea?.setSelectionRange(nextCaret, nextCaret);
    });
  }

  return (
    <div className="dialogOverlay assistantDialogOverlay" onClick={onClose}>
      <section className="assistantDialog" role="dialog" aria-modal="true" aria-labelledby={`${stage}-assistant-title`} onClick={(event) => event.stopPropagation()}>
        <header className="assistantDialogHeader">
          <div>
            <span className="dialogKicker"><Sparkles size={14} /> {t(`assistant.stage.${stage}`)}</span>
            <h2 id={`${stage}-assistant-title`}>{title}</h2>
            {subtitle ? <p>{subtitle}</p> : null}
          </div>
          <button className="assistantCloseButton" type="button" onClick={onClose} aria-label={t("common.close")}>
            <X size={18} />
          </button>
        </header>

        <div className="assistantMessageList" aria-live="polite">
          {messages.length ? messages.map((message) => (
            <article className={`assistantMessage ${message.role}`} key={message.id}>
              <div className="assistantMessageBubble">
                {message.proposal ? null : <p>{renderMentionedText(message.visibleText, message.mentions)}</p>}
                {message.proposal ? (
                  <SuggestionCard
                    message={message}
                    targetLabels={targetLabels}
                    onApplyOperation={onApplyOperation}
                    onApplyAll={onApplyAll}
                  />
                ) : null}
              </div>
            </article>
          )) : (
            <div className="assistantEmptyState">
              <Sparkles size={22} />
              <strong>{t(stage === "plan" ? "assistant.empty.planTitle" : "assistant.empty.seatTitle")}</strong>
              <p>{t(stage === "plan" ? "assistant.empty.planBody" : "assistant.empty.seatBody")}</p>
            </div>
          )}
        </div>

        <footer className="assistantComposer">
          {mentions.length ? (
            <div className="assistantSelectedMentions" aria-label={t("assistant.mentionAria")}>
              {mentions.filter((mention) => draft.includes(`@${mention.label}`)).map((mention) => (
                <button key={mention.id} type="button" onClick={() => setMentions((current) => current.filter((item) => item.id !== mention.id))}>
                  @{mention.label}
                  <X size={12} />
                </button>
              ))}
            </div>
          ) : null}
          <div className="assistantInputWrap">
            <textarea
              ref={textareaRef}
              rows={2}
              value={draft}
              placeholder={placeholder}
              onChange={(event) => handleDraftChange(event.target.value, event.target.selectionStart)}
              onKeyDown={(event) => {
                if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
                event.preventDefault();
                if (event.metaKey || event.ctrlKey) {
                  insertDraftNewline();
                  return;
                }
                submitDraft();
              }}
            />
            <div className="assistantComposerMeta">
              <span>{mentions.length ? t("assistant.mentioned", { count: mentions.filter((mention) => draft.includes(`@${mention.label}`)).length }) : t("assistant.mentionHint")}</span>
              <button className="assistantSendButton" type="button" onClick={submitDraft} disabled={!draft.trim() || isSending} aria-label={t("assistant.send")}>
                {isSending ? <Loader2 className="spin" size={16} /> : <Send size={16} />}
              </button>
            </div>
            {activeMentionQuery !== null ? (
              <div className="assistantMentionMenu">
                <div className="assistantMentionSearch"><Search size={13} /> {activeMentionQuery ? t("assistant.mentionSearch", { query: activeMentionQuery }) : t("assistant.mentionEmpty")}</div>
                {filteredCandidates.length ? filteredCandidates.map((candidate) => (
                  <button key={candidate.id} type="button" onClick={() => insertMention(candidate)}>
                    <span>@{candidate.label}</span>
                    <small>{candidate.detail}</small>
                  </button>
                )) : <p>{t("assistant.noMatch")}</p>}
              </div>
            ) : null}
          </div>
        </footer>
      </section>
    </div>
  );
}

function SuggestionCard({
  message,
  targetLabels,
  onApplyOperation,
  onApplyAll
}: {
  message: AssistantDialogMessage;
  targetLabels: Record<string, string>;
  onApplyOperation: (messageId: string, operationId: string) => void;
  onApplyAll: (messageId: string) => void;
}) {
  const { t } = useTranslation();
  const proposal = message.proposal;
  if (!proposal) return null;
  const operations = proposal.operations as AssistantOperation[];
  const states = message.operationStates ?? {};
  const hasApplicableOperation = operations.some((operation) => states[operation.operationId]?.status !== "not_applicable");
  const isApplying = operations.some((operation) => states[operation.operationId]?.status === "running");

  return (
    <section className="suggestionCard">
      <div className="suggestionCardHeader">
        <div>
          <strong>{proposal.summary}</strong>
          {"totalCountChange" in proposal && proposal.totalCountChange ? (
            <span>{proposal.totalCountChange.before} → {proposal.totalCountChange.after} {t("assistant.diff.people")}</span>
          ) : null}
        </div>
        {operations.length && hasApplicableOperation ? (
          <button className="ghostButton iconTextButton" type="button" onClick={() => onApplyAll(message.id)} disabled={isApplying}>
            {isApplying ? <Loader2 className="spin" size={14} /> : <CheckCircle2 size={14} />}
            {t("assistant.applyAll")}
          </button>
        ) : null}
      </div>
      {proposal.warnings.length ? (
        <div className="suggestionWarnings">
          {proposal.warnings.map((warning) => <p key={warning}><AlertTriangle size={14} />{warning}</p>)}
        </div>
      ) : null}
      {operations.length ? (
        <div className="suggestionOperationList">
          {operations.map((operation) => (
            <OperationRow
              key={operation.operationId}
              operation={operation}
              targetLabels={targetLabels}
              state={states[operation.operationId] ?? { status: "idle" }}
              onApply={() => onApplyOperation(message.id, operation.operationId)}
            />
          ))}
        </div>
      ) : <p className="suggestionDiscussionOnly">{t("assistant.discussionOnly")}</p>}
    </section>
  );
}

function OperationRow({
  operation,
  targetLabels,
  state,
  onApply
}: {
  operation: AssistantOperation;
  targetLabels: Record<string, string>;
  state: AssistantOperationState;
  onApply: () => void;
}) {
  const { t } = useTranslation();
  const statusText = operationStatusText(state.status);
  return (
    <article className={`suggestionOperation state-${state.status}`}>
      <div className="operationTopline">
        <div>
          <span>{operationLabel(operation)}</span>
          <strong>{operationTargetText(operation, targetLabels)}</strong>
        </div>
        <em>{statusText}</em>
      </div>
      <p>{operation.reason}</p>
      <OperationDiff operation={operation} />
      {state.message ? <p className="operationStateMessage">{state.message}</p> : null}
      <div className="operationActions">
        <button className="ghostButton iconTextButton" type="button" onClick={onApply} disabled={state.status === "running" || state.status === "success" || state.status === "not_applicable"}>
          {state.status === "running" ? <Loader2 className="spin" size={13} /> : <CheckCircle2 size={13} />}
          {t("assistant.apply")}
        </button>
      </div>
    </article>
  );
}

function OperationDiff({ operation }: { operation: AssistantOperation }) {
  const { t } = useTranslation();
  if (operation.op === "add_directive") {
    return <DiffRows rows={[
      [t("assistant.field.name"), "", operation.directive.name],
      [t("assistant.field.quantity"), "", operation.directive.quantity],
      [t("assistant.field.description"), "", operation.directive.description],
      [t("assistant.field.diversityAxes"), "", operation.directive.diversityAxes],
      [t("assistant.field.rationale"), "", operation.directive.rationale]
    ]} />;
  }
  if (operation.op === "update_directive" || operation.op === "update_identity") {
    const before = operation.before && typeof operation.before === "object" ? operation.before as Record<string, unknown> : {};
    return <DiffRows rows={Object.entries(operation.patch).map(([field, value]) => [fieldLabel(field), before[field], value])} />;
  }
  if (operation.op === "favorite_identity") {
    return <DiffRows rows={[[t("assistant.diff.favoriteLabel"), "", operation.favorited ? t("assistant.diff.favorite") : t("assistant.diff.unfavorite")]]} />;
  }
  if (operation.op === "add_profile") {
    const demographics = operation.demographics;
    const demoSummary = demographics ? [demographics.role, demographics.ageRange, demographics.cityTier].filter(Boolean).join("·") : "";
    return <DiffRows rows={[
      [t("assistant.diff.samplingLabel"), "", operation.samplingLabel],
      [t("assistant.diff.demographics"), "", demoSummary || t("assistant.diff.demographicsEmpty")]
    ]} />;
  }
  return null;
}

function DiffRows({ rows }: { rows: Array<[string, unknown, unknown]> }) {
  const { t } = useTranslation();
  if (!rows.length) return null;
  return (
    <div className="operationDiff">
      {rows.map(([field, before, after]) => (
        <div className="operationDiffRow" key={field}>
          <span>{field}</span>
          <code>{formatValue(before) || t("assistant.diff.emptyValue")}</code>
          <strong>{formatValue(after)}</strong>
        </div>
      ))}
    </div>
  );
}

function renderMentionedText(text: string, mentions: AssistantMention[]) {
  if (!mentions.length) return text;
  const labels = mentions.map((mention) => mention.label).filter(Boolean);
  const pattern = new RegExp(`@(${labels.map(escapeRegExp).join("|")})`, "g");
  const parts: ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) parts.push(text.slice(lastIndex, match.index));
    parts.push(<span className="assistantMentionChip" key={`${match[0]}-${match.index}`}>{match[0]}</span>);
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) parts.push(text.slice(lastIndex));
  return parts;
}

function resolveMentions(text: string, selected: AssistantMention[], candidates: AssistantMentionCandidate[]) {
  const exact = candidates.filter((candidate) => text.includes(`@${candidate.label}`));
  return mergeMentions(selected.filter((mention) => text.includes(`@${mention.label}`)), exact);
}

function mergeMentions(current: AssistantMention[], additions: AssistantMention[]) {
  const byId = new Map(current.map((mention) => [mention.id, mention]));
  for (const mention of additions) byId.set(mention.id, mention);
  return [...byId.values()];
}

function fuzzyMatch(source: string, query: string) {
  const normalizedSource = source.toLowerCase();
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return true;
  if (normalizedSource.includes(normalizedQuery)) return true;
  let index = 0;
  for (const char of normalizedQuery) {
    index = normalizedSource.indexOf(char, index);
    if (index < 0) return false;
    index += 1;
  }
  return true;
}

function operationLabel(operation: AssistantOperation) {
  return i18n.t(`assistant.operation.${operation.op}`);
}

function operationTargetText(operation: AssistantOperation, targetLabels: Record<string, string>) {
  if (operation.op === "add_directive") return operation.directive.name;
  if (operation.op === "update_directive" || operation.op === "delete_directive") return targetLabels[operation.directiveId] ?? operation.directiveId;
  if ("profileId" in operation) return targetLabels[operation.profileId] ?? operation.profileId;
  return targetLabels[operation.directiveId] ?? operation.directiveId;
}

function operationStatusText(status: AssistantOperationStatus) {
  return i18n.t(`assistant.status.${status}`);
}

function fieldLabel(field: string) {
  return i18n.t(`assistant.field.${field}`);
}

function formatValue(value: unknown) {
  if (value === undefined || value === null || value === "") return "";
  if (Array.isArray(value)) return value.join(i18n.t("common.listSeparator"));
  if (typeof value === "object") return JSON.stringify(value, null, 2);
  return String(value);
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

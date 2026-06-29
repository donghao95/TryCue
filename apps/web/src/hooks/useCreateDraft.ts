import { useEffect, useRef, useState } from "react";
import { CUSTOM_AUDIENCE_MAX, CUSTOM_AUDIENCE_MIN } from "@trycue/shared/run";
import type { Scale } from "@trycue/shared/run";
import { MAX_POST_IMAGES } from "../constants.js";
import type { AppRoute, UiStatus } from "../types.js";

export type CreateDraftState = {
  title: string;
  bodyText: string;
  imageUrls: string[];
  scale: Scale;
  customAudienceCount: number;
};

const CREATE_DRAFT_STORAGE_KEY = "trycue:create-draft:v1";

function emptyCreateDraftState(): CreateDraftState {
  return {
    title: "",
    bodyText: "",
    imageUrls: [],
    scale: "quick",
    customAudienceCount: 60
  };
}

function normalizeCreateDraftState(value: unknown): CreateDraftState {
  if (typeof value !== "object" || value === null) return emptyCreateDraftState();
  const draft = value as Partial<CreateDraftState>;
  const scale: Scale = draft.scale === "standard" || draft.scale === "custom" ? draft.scale : "quick";
  const customAudienceCount = typeof draft.customAudienceCount === "number" && Number.isFinite(draft.customAudienceCount)
    ? Math.min(CUSTOM_AUDIENCE_MAX, Math.max(CUSTOM_AUDIENCE_MIN, Math.round(draft.customAudienceCount)))
    : 60;
  return {
    title: typeof draft.title === "string" ? draft.title : "",
    bodyText: typeof draft.bodyText === "string" ? draft.bodyText : "",
    imageUrls: Array.isArray(draft.imageUrls) ? draft.imageUrls.filter((url): url is string => typeof url === "string").slice(0, MAX_POST_IMAGES) : [],
    scale,
    customAudienceCount
  };
}

function readCreateDraftState(): CreateDraftState {
  try {
    const raw = window.localStorage.getItem(CREATE_DRAFT_STORAGE_KEY);
    return raw ? normalizeCreateDraftState(JSON.parse(raw)) : emptyCreateDraftState();
  } catch {
    return emptyCreateDraftState();
  }
}

function writeCreateDraftState(draft: CreateDraftState) {
  try {
    window.localStorage.setItem(CREATE_DRAFT_STORAGE_KEY, JSON.stringify(normalizeCreateDraftState(draft)));
  } catch {
    // localStorage may be unavailable in private mode; the in-memory draft still works for the current page.
  }
}

function clearCreateDraftState() {
  try {
    window.localStorage.removeItem(CREATE_DRAFT_STORAGE_KEY);
  } catch {
    // Ignore storage failures; clearing React state remains the source of truth for the current submit.
  }
}

export function isMeaningfulCreateDraft(draft: CreateDraftState) {
  return Boolean(draft.title.trim() || draft.bodyText.trim() || draft.imageUrls.length);
}

/**
 * Manages the create-page draft: 5 form fields (title, bodyText, imageUrls,
 * scale, customAudienceCount) plus localStorage persistence.
 *
 * Behavior preserved from the original inline state in App.tsx:
 * - On first mount, if route is workbench without runId, reads localStorage
 *   for initial values; otherwise starts empty.
 * - While active (createDraftActiveRef) and route is workbench without runId
 *   and uiStatus is "draft" or "starting", writes the current draft to
 *   localStorage on every change.
 * - `clearDraft()` clears localStorage and resets all 5 fields to empty —
 *   called after a successful run creation.
 * - `reloadFromStorage()` reads localStorage and restores all 5 fields —
 *   called when navigating back to the create page.
 * - `overrideFromContentVersion()` sets title/bodyText/imageUrls from a
 *   server-restore — called by restoreRun. Does NOT touch scale or
 *   customAudienceCount (not persisted on the server).
 * - `setActive()` controls whether the persistence effect writes — called
 *   by the route effect when switching between create page and run page.
 */
export interface UseCreateDraftParams {
  route: AppRoute;
  uiStatus: UiStatus;
}

export interface UseCreateDraftReturn {
  title: string;
  setTitle: (value: string) => void;
  bodyText: string;
  setBodyText: (value: string) => void;
  scale: Scale;
  setScale: (value: Scale) => void;
  customAudienceCount: number;
  setCustomAudienceCount: (value: number) => void;
  imageUrls: string[];
  setImageUrls: (value: string[] | ((prev: string[]) => string[])) => void;
  currentCreateDraft: CreateDraftState;
  /** Clears localStorage and resets all 5 fields to empty defaults. */
  clearDraft: () => void;
  /** Reads localStorage and restores all 5 fields. Called when returning to the create page. */
  reloadFromStorage: () => void;
  /** Sets title/bodyText/imageUrls from a server content version restore. */
  overrideFromContentVersion: (data: { title: string; imageUrls: string[]; bodyText: string }) => void;
  /** Controls whether the persistence effect writes to localStorage. */
  setActive: (active: boolean) => void;
}

export function useCreateDraft(params: UseCreateDraftParams): UseCreateDraftReturn {
  const { route, uiStatus } = params;

  // One-shot lazy init: read localStorage only on first mount, only if on the
  // create page (workbench without runId). On run pages the draft starts empty.
  const initialCreateDraftRef = useRef<CreateDraftState | null>(null);
  if (initialCreateDraftRef.current === null) {
    initialCreateDraftRef.current = route.kind === "workbench" && !route.runId ? readCreateDraftState() : emptyCreateDraftState();
  }

  // Controls whether the persistence effect writes. Set to true when on the
  // create page, false when on a run page (so restoring a run's contentVersion
  // into the title/bodyText/imageUrls fields doesn't overwrite the draft).
  const createDraftActiveRef = useRef(route.kind === "workbench" && !route.runId);

  const [title, setTitle] = useState(() => initialCreateDraftRef.current?.title ?? "");
  const [bodyText, setBodyText] = useState(() => initialCreateDraftRef.current?.bodyText ?? "");
  const [scale, setScale] = useState<Scale>(() => initialCreateDraftRef.current?.scale ?? "quick");
  const [customAudienceCount, setCustomAudienceCount] = useState(() => initialCreateDraftRef.current?.customAudienceCount ?? 60);
  const [imageUrls, setImageUrls] = useState<string[]>(() => initialCreateDraftRef.current?.imageUrls ?? []);

  const currentCreateDraft: CreateDraftState = { title, bodyText, imageUrls, scale, customAudienceCount };

  // Persist draft to localStorage when on the create page and active.
  useEffect(() => {
    if (route.kind !== "workbench" || route.runId) return;
    if (!createDraftActiveRef.current) return;
    if (uiStatus !== "draft" && uiStatus !== "starting") return;
    writeCreateDraftState(currentCreateDraft);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route, title, bodyText, imageUrls, scale, customAudienceCount, uiStatus]);

  function clearDraft() {
    clearCreateDraftState();
    setTitle("");
    setBodyText("");
    setImageUrls([]);
    setScale("quick");
    setCustomAudienceCount(60);
  }

  function reloadFromStorage() {
    const draft = readCreateDraftState();
    setTitle(draft.title);
    setBodyText(draft.bodyText);
    setImageUrls(draft.imageUrls);
    setScale(draft.scale);
    setCustomAudienceCount(draft.customAudienceCount);
  }

  function overrideFromContentVersion(data: { title: string; imageUrls: string[]; bodyText: string }) {
    setTitle(data.title);
    setImageUrls(data.imageUrls);
    setBodyText(data.bodyText);
  }

  function setActive(active: boolean) {
    createDraftActiveRef.current = active;
  }

  return {
    title,
    setTitle,
    bodyText,
    setBodyText,
    scale,
    setScale,
    customAudienceCount,
    setCustomAudienceCount,
    imageUrls,
    setImageUrls,
    currentCreateDraft,
    clearDraft,
    reloadFromStorage,
    overrideFromContentVersion,
    setActive
  };
}

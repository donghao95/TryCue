import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, Check, CheckCircle2, ChevronDown, Loader2, RefreshCw, RotateCcw, Save, Zap } from "lucide-react";
import { LLM_CAPACITY_PRESET_VALUES } from "@trycue/shared";
import type {
  LlmCapacityMode,
  LlmCapacityPreset,
  LlmCapacityProbeJobStartView,
  LlmCapacityProbeJobView,
  LlmCapacityProbeLevelResult,
  LlmCapacityProbeResult,
  LlmCapacityStatus,
  LlmSettingsView,
  ModelListItem
} from "@trycue/shared";
import { AppHeader } from "../components/AppHeader.js";
import { ConfirmDialog } from "../components/ConfirmDialog.js";
import type { NavigationGuard } from "../hooks/useNavigationGuard.js";
import i18n, { APP_LANGUAGES, setAppLanguage, type AppLanguage } from "../i18n.js";
import { request } from "../lib/api.js";

type SettingsTab = "ai" | "system";

function currentAppLanguage(): AppLanguage {
  return (APP_LANGUAGES as readonly string[]).includes(i18n.language) ? (i18n.language as AppLanguage) : "zh-CN";
}

export function SettingsRoute({ onHome, registerNavigationGuard }: { onHome: () => void; registerNavigationGuard: (guard: NavigationGuard) => () => void }) {
  const { t } = useTranslation();
  const [settings, setSettings] = useState<LlmSettingsView | null>(null);
  const [savedSettings, setSavedSettings] = useState<LlmSettingsView | null>(null);
  const [activeTab, setActiveTab] = useState<SettingsTab>("ai");
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [apiKeyDirty, setApiKeyDirty] = useState(false);
  const [languageDraft, setLanguageDraft] = useState<AppLanguage>(() => currentAppLanguage());
  const [savedLanguage, setSavedLanguage] = useState<AppLanguage>(() => currentAppLanguage());
  const [models, setModels] = useState<ModelListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadingModels, setLoadingModels] = useState(false);
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [openModelMenu, setOpenModelMenu] = useState<keyof LlmSettingsView["models"] | null>(null);
  const [pendingConfirm, setPendingConfirm] = useState<{ title: string; body: string; confirmLabel: string; cancelLabel?: string; tone: "danger" | "primary"; onConfirm: () => void } | null>(null);
  const [capacityStatus, setCapacityStatus] = useState<LlmCapacityStatus | null>(null);
  const [probing, setProbing] = useState(false);
  const [probeJob, setProbeJob] = useState<LlmCapacityProbeJobView | null>(null);
  const [probeResult, setProbeResult] = useState<LlmCapacityProbeResult | null>(null);
  const [appliedRecommendation, setAppliedRecommendation] = useState<{ rpm: number; concurrency: number } | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const customSharedRef = useRef<LlmSettingsView["capacity"]["shared"] | null>(null);

  useEffect(() => {
    void loadSettings();
    void loadCapacityStatus();
  }, []);

  useEffect(() => {
    if (!probeJob || probeJob.status !== "running") return;
    const timer = window.setInterval(() => {
      void loadProbeJob(probeJob.id);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [probeJob?.id, probeJob?.status]);

  useEffect(() => {
    if (message?.tone !== "success") return;
    const timer = window.setTimeout(() => setMessage(null), 2400);
    return () => window.clearTimeout(timer);
  }, [message]);

  async function loadSettings() {
    setLoading(true);
    const response = await request<LlmSettingsView>("/api/settings/llm");
    setLoading(false);
    if (!response.success) {
      setMessage({ tone: "error", text: response.error.message });
      return;
    }
    setSettings(response.data);
    setSavedSettings(response.data);
    resetApiKeyInput();
  }

  async function loadCapacityStatus() {
    const response = await request<LlmCapacityStatus>("/api/settings/llm/capacity/status");
    if (response.success) {
      setCapacityStatus(response.data);
    }
  }

  async function saveSettings() {
    if (!settings) return;
    setSaving(true);
    setMessage(null);
    let savedRuntimeMode = settings.runtimeMode;
    if (hasModelChanges) {
      const response = await request<LlmSettingsView>("/api/settings/llm", {
        method: "PUT",
        body: JSON.stringify({
          provider: settings.provider,
          runtimeMode: settings.runtimeMode,
          apiKey: apiKeyDirty ? apiKeyInput.trim() || undefined : undefined,
          clearApiKey: apiKeyDirty && !apiKeyInput.trim(),
          baseUrl: settings.baseUrl,
          models: settings.models,
          capacity: settings.capacity
        })
      });
      if (!response.success) {
        setSaving(false);
        setMessage({ tone: "error", text: response.error.message });
        return;
      }
      savedRuntimeMode = response.data.runtimeMode;
      setSettings(response.data);
      setSavedSettings(response.data);
      resetApiKeyInput();
      void loadCapacityStatus();
    }
    if (languageDraft !== savedLanguage) {
      await setAppLanguage(languageDraft);
      setSavedLanguage(languageDraft);
    }
    setSaving(false);
    const modeText = savedRuntimeMode === "mock" ? i18n.t("settings.model.savedMock") : i18n.t("settings.model.savedReal");
    setMessage({ tone: "success", text: hasModelChanges ? i18n.t("settings.model.savedToast", { mode: modeText }) : i18n.t("settings.saved") });
  }

  function resetToDefaults() {
    if (!settings) return;
    setSettings({ ...settings, runtimeMode: "mock", baseUrl: "", models: { fast: "", pro: "" } });
    setApiKeyInput("");
    setApiKeyDirty(true);
    setMessage(null);
  }

  async function loadModels() {
    if (!settings) return;
    setLoadingModels(true);
    setMessage(null);
    const response = await request<{ models: ModelListItem[] }>("/api/settings/llm/models", {
      method: "POST",
      body: JSON.stringify({
        apiKey: apiKeyDirty ? apiKeyInput.trim() || undefined : undefined,
        baseUrl: settings.baseUrl
      })
    });
    setLoadingModels(false);
    if (!response.success) {
      setMessage({ tone: "error", text: response.error.message });
      return;
    }
    setModels(response.data.models);
  }

  async function runProbe() {
    if (!settings) return;
    setProbing(true);
    setMessage(null);
    setProbeJob(null);
    setProbeResult(null);
    setAppliedRecommendation(null);
    const response = await request<LlmCapacityProbeJobStartView>("/api/settings/llm/capacity/probe", {
      method: "POST",
      body: JSON.stringify({ mode: "normal" })
    });
    if (!response.success) {
      setProbing(false);
      setMessage({ tone: "error", text: response.error.message });
      return;
    }
    void loadProbeJob(response.data.jobId);
  }

  async function loadProbeJob(jobId: string) {
    const response = await request<LlmCapacityProbeJobView>(`/api/settings/llm/capacity/probe/${jobId}`);
    if (!response.success) {
      setProbing(false);
      setMessage({ tone: "error", text: response.error.message });
      return;
    }
    const job = response.data;
    setProbeJob(job);
    if (job.status === "running") return;
    setProbing(false);
    if (job.status === "completed" && job.result) {
      setProbeResult(job.result);
      setAppliedRecommendation(null);
      setMessage({ tone: "success", text: t("settings.capacity.probeCompleted", { rpm: job.result.recommendedRpm, concurrency: job.result.recommendedConcurrency }) });
    } else if (job.status === "cancelled") {
      setMessage({ tone: "success", text: t("settings.capacity.probeCancelled") });
    } else {
      setMessage({ tone: "error", text: job.error || t("settings.capacity.probeFailed") });
    }
  }

  async function cancelProbe() {
    if (!probeJob || probeJob.status !== "running") return;
    const response = await request<LlmCapacityProbeJobView>(`/api/settings/llm/capacity/probe/${probeJob.id}/cancel`, { method: "POST" });
    setProbing(false);
    if (!response.success) {
      setMessage({ tone: "error", text: response.error.message });
      return;
    }
    setProbeJob(response.data);
    setMessage({ tone: "success", text: t("settings.capacity.probeCancelled") });
  }

  async function resetLearning() {
    const response = await request<LlmCapacityStatus>("/api/settings/llm/capacity/reset-learning", { method: "POST" });
    if (response.success) {
      setCapacityStatus(response.data);
      setMessage({ tone: "success", text: t("settings.capacity.resetDone") });
    } else {
      setMessage({ tone: "error", text: response.error.message });
    }
  }

  async function applyRecommended() {
    if (!probeResult) return;
    const response = await request<LlmSettingsView>("/api/settings/llm/capacity/apply-recommended", {
      method: "POST",
      body: JSON.stringify({
        recommendedRpm: probeResult.recommendedRpm,
        recommendedConcurrency: probeResult.recommendedConcurrency,
        testedMaxRpm: probeResult.testedMaxRpm,
        testedMaxConcurrency: probeResult.testedMaxConcurrency
      })
    });
    if (response.success) {
      setSettings(response.data);
      setSavedSettings(response.data);
      setAppliedRecommendation({ rpm: probeResult.recommendedRpm, concurrency: probeResult.recommendedConcurrency });
      void loadCapacityStatus();
      setMessage({ tone: "success", text: t("settings.capacity.appliedToast", { rpm: probeResult.recommendedRpm, concurrency: probeResult.recommendedConcurrency, testedRpm: probeResult.testedMaxRpm, testedConcurrency: probeResult.testedMaxConcurrency }) });
    } else {
      setMessage({ tone: "error", text: response.error.message });
    }
  }

  function updateSettings(patch: Partial<LlmSettingsView>) {
    setSettings((current) => (current ? { ...current, ...patch } : current));
  }

  function updateSettingsModel(key: keyof LlmSettingsView["models"], value: string) {
    setSettings((current) => (current ? { ...current, models: { ...current.models, [key]: value } } : current));
  }

  function updateCapacity(patch: Partial<LlmSettingsView["capacity"]>) {
    setSettings((current) => (current ? { ...current, capacity: { ...current.capacity, ...patch } } : current));
  }

  function updateCapacityShared(patch: Partial<LlmSettingsView["capacity"]["shared"]>) {
    setSettings((current) => (current ? { ...current, capacity: { ...current.capacity, preset: "custom", shared: { ...current.capacity.shared, ...patch } } } : current));
  }

  function updateCapacityRetry(patch: Partial<LlmSettingsView["capacity"]["retry"]>) {
    setSettings((current) => (current ? { ...current, capacity: { ...current.capacity, retry: { ...current.capacity.retry, ...patch } } } : current));
  }

  function applyCapacityPresetDraft(preset: LlmCapacityPreset) {
    setSettings((current) => {
      if (!current) return current;
      if (preset === "custom") {
        const snapshot = customSharedRef.current;
        if (snapshot) {
          return { ...current, capacity: { ...current.capacity, preset, shared: { ...snapshot } } };
        }
        return { ...current, capacity: { ...current.capacity, preset } };
      }
      if (current.capacity.preset === "custom") {
        customSharedRef.current = { ...current.capacity.shared };
      }
      const presetValues = LLM_CAPACITY_PRESET_VALUES[preset];
      const maxRpm = Math.min(presetValues.maxRpm, current.capacity.shared.hardMaxRpm);
      const minRpm = Math.min(presetValues.minRpm, maxRpm);
      const initialRpm = clampNumber(presetValues.initialRpm, minRpm, maxRpm);
      const maxConcurrency = Math.min(presetValues.maxConcurrency, current.capacity.shared.hardMaxConcurrency);
      const minConcurrency = Math.min(presetValues.minConcurrency, maxConcurrency);
      const initialConcurrency = clampNumber(presetValues.initialConcurrency, minConcurrency, maxConcurrency);
      return {
        ...current,
        capacity: {
          ...current.capacity,
          preset,
          shared: {
            ...current.capacity.shared,
            initialRpm,
            minRpm,
            maxRpm,
            initialConcurrency,
            minConcurrency,
            maxConcurrency
          }
        }
      };
    });
  }

  const hasModelChanges = Boolean(settings && savedSettings && (
    settings.runtimeMode !== savedSettings.runtimeMode ||
    settings.baseUrl !== savedSettings.baseUrl ||
    settings.models.fast !== savedSettings.models.fast ||
    settings.models.pro !== savedSettings.models.pro ||
    JSON.stringify(settings.capacity) !== JSON.stringify(savedSettings.capacity) ||
    apiKeyDirty
  ));
  const hasLanguageChanges = languageDraft !== savedLanguage;
  const hasUnsavedChanges = hasModelChanges || hasLanguageChanges;

  // 注册导航守卫：有未保存改动时离开需确认
  const guardResolveRef = useState<((ok: boolean) => void) | null>(null);
  useEffect(() => {
    if (!registerNavigationGuard) return;
    const guard: NavigationGuard = {
      isDirty: () => hasUnsavedChanges,
      confirm: () => new Promise<boolean>((resolve) => {
        guardResolveRef[1](resolve);
        setPendingConfirm({
          title: t("settings.guard.title"),
          body: t("settings.guard.body"),
          confirmLabel: t("settings.guard.confirm"),
          cancelLabel: t("settings.guard.cancel"),
          tone: "danger",
          onConfirm: () => {
            guardResolveRef[1](null);
            resolve(true);
          }
        });
      })
    };
    return registerNavigationGuard(guard);
  }, [hasUnsavedChanges, registerNavigationGuard]);

  function resetApiKeyInput() {
    setApiKeyInput("");
    setApiKeyDirty(false);
  }

  return (
    <main className="settingsShell">
      <AppHeader
        variant="narrow"
        title={t("settings.title")}
        right={settings ? (
          <>
            <button className="ghostButton iconTextButton" type="button" onClick={onHome}>
              {t("settings.backHome")}
            </button>
            <button className={hasUnsavedChanges ? "primary iconTextButton" : "primary iconTextButton isClean"} type="button" onClick={() => void saveSettings()} disabled={saving || !hasUnsavedChanges}>
              {saving ? <Loader2 className="spin" size={16} /> : hasUnsavedChanges ? <Save size={16} /> : <Check size={16} />}
              {saving ? t("settings.saving") : hasUnsavedChanges ? t("settings.saveSettings") : t("settings.saved")}
            </button>
          </>
        ) : null}
      />

      {message?.tone === "success" ? (
        <div className="settingsToast success" role="status" aria-live="polite">
          <CheckCircle2 size={17} />
          <span>{message.text}</span>
        </div>
      ) : null}

      {loading || !settings ? (
        <div className="drawerLoading"><Loader2 className="spin" size={20} />{t("settings.loadingSettings")}</div>
      ) : (
        <section className="settingsBoard">
          <div className="settingsTabs" role="tablist" aria-label={t("settings.tabs.aria")}>
            <button className={activeTab === "ai" ? "selected" : ""} role="tab" aria-selected={activeTab === "ai"} type="button" onClick={() => setActiveTab("ai")}>
              {t("settings.tabs.ai")}
            </button>
            <button className={activeTab === "system" ? "selected" : ""} role="tab" aria-selected={activeTab === "system"} type="button" onClick={() => setActiveTab("system")}>
              {t("settings.tabs.system")}
            </button>
          </div>

          {message?.tone === "error" ? (
            <p className="settingsErrorMessage" role="alert">
              <AlertTriangle size={16} />
              <span>{message.text}</span>
            </p>
          ) : null}

          {activeTab === "ai" ? (
            <div className="settingsBoardGrid" role="tabpanel">
              <div className="settingsPanel settingsRuntimePanel">
                <div className="settingsPanelHeader">
                  <div>
                    <h2>{t("settings.model.title")}</h2>
                  </div>
                  {settings.apiKeyMasked ? (
                <button
                  aria-label={t("settings.model.restoreDefault")}
                  className="settingsIconButton settingsIconButton-danger"
                  data-tooltip={t("settings.model.restoreTooltip")}
                  type="button"
                  onClick={() => setPendingConfirm({ title: t("settings.model.restoreTitle"), body: t("settings.model.restoreBody"), confirmLabel: t("settings.model.restoreConfirm"), cancelLabel: t("settings.model.restoreCancel"), tone: "danger", onConfirm: () => resetToDefaults() })}
                  disabled={saving}
                >
                  <RotateCcw size={15} />
                </button>
                  ) : null}
                </div>

                <div className="runtimeModeField">
              <span className="runtimeModeLabel">{t("settings.model.runtimeMode")}</span>
              <div className="runtimeModeCards" role="radiogroup" aria-label={t("settings.model.runtimeMode")}>
                <button
                  aria-checked={settings.runtimeMode === "mock"}
                  className={settings.runtimeMode === "mock" ? "selected" : ""}
                  role="radio"
                  type="button"
                  onClick={() => updateSettings({ runtimeMode: "mock" })}
                >
                  <span>
                    <strong>{t("settings.model.mock")}</strong>
                    <small>{t("settings.model.mockDesc")}</small>
                  </span>
                  {settings.runtimeMode === "mock" ? <Check size={16} /> : null}
                </button>
                <button
                  aria-checked={settings.runtimeMode === "real"}
                  className={settings.runtimeMode === "real" ? "selected" : ""}
                  role="radio"
                  type="button"
                  onClick={() => updateSettings({ runtimeMode: "real" })}
                >
                  <span>
                    <strong>{t("settings.model.real")}</strong>
                    <small>{t("settings.model.realDesc")}</small>
                  </span>
                  {settings.runtimeMode === "real" ? <Check size={16} /> : null}
                </button>
              </div>
                </div>

                <label>
              <span className="fieldLabelRow">
                <span>{t("settings.model.apiKey")}</span>
                {apiKeyDirty ? <span className="fieldDirtyTag">{t("settings.model.apiKeyModified")}</span> : null}
              </span>
              <input
                type="text"
                autoComplete="off"
                value={apiKeyInput}
                placeholder={settings.apiKeyMasked || "sk-..."}
                onChange={(event) => {
                  const value = event.target.value;
                  setApiKeyInput(value);
                  setApiKeyDirty(value.trim().length > 0);
                }}
              />
                </label>

                <label>
              {t("settings.model.baseUrl")}
              <input
                value={settings.baseUrl}
                placeholder={t("settings.model.baseUrlPlaceholder")}
                onChange={(event) => updateSettings({ baseUrl: event.target.value })}
              />
                </label>

                <div className="modelFetchRow">
              <button className="ghostButton iconTextButton" type="button" onClick={loadModels} disabled={loadingModels}>
                {loadingModels ? <Loader2 className="spin" size={16} /> : <RefreshCw size={16} />}
                {t("settings.model.fetchModels")}
              </button>
              {models.length ? <span className="modelFetchCount">{t("settings.model.modelsCount", { count: models.length })}</span> : <span>{t("settings.model.modelsEmpty")}</span>}
                </div>

                <ModelPicker
              label={t("settings.model.fast")}
              models={models}
              open={openModelMenu === "fast"}
              placeholder={t("settings.model.fastPlaceholder")}
              value={settings.models.fast}
              onChange={(value) => updateSettingsModel("fast", value)}
              onOpenChange={(open) => setOpenModelMenu(open ? "fast" : null)}
            />
                <ModelUsageInline items={[t("settings.model.fastUsage1"), t("settings.model.fastUsage2"), t("settings.model.fastUsage3")]} />

                <ModelPicker
              label={t("settings.model.pro")}
              labelHint={t("settings.model.proHint")}
              models={models}
              open={openModelMenu === "pro"}
              placeholder={t("settings.model.proPlaceholder")}
              value={settings.models.pro}
              onChange={(value) => updateSettingsModel("pro", value)}
              onOpenChange={(open) => setOpenModelMenu(open ? "pro" : null)}
            />
                <ModelUsageInline items={[t("settings.model.proUsage1"), t("settings.model.proUsage2"), t("settings.model.proUsage3"), t("settings.model.proUsage4")]} />

              </div>

              <CapacityPanel
            settings={settings}
            status={capacityStatus}
            probing={probing}
            probeJob={probeJob}
            probeResult={probeResult}
            appliedRecommendation={appliedRecommendation}
            showAdvanced={showAdvanced}
            onToggleAdvanced={() => setShowAdvanced(!showAdvanced)}
            onUpdateMode={(mode) => updateCapacity({ mode })}
            onUpdatePreset={applyCapacityPresetDraft}
            onUpdateShared={updateCapacityShared}
            onUpdateRetry={updateCapacityRetry}
            onProbe={() => setPendingConfirm({ title: t("settings.capacity.probeConfirmTitle"), body: t("settings.capacity.probeConfirmBody"), confirmLabel: t("settings.capacity.probeConfirmLabel"), tone: "primary", onConfirm: () => void runProbe() })}
            onCancelProbe={() => void cancelProbe()}
            onResetLearning={() => setPendingConfirm({ title: t("settings.capacity.resetConfirmTitle"), body: t("settings.capacity.resetConfirmBody"), confirmLabel: t("settings.capacity.resetConfirmLabel"), tone: "danger", onConfirm: () => void resetLearning() })}
            onApplyRecommended={applyRecommended}
                onRefreshStatus={loadCapacityStatus}
              />
            </div>
          ) : (
            <div className="settingsSystemBoard" role="tabpanel">
              <LanguagePanel current={languageDraft} onSelect={setLanguageDraft} />
            </div>
          )}
        </section>
      )}

      {pendingConfirm ? (
        <ConfirmDialog
          title={pendingConfirm.title}
          body={pendingConfirm.body}
          confirmLabel={pendingConfirm.confirmLabel}
          cancelLabel={pendingConfirm.cancelLabel}
          tone={pendingConfirm.tone}
          onConfirm={pendingConfirm.onConfirm}
          onClose={() => {
            if (guardResolveRef[0]) {
              guardResolveRef[0](false);
              guardResolveRef[1](null);
            }
            setPendingConfirm(null);
          }}
        />
      ) : null}
    </main>
  );
}

function CapacityPanel({
  settings,
  status,
  probing,
  probeJob,
  probeResult,
  appliedRecommendation,
  showAdvanced,
  onToggleAdvanced,
  onUpdateMode,
  onUpdatePreset,
  onUpdateShared,
  onUpdateRetry,
  onProbe,
  onCancelProbe,
  onResetLearning,
  onApplyRecommended,
  onRefreshStatus
}: {
  settings: LlmSettingsView;
  status: LlmCapacityStatus | null;
  probing: boolean;
  probeJob: LlmCapacityProbeJobView | null;
  probeResult: LlmCapacityProbeResult | null;
  appliedRecommendation: { rpm: number; concurrency: number } | null;
  showAdvanced: boolean;
  onToggleAdvanced: () => void;
  onUpdateMode: (mode: LlmCapacityMode) => void;
  onUpdatePreset: (preset: LlmCapacityPreset) => void;
  onUpdateShared: (patch: Partial<LlmSettingsView["capacity"]["shared"]>) => void;
  onUpdateRetry: (patch: Partial<LlmSettingsView["capacity"]["retry"]>) => void;
  onProbe: () => void;
  onCancelProbe: () => void;
  onResetLearning: () => void;
  onApplyRecommended: () => void;
  onRefreshStatus: () => void;
}) {
  const { t } = useTranslation();
  const cap = settings.capacity;
  const recommendedApplied = Boolean(
    probeResult &&
    appliedRecommendation &&
    appliedRecommendation.rpm === probeResult.recommendedRpm &&
    appliedRecommendation.concurrency === probeResult.recommendedConcurrency
  );
  return (
    <div className="settingsPanel capacityPanel">
      <div className="capacityHeader">
        <h2>{t("settings.capacity.title")}</h2>
        <button
          aria-label={t("settings.capacity.refresh")}
          className="settingsIconButton"
          data-tooltip={t("settings.capacity.refreshTooltip")}
          type="button"
          onClick={onRefreshStatus}
        >
          <RefreshCw size={14} />
        </button>
      </div>

      {status ? (
        <div className="capacityStatusBox" aria-label={t("settings.capacity.statusAria")}>
          <div className="capacityStatusTopline">
            <span>{t("settings.capacity.statusLabel")}</span>
            <strong>{t(cap.mode === "auto" ? "settings.capacity.modeAuto" : "settings.capacity.modeManual")} · {t(`settings.capacity.preset.${cap.preset}`)}</strong>
          </div>
          <div className="capacityStatusGrid">
            <div className="capacityStatusMetric">
              <span>{t("settings.capacity.effectiveRpm")}</span>
              <strong>{status.effectiveRpm}</strong>
              <small>{t("settings.capacity.configuredMaxRpm", { count: status.configuredMaxRpm })}</small>
            </div>
            <div className="capacityStatusMetric">
              <span>{t("settings.capacity.effectiveConcurrency")}</span>
              <strong>{status.effectiveConcurrency}</strong>
              <small>{t("settings.capacity.configuredMaxConcurrency", { count: status.configuredMaxConcurrency })}</small>
            </div>
            <div className="capacityStatusMetric">
              <span>{t("settings.capacity.inFlight")}</span>
              <strong>{status.inFlight}</strong>
            </div>
            <div className="capacityStatusMetric">
              <span>{t("settings.capacity.queueSize")}</span>
              <strong>{status.queueSize}</strong>
            </div>
          </div>
          {(status.cooldownUntil || status.recentLimitCount > 0) ? (
            <div className="capacityStatusNotes">
              {status.cooldownUntil ? (
                <span className="capacityCooldown">{t("settings.capacity.cooldownUntil", { time: new Date(status.cooldownUntil).toLocaleTimeString() })}</span>
              ) : null}
              {status.recentLimitCount > 0 ? (
                <span className="capacityLimit">{t("settings.capacity.recentLimit", { count: status.recentLimitCount, reason: status.lastLimitReason ? `（${status.lastLimitReason}）` : "" })}</span>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="capacityModeField">
        <span className="fieldLabel">{t("settings.capacity.mode")}</span>
        <div className="capacityModeCards" role="radiogroup" aria-label={t("settings.capacity.mode")}>
          {(["auto", "manual"] as const).map((mode) => (
            <button
              key={mode}
              aria-checked={cap.mode === mode}
              className={cap.mode === mode ? "selected" : ""}
              role="radio"
              type="button"
              onClick={() => onUpdateMode(mode)}
            >
              <span>
                <strong>{t(mode === "auto" ? "settings.capacity.modeAuto" : "settings.capacity.modeManual")}</strong>
                <small>{t(mode === "auto" ? "settings.capacity.modeAutoDesc" : "settings.capacity.modeManualDesc")}</small>
              </span>
              {cap.mode === mode ? <Check size={14} /> : null}
            </button>
          ))}
        </div>
      </div>

      <div className="capacityActions">
        <button className="primary iconTextButton capacityProbeButton" type="button" onClick={onProbe} disabled={probing}>
          {probing ? <Loader2 className="spin" size={14} /> : <Zap size={14} />}
          {probing ? t("settings.capacity.probing") : t("settings.capacity.probe")}
        </button>
        <button className="capacityResetButton iconTextButton" type="button" onClick={onResetLearning}>
          <RotateCcw size={14} />
          {t("settings.capacity.resetLearning")}
        </button>
      </div>

      {probeJob && probeJob.status === "running" ? (
        <ProbeProgressBox job={probeJob} onCancel={onCancelProbe} />
      ) : null}

      {probeResult ? (
        <div className="probeResultBox">
          <p className="probeResultTitle">{t("settings.capacity.probeResult")}</p>
          <p className="probeResultSummary">{t("settings.capacity.probeSummary", { concurrency: probeResult.recommendedConcurrency, rpm: probeResult.testedMaxRpm, recommended: probeResult.recommendedRpm })}</p>
          <div className="probeResultGrid">
            <div><span>{t("settings.capacity.probeRecommendedRpm")}</span><strong>{probeResult.recommendedRpm}</strong></div>
            <div><span>{t("settings.capacity.probeRecommendedConcurrency")}</span><strong>{probeResult.recommendedConcurrency}</strong></div>
            <div><span>{t("settings.capacity.probeAvgLatency")}</span><strong>{probeResult.avgLatencyMs}ms</strong></div>
            <div><span>{t("settings.capacity.probeTokens")}</span><strong>{formatTokenCount(probeResult.totalTokens)}</strong></div>
            <div><span>{t("settings.capacity.probeTestedRpm")}</span><strong>{probeResult.testedMaxRpm}</strong></div>
            <div><span>{t("settings.capacity.probeTestedConcurrency")}</span><strong>{probeResult.testedMaxConcurrency}</strong></div>
          </div>
          <ProbeLevelTable levels={probeResult.levels} />
          {probeResult.warnings.length > 0 ? (
            <ul className="probeWarnings">
              {probeResult.warnings.map((w, i) => <li key={i}>{w}</li>)}
            </ul>
          ) : null}
          <button className="primary iconTextButton" type="button" onClick={onApplyRecommended} disabled={recommendedApplied}>
            <Check size={14} />
            {recommendedApplied ? t("settings.capacity.appliedRecommended") : t("settings.capacity.applyRecommended")}
          </button>
        </div>
      ) : null}

      <button className={showAdvanced ? "capacityAdvancedToggle expanded" : "capacityAdvancedToggle"} type="button" onClick={onToggleAdvanced}>
        <span>{t("settings.capacity.advanced")}</span>
        <ChevronDown size={14} className={showAdvanced ? "rotated" : ""} />
      </button>

      {showAdvanced ? (
        <div className="capacityAdvancedStack">
          <div className="capacityAdvancedSection">
            <div className="capacityAdvancedSectionHeader">
              <span>{t("settings.capacity.presetSection")}</span>
            </div>
            <div className="capacityPresetField capacityAdvancedPreset">
              <div className="capacityPresetCards" role="radiogroup" aria-label={t("settings.capacity.presetAria")}>
                {(["conservative", "standard", "high_quota", "custom"] as const).map((preset) => (
                  <button
                    key={preset}
                    aria-checked={cap.preset === preset}
                    className={cap.preset === preset ? "selected" : ""}
                    role="radio"
                    type="button"
                    onClick={() => onUpdatePreset(preset)}
                  >
                    <span><strong>{t(`settings.capacity.preset.${preset}`)}</strong></span>
                    {cap.preset === preset ? <Check size={14} /> : null}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <div className="capacityAdvancedSection">
            <div className="capacityAdvancedSectionHeader">
              <span>{t("settings.capacity.boundary")}</span>
            </div>
            <div className="capacityAdvancedGrid">
              <label>
                <span>{t("settings.capacity.initialRpm")}</span>
                <input type="number" min={1} value={cap.shared.initialRpm} onChange={(e) => onUpdateShared({ initialRpm: Number(e.target.value) })} />
              </label>
              <label>
                <span>{t("settings.capacity.minRpm")}</span>
                <input type="number" min={1} value={cap.shared.minRpm} onChange={(e) => onUpdateShared({ minRpm: Number(e.target.value) })} />
              </label>
              <label>
                <span>{t("settings.capacity.maxRpm")}</span>
                <input type="number" min={1} value={cap.shared.maxRpm} onChange={(e) => onUpdateShared({ maxRpm: Number(e.target.value) })} />
              </label>
              <label>
                <span>{t("settings.capacity.initialConcurrency")}</span>
                <input type="number" min={1} value={cap.shared.initialConcurrency} onChange={(e) => onUpdateShared({ initialConcurrency: Number(e.target.value) })} />
              </label>
              <label>
                <span>{t("settings.capacity.minConcurrency")}</span>
                <input type="number" min={1} value={cap.shared.minConcurrency} onChange={(e) => onUpdateShared({ minConcurrency: Number(e.target.value) })} />
              </label>
              <label>
                <span>{t("settings.capacity.maxConcurrency")}</span>
                <input type="number" min={1} value={cap.shared.maxConcurrency} onChange={(e) => onUpdateShared({ maxConcurrency: Number(e.target.value) })} />
              </label>
              <label>
                <span>{t("settings.capacity.maxRetries")}</span>
                <input type="number" min={0} max={10} value={cap.retry.maxRetries} onChange={(e) => onUpdateRetry({ maxRetries: Number(e.target.value) })} />
              </label>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function ProbeProgressBox({ job, onCancel }: { job: LlmCapacityProbeJobView; onCancel: () => void }) {
  const { t } = useTranslation();
  const isCooldown = job.phase === "cooldown";
  const stageDurationMs = isCooldown ? job.cooldownTotalMs : job.currentLevelDurationMs;
  const stageElapsedMs = isCooldown ? Math.max(0, job.cooldownTotalMs - job.cooldownRemainingMs) : job.currentLevelElapsedMs;
  const progress = stageDurationMs > 0
    ? Math.min(100, Math.max(3, Math.round((stageElapsedMs / stageDurationMs) * 100)))
    : 3;
  const currentLevelLabel = job.currentConcurrency > 0 ? `${t("settings.capacity.probeLevelConcurrency")} ${job.currentConcurrency}` : t("settings.capacity.probePreparing");
  const title = isCooldown ? t("settings.capacity.probeCooling") : t("settings.capacity.probeTesting");
  const stageText = isCooldown
    ? t("settings.capacity.probeCooldownLeft", { time: formatSeconds(job.cooldownRemainingMs), level: currentLevelLabel })
    : t("settings.capacity.probeLevelRemaining", { level: currentLevelLabel, time: formatSeconds(Math.max(0, job.currentLevelDurationMs - job.currentLevelElapsedMs)) });
  return (
    <div className="probeProgressBox" role="status" aria-label={t("settings.capacity.probeProgressAria")}>
      <div className="probeProgressHeader">
        <div>
          <p className="probeResultTitle">{title}</p>
          <span>{job.message}</span>
        </div>
        <button className="capacityResetButton iconTextButton" type="button" onClick={onCancel}>
          <RotateCcw size={14} />
          {t("settings.capacity.probeCancel")}
        </button>
      </div>
      <div className="probeProgressBar" aria-hidden="true">
        <span style={{ width: `${progress}%` }} />
      </div>
      <div className="probeStageLine">
        <span>{stageText}</span>
        <strong>{progress}%</strong>
      </div>
      <div className="probeProgressMeta">
        <span>{t("settings.capacity.probeCurrentSent", { count: job.currentLevelSentRequests })}</span>
        <span>{t("settings.capacity.probeCurrentSuccess", { count: job.currentLevelSuccessfulRequests })}</span>
        <span>{t("settings.capacity.probeCurrentFailed", { count: job.currentLevelFailedRequests })}</span>
        <span>{t("settings.capacity.probeCurrentTokens", { count: formatTokenCount(job.currentLevelTotalTokens) })}</span>
        <span>{t("settings.capacity.probeCurrentElapsed", { time: formatSeconds(job.currentLevelElapsedMs) })}</span>
        <span>{job.currentLevelAvgLatencyMs ? t("settings.capacity.probeCurrentLatency", { latency: `${job.currentLevelAvgLatencyMs}ms` }) : t("settings.capacity.probeCurrentLatencyNone")}</span>
        <span>{t("settings.capacity.probeTotalSent", { count: job.sentRequests })}</span>
        <span>{t("settings.capacity.probeTotalTokens", { count: formatTokenCount(job.totalTokens) })}</span>
      </div>
      <ProbeLevelTable levels={job.levels} />
    </div>
  );
}

function ProbeLevelTable({ levels }: { levels: LlmCapacityProbeLevelResult[] }) {
  const { t } = useTranslation();
  if (!levels.length) return null;
  return (
    <div className="probeLevelTable" aria-label={t("settings.capacity.probeLevelTableAria")}>
      <div className="probeLevelHeader">
        <span>{t("settings.capacity.probeLevelHeader")}</span>
        <small>{t("settings.capacity.probeLevelHint")}</small>
      </div>
      <div className="probeLevelRows">
        <div className="probeLevelRow head">
          <span>{t("settings.capacity.probeLevelConcurrency")}</span>
          <span>{t("settings.capacity.probeLevelRequests")}</span>
          <span>{t("settings.capacity.probeLevelSuccess")}</span>
          <span>{t("settings.capacity.probeLevelFailed")}</span>
          <span>{t("settings.capacity.probeLevelRpm")}</span>
          <span>{t("settings.capacity.probeLevelSuccessRate")}</span>
          <span>{t("settings.capacity.probeLevelLatency")}</span>
          <span>{t("settings.capacity.probeLevelTokens")}</span>
        </div>
        {levels.map((level) => (
          <div className={level.selected ? "probeLevelRow selected" : "probeLevelRow"} key={level.concurrency}>
            <span>{level.concurrency}{level.selected ? ` ${t("settings.capacity.probeLevelRecommended")}` : ""}</span>
            <span>{level.sentRequests}</span>
            <span>{level.successfulRequests}</span>
            <span>{level.failedRequests}</span>
            <span>{level.rpm}</span>
            <span>{level.successRate}%</span>
            <span>{level.avgLatencyMs ? `${level.avgLatencyMs}ms` : t("settings.capacity.probeLevelNone")}</span>
            <span>{formatTokenCount(level.totalTokens)}</span>
            {level.stopReason ? <em>{level.stopReason}</em> : null}
          </div>
        ))}
      </div>
    </div>
  );
}

function formatTokenCount(tokens: number): string {
  return tokens > 0 ? String(tokens) : i18n.t("settings.capacity.probeLevelNone");
}

function formatSeconds(ms: number): string {
  return `${Math.max(0, Math.ceil(ms / 1000))}s`;
}

function clampNumber(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function ModelUsageInline({ items }: { items: string[] }) {
  const { t } = useTranslation();
  return (
    <div className="modelUsageInline" aria-label={t("settings.model.usageAria")}>
      {items.map((item) => <span key={item}>{item}</span>)}
    </div>
  );
}

function ModelPicker({
  label,
  labelHint,
  models,
  open,
  placeholder,
  value,
  onChange,
  onOpenChange
}: {
  label: string;
  labelHint?: string;
  models: ModelListItem[];
  open: boolean;
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const visibleModels = models.filter((model) => !value || model.id.toLowerCase().includes(value.toLowerCase())).slice(0, 12);
  return (
    <label className="modelPickerLabel">
      <span className="modelLabelRow">
        <span>{label}</span>
        {labelHint ? <span className="modelLabelHint">{labelHint}</span> : null}
      </span>
      <div className="modelPicker">
        <input value={value} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} onFocus={() => onOpenChange(models.length > 0)} />
        <button
          aria-label={t("settings.model.listAria", { label })}
          className="modelPickerToggle"
          disabled={!models.length}
          onClick={() => onOpenChange(!open)}
          type="button"
        >
          <ChevronDown size={17} />
        </button>
        {open ? (
          <div className="modelMenu">
            {visibleModels.length ? (
              visibleModels.map((model) => (
                <button
                  className={model.id === value ? "selected" : ""}
                  key={model.id}
                  onClick={() => {
                    onChange(model.id);
                    onOpenChange(false);
                  }}
                  type="button"
                >
                  <strong>{model.id}</strong>
                  {model.ownedBy ? <span>{model.ownedBy}</span> : null}
                </button>
              ))
            ) : (
              <p>{t("settings.model.noMatch")}</p>
            )}
          </div>
        ) : null}
      </div>
    </label>
  );
}

function LanguagePanel({ current, onSelect }: { current: AppLanguage; onSelect: (language: AppLanguage) => void }) {
  const { t } = useTranslation();
  return (
    <div className="settingsPanel languagePanel">
      <div className="settingsPanelHeader">
        <div>
          <h2>{t("language.title")}</h2>
          <p className="settingsPanelHint">{t("language.description")}</p>
        </div>
      </div>
      <div className="runtimeModeField">
        <div className="runtimeModeCards" role="radiogroup" aria-label={t("language.title")}>
          {APP_LANGUAGES.map((language) => (
            <button
              aria-checked={current === language}
              className={current === language ? "selected" : ""}
              key={language}
              role="radio"
              type="button"
              onClick={() => onSelect(language)}
            >
              <span>
                <strong>{language === "zh-CN" ? t("language.zh") : t("language.en")}</strong>
                <small>{language}</small>
              </span>
              {current === language ? <Check size={16} /> : null}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

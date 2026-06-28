import { useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { RefreshCw, Save, Trash2, X } from "lucide-react";
import { parseApiResponse } from "../lib/api.js";
import { AudienceAvatar } from "./VenueWidgets.js";
import type { AudienceEditState } from "../types.js";

const MBTI_OPTIONS = [
  "ISTJ", "ISFJ", "INFJ", "INTJ",
  "ISTP", "ISFP", "INFP", "INTP",
  "ESTP", "ESFP", "ENFP", "ENTP",
  "ESTJ", "ESFJ", "ENFJ", "ENTJ"
] as const;

const demographicsFields = [
  "gender",
  "ageRange",
  "cityTier",
  "lifeStage",
  "role",
  "spendingPower"
] as const;

export function AudienceEditDrawer({
  edit,
  onChange,
  onClose,
  onSave,
  onGenerate,
  onDelete
}: {
  edit: AudienceEditState;
  onChange: (value: AudienceEditState | null) => void;
  onClose: () => void;
  onSave: () => void;
  onGenerate: () => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  const [isEditingAvatar, setIsEditingAvatar] = useState(false);
  const [isUploadingAvatar, setIsUploadingAvatar] = useState(false);
  const [avatarUploadError, setAvatarUploadError] = useState("");
  const avatarInputRef = useRef<HTMLInputElement | null>(null);
  const patch = (value: Partial<AudienceEditState>) => onChange({ ...edit, ...value });
  const hasPersona = edit.identityStatus === "identity_ready";

  const uploadAvatar = async (file: File) => {
    setAvatarUploadError("");
    setIsUploadingAvatar(true);
    try {
      const form = new FormData();
      form.set("file", file);
      const response = await fetch("/api/upload", { method: "POST", body: form });
      const body = await parseApiResponse<{ url: string }>(response);
      if (!body.success) throw new Error(body.error.message);
      patch({ avatarUrl: body.data.url });
      setIsEditingAvatar(false);
    } catch (error) {
      setAvatarUploadError(error instanceof Error ? error.message : t("audienceDrawer.avatar.failed"));
    } finally {
      setIsUploadingAvatar(false);
      if (avatarInputRef.current) avatarInputRef.current.value = "";
    }
  };

  return (
    <div className="drawerOverlay" onClick={onClose}>
      <div className="audienceDrawer identityEditDrawer" onClick={(event) => event.stopPropagation()}>
        <header>
          <div>
            <h2>{hasPersona ? t("audienceDrawer.editTitle", { name: edit.displayName || edit.samplingLabel }) : t("audienceDrawer.viewTitle", { label: edit.samplingLabel })}</h2>
            <p>{hasPersona ? t("audienceDrawer.editSubtitle") : t("audienceDrawer.viewSubtitle")}</p>
          </div>
          <button onClick={onClose} aria-label={t("venue.closeEdit")}><X size={20} /></button>
        </header>
        <div className="drawerBody editAudienceForm editDrawerBody">
          <section className="identityEditIntro" aria-label={t("audienceDrawer.identityPreview")}>
            <div className="identityAvatarControl">
              {hasPersona ? (
                <button
                  className="identityAvatarEditButton"
                  type="button"
                  onClick={() => setIsEditingAvatar((value) => !value)}
                  aria-label={t("audienceDrawer.modifyAvatar")}
                  title={t("audienceDrawer.modifyAvatar")}
                >
                  <AudienceAvatar name={edit.displayName} seed={edit.id} src={edit.avatarUrl || undefined} />
                </button>
              ) : (
                <span className="identityAvatarEditButton identityAvatarReadonly">
                  <AudienceAvatar name={edit.samplingLabel} seed={edit.id} />
                </span>
              )}
              {hasPersona && isEditingAvatar ? (
                <div className="identityAvatarMenu">
                  <input
                    ref={avatarInputRef}
                    className="identityAvatarFileInput"
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    aria-label={t("audienceDrawer.avatar.uploadAria")}
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (file) void uploadAvatar(file);
                    }}
                  />
                  <button type="button" onClick={() => avatarInputRef.current?.click()} disabled={isUploadingAvatar}>
                    {isUploadingAvatar ? t("audienceDrawer.avatar.uploading") : t("audienceDrawer.avatar.upload")}
                  </button>
                  <button type="button" onClick={() => {
                    patch({ avatarUrl: "" });
                    setAvatarUploadError("");
                    setIsEditingAvatar(false);
                  }}>{t("audienceDrawer.avatar.useDefault")}</button>
                  {avatarUploadError ? <p className="identityAvatarError">{avatarUploadError}</p> : null}
                </div>
              ) : null}
            </div>
            <div className="identityIntroText">
              {hasPersona ? (
                <input
                  className="identityNameInput"
                  aria-label={t("audienceDrawer.nameAria")}
                  value={edit.displayName}
                  onChange={(event) => patch({ displayName: event.target.value })}
                  placeholder={t("audienceDrawer.namePlaceholder")}
                />
              ) : (
                <strong className="identityReadonlyTitle">{edit.samplingLabel}</strong>
              )}
              <span>{hasPersona ? edit.samplingLabel : t("audienceDrawer.profilePending")}</span>
            </div>
          </section>
          {hasPersona ? (
            <>
              <section className="editFormSection identityFormSection">
                <div className="sectionTitleRow">
                  <h3>{t("audienceDrawer.personaSection")}</h3>
                  <span>{t("audienceDrawer.personaHint")}</span>
                </div>
                <label>
                  <span className="fieldLabelText">{t("audienceDrawer.profileText")}</span>
                  <span className="fieldHint">{t("audienceDrawer.profileHint")}</span>
                  <PersonaTextarea value={edit.profileText} onChange={(value) => patch({ profileText: value })} />
                </label>
                <label>
                  <span className="fieldLabelText">{t("audienceDrawer.personality")}</span>
                  <span className="fieldHint">{t("audienceDrawer.personalityHint")}</span>
                  <PersonaTextarea value={edit.personalityText} onChange={(value) => patch({ personalityText: value })} />
                </label>
                <label>
                  <span className="fieldLabelText">{t("audienceDrawer.mbtiType")}</span>
                  <span className="fieldHint">{t("audienceDrawer.mbtiHint")}</span>
                  <select className="personaSelect" value={edit.mbtiTypeText} onChange={(event) => patch({ mbtiTypeText: event.target.value })}>
                    {MBTI_OPTIONS.map((type) => (
                      <option key={type} value={type}>{type} {t(`audienceDrawer.mbti.${type}`)}</option>
                    ))}
                  </select>
                </label>
                <label>
                  <span className="fieldLabelText">{t("audienceDrawer.responseStyle")}</span>
                  <span className="fieldHint">{t("audienceDrawer.responseStyleHint")}</span>
                  <PersonaTextarea value={edit.responseStyleText} onChange={(value) => patch({ responseStyleText: value })} />
                </label>
              </section>
            </>
          ) : (
            <section className="profileOnlyPanel profileOnlyPanel-quiet">
              <div className="sectionTitleRow">
                <h3>{t("audienceDrawer.profileOnly")}</h3>
                <span>{t("audienceDrawer.profileOnlyHint")}</span>
              </div>
              <p>{t("audienceDrawer.profileOnlyBody")}</p>
            </section>
          )}

          <section className="identitySourcePanel">
            <div className="sectionTitleRow">
              <h3>{t("audienceDrawer.samplingSection")}</h3>
              <span>{t("audienceDrawer.samplingHint")}</span>
            </div>
            <div className="sourceReadonlyGrid">
              <div className="sourceReadonly sourceReadonly-wide">
                <span>{t("audienceDrawer.samplingLabel")}</span>
                <p>{edit.samplingLabel || t("audienceDrawer.samplingLabelEmpty")}</p>
              </div>
              {demographicsFields.map((key) => (
                <div className="sourceReadonly" key={key}>
                  <span>{t(`audienceDrawer.demographics.${key}`)}</span>
                  <p>{edit.demographicsJson[key]}</p>
                </div>
              ))}
            </div>
          </section>
        </div>
        <footer className="drawerFooter">
          <button className="dangerButton dangerButton-outlined iconTextButton" type="button" onClick={onDelete}>
            <Trash2 size={16} />
            {hasPersona ? t("audienceDrawer.deletePersona") : t("audienceDrawer.deleteProfile")}
          </button>
          {hasPersona ? (
            <button className="primary" type="button" onClick={onSave}>
              <Save size={16} />
              {t("audienceDrawer.savePersona")}
            </button>
          ) : (
            <button className="primary iconTextButton" type="button" onClick={onGenerate}>
              <RefreshCw size={16} />
              {t("audienceDrawer.generatePersona")}
            </button>
          )}
        </footer>
      </div>
    </div>
  );
}

function PersonaTextarea({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const resize = () => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    const maxHeight = Number.parseFloat(window.getComputedStyle(textarea).maxHeight);
    const hasMaxHeight = Number.isFinite(maxHeight);
    const nextHeight = hasMaxHeight ? Math.min(textarea.scrollHeight, maxHeight) : textarea.scrollHeight;
    textarea.style.height = `${nextHeight}px`;
    textarea.style.overflowY = hasMaxHeight && textarea.scrollHeight > maxHeight ? "auto" : "hidden";
  };

  useLayoutEffect(() => {
    resize();
  }, [value]);

  return (
    <textarea
      ref={textareaRef}
      className="personaTextarea"
      rows={1}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      onInput={resize}
    />
  );
}

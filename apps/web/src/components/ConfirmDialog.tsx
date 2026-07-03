import { useEffect } from "react";
import { AlertTriangle, X } from "lucide-react";
import { useTranslation } from "react-i18next";

export type ConfirmDialogProps = {
  title: string;
  body: string;
  confirmLabel: string;
  cancelLabel?: string;
  tone?: "danger" | "primary";
  onConfirm: () => void;
  onClose: () => void;
};

export function ConfirmDialog({ title, body, confirmLabel, cancelLabel, tone = "primary", onConfirm, onClose }: ConfirmDialogProps) {
  const { t } = useTranslation();
  const resolvedCancelLabel = cancelLabel ?? t("common.cancel");
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);
  return (
    <div className="dialogOverlay" role="presentation">
      <section className={`confirmDialog confirmDialog-${tone}`} role="dialog" aria-modal="true" aria-labelledby="confirm-dialog-title">
        <button className="drawerClose" type="button" aria-label={t("common.close")} onClick={onClose}>
          <X size={18} />
        </button>
        <span className="confirmDialogIcon"><AlertTriangle size={22} /></span>
        <h2 id="confirm-dialog-title">{title}</h2>
        <p>{body}</p>
        <div className="confirmDialogActions">
          <button className="ghostButton" type="button" onClick={onClose}>
            {resolvedCancelLabel}
          </button>
          <button
            className={tone === "danger" ? "dangerButton dangerButton-outlined" : "primary"}
            type="button"
            onClick={() => {
              onConfirm();
              onClose();
            }}
          >
            {confirmLabel}
          </button>
        </div>
      </section>
    </div>
  );
}

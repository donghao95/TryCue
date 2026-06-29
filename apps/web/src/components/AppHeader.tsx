import type { ReactNode } from "react";
import { Home } from "lucide-react";
import { useTranslation } from "react-i18next";

export type AppHeaderVariant = "narrow" | "wide";

export type AppHeaderProps = {
  variant?: AppHeaderVariant;
  showHomeButton?: boolean;
  onHome?: () => void;
  title?: string;
  leftExtra?: ReactNode;
  right?: ReactNode;
};

const VARIANT_CLASS: Record<AppHeaderVariant, string> = {
  narrow: "appHeader appHeader-narrow",
  wide: "appHeader appHeader-wide"
};

export function AppHeader({
  variant = "narrow",
  showHomeButton = false,
  onHome,
  title,
  leftExtra,
  right
}: AppHeaderProps) {
  const { t } = useTranslation();
  return (
    <header className={VARIANT_CLASS[variant]}>
      <div className="appHeaderLeft">
        {showHomeButton ? (
          <button className="ghostButton iconTextButton appHeaderHomeButton" type="button" onClick={onHome}>
            <Home size={16} />
            {t("common.backHome")}
          </button>
        ) : null}
        {title ? (
          <div className="appHeaderBrand">
            <h1>{title}</h1>
          </div>
        ) : null}
        {leftExtra}
      </div>
      {right ? <div className="appHeaderRight">{right}</div> : null}
    </header>
  );
}

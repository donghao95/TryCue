import type { ReactNode } from "react";
import { Home } from "lucide-react";
import { useTranslation } from "react-i18next";

export type AppHeaderVariant = "narrow" | "wide" | "venue-minimal";

export type AppHeaderProps = {
  variant?: AppHeaderVariant;
  showHomeButton?: boolean;
  onHome?: () => void;
  kicker?: string;
  title?: string;
  leftExtra?: ReactNode;
  right?: ReactNode;
};

const VARIANT_CLASS: Record<AppHeaderVariant, string> = {
  narrow: "appHeader appHeader-narrow",
  wide: "appHeader appHeader-wide",
  "venue-minimal": "appHeader appHeader-venueMinimal"
};

export function AppHeader({
  variant = "narrow",
  showHomeButton = false,
  onHome,
  kicker,
  title,
  leftExtra,
  right
}: AppHeaderProps) {
  const { t } = useTranslation();
  const isVenueMinimal = variant === "venue-minimal";
  return (
    <header className={VARIANT_CLASS[variant]}>
      {isVenueMinimal ? (
        <button className="ghostButton iconTextButton appHeaderHomeButton" type="button" onClick={onHome}>
          <Home size={16} />
          {t("common.backHome")}
        </button>
      ) : (
        <>
          <div className="appHeaderLeft">
            {showHomeButton ? (
              <button className="ghostButton iconTextButton appHeaderHomeButton" type="button" onClick={onHome}>
                <Home size={16} />
                {t("common.backHome")}
              </button>
            ) : null}
            {(kicker || title) ? (
              <div className="appHeaderBrand">
                {kicker ? <p className="kicker">{kicker}</p> : null}
                {title ? <h1>{title}</h1> : null}
              </div>
            ) : null}
            {leftExtra}
          </div>
          {right ? <div className="appHeaderRight">{right}</div> : null}
        </>
      )}
    </header>
  );
}

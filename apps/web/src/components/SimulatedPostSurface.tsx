import { useEffect, useRef, useState } from "react";
import type { ReactNode, UIEvent } from "react";
import { ChevronLeft, ChevronRight, Share2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { AudienceAvatar } from "./VenueWidgets.js";

export type SimulatedPostSurfaceProps = {
  actionBar?: ReactNode;
  activeImageUrl: string;
  afterContent?: ReactNode;
  bodyText: string;
  footer?: ReactNode;
  imageUrls: string[];
  onContentScroll?: (event: UIEvent<HTMLDivElement>) => void;
  onOpenImage: (index: number) => void;
  onSelectImage: (index: number) => void;
  onShiftImage: (direction: -1 | 1) => void;
  onShare: () => void;
  selectedImageIndex: number;
  title: string;
};

export type PostMediaFrameProps = {
  activeImageUrl: string;
  imageUrls: string[];
  onOpenImage: (index: number) => void;
  onSelectImage: (index: number) => void;
  onShiftImage: (direction: -1 | 1) => void;
  selectedImageIndex: number;
  showBadge?: boolean;
  showExpand?: boolean;
  showThumbnails?: boolean;
};

export function PostMediaFrame({
  activeImageUrl,
  imageUrls,
  onOpenImage,
  onSelectImage,
  onShiftImage,
  selectedImageIndex,
  showBadge = true,
  showExpand = true,
  showThumbnails = true
}: PostMediaFrameProps) {
  const { t } = useTranslation();
  const safeImageIndex = imageUrls.length ? Math.min(selectedImageIndex, imageUrls.length - 1) : 0;
  const showImageCount = imageUrls.length > 1 || showThumbnails;
  const pointerStartXRef = useRef<number | null>(null);
  const suppressClickRef = useRef(false);
  const handlePointerUp = (clientX: number) => {
    const startX = pointerStartXRef.current;
    pointerStartXRef.current = null;
    if (startX === null || imageUrls.length < 2) return;
    const deltaX = clientX - startX;
    if (Math.abs(deltaX) < 44) return;
    suppressClickRef.current = true;
    onShiftImage(deltaX > 0 ? -1 : 1);
    window.setTimeout(() => {
      suppressClickRef.current = false;
    }, 0);
  };

  return (
    <div
      className="mockMedia"
      onPointerDown={(event) => {
        pointerStartXRef.current = event.clientX;
      }}
      onPointerCancel={() => {
        pointerStartXRef.current = null;
      }}
      onPointerUp={(event) => handlePointerUp(event.clientX)}
    >
      {showBadge ? <span className="redBookBadge">{t("venue.post.redBook")}</span> : null}
      {showImageCount ? <span className="imageCount">{imageUrls.length ? safeImageIndex + 1 : 0} / {Math.max(imageUrls.length, 1)}</span> : null}
      {activeImageUrl ? (
        <button
          className="mockImageButton"
          type="button"
          onClick={(event) => {
            if (suppressClickRef.current) {
              event.preventDefault();
              return;
            }
            onOpenImage(safeImageIndex);
          }}
        >
          <img src={activeImageUrl} alt={t("venue.post.contentImageAlt")} />
        </button>
      ) : <div className="imagePlaceholder" />}
      {imageUrls.length > 1 ? (
        <>
          <button className="mediaNav previous" type="button" aria-label={t("venue.post.prevImage")} onClick={() => onShiftImage(-1)}>
            <ChevronLeft size={24} />
          </button>
          <button className="mediaNav next" type="button" aria-label={t("venue.post.nextImage")} onClick={() => onShiftImage(1)}>
            <ChevronRight size={24} />
          </button>
        </>
      ) : null}
      {activeImageUrl && showExpand ? <span className="tapToZoomHint">{t("venue.post.tapToZoom")}</span> : null}
      {imageUrls.length && showThumbnails ? (
        <div className="thumbStrip">
          {imageUrls.slice(0, 5).map((url, index) => (
            <button className={index === safeImageIndex ? "active" : ""} key={url} type="button" onClick={() => onSelectImage(index)}>
              <img src={url} alt="" />
            </button>
          ))}
          {imageUrls.length > 5 ? <span className="moreThumb">+{imageUrls.length - 5}</span> : null}
        </div>
      ) : null}
    </div>
  );
}

export function PlanningContentPreview({
  activeImageUrl,
  bodyText,
  imageUrls,
  onOpenImage,
  onSelectImage,
  onShiftImage,
  selectedImageIndex,
  title
}: Omit<SimulatedPostSurfaceProps, "afterContent" | "footer" | "onContentScroll" | "onShare">) {
  const { t } = useTranslation();
  return (
    <section className="mockPostPanel simulatedPostSurface planningContentPreview" aria-label={t("venue.post.contentPreview")}>
      <article className="mockContent">
        <MobileDeviceStatusBar />
        <div className="mockContentBody planningContentBody">
          <PostMediaFrame
            activeImageUrl={activeImageUrl}
            imageUrls={imageUrls}
            onOpenImage={onOpenImage}
            onSelectImage={onSelectImage}
            onShiftImage={onShiftImage}
            selectedImageIndex={selectedImageIndex}
            showBadge={false}
            showExpand={false}
            showThumbnails={false}
          />
          <h2>{title}</h2>
          <p className="postBody">{bodyText}</p>
        </div>
      </article>
    </section>
  );
}

export function MobileDeviceStatusBar() {
  const [deviceTime, setDeviceTime] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setDeviceTime(new Date()), 30_000);
    return () => window.clearInterval(timer);
  }, []);
  return (
    <div className="mobileStatusBar" aria-hidden="true">
      <strong>{formatDeviceTime(deviceTime)}</strong>
      <div className="mobileStatusIndicators">
        <span className="signalBars" aria-hidden="true"><i /><i /><i /><i /></span>
        <span className="networkType">5G</span>
        <svg className="wifiGlyph" width="17" height="12" viewBox="0 0 17 12" fill="none" aria-hidden="true">
          <path d="M8.5 11.2a1 1 0 100-2 1 1 0 000 2z" fill="currentColor" />
          <path d="M5.2 7.4a4.7 4.7 0 016.6 0" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          <path d="M2.8 5a8.2 8.2 0 0111.4 0" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          <path d="M0.5 2.6a11.8 11.8 0 0116 0" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        </svg>
        <span className="batteryWrap" aria-hidden="true">
          <span className="batteryPct">100</span>
          <svg className="batteryGlyph" width="26" height="13" viewBox="0 0 26 13" fill="none">
            <rect x="0.5" y="0.5" width="21" height="12" rx="3.2" ry="3.2" stroke="currentColor" strokeOpacity="0.42" fill="none" />
            <rect x="23" y="4" width="2" height="5" rx="1" ry="1" fill="currentColor" fillOpacity="0.42" />
            <rect x="2" y="2" width="18" height="9" rx="1.8" ry="1.8" fill="currentColor" />
          </svg>
        </span>
      </div>
    </div>
  );
}

export function SimulatedPostSurface({
  actionBar,
  activeImageUrl,
  afterContent,
  bodyText,
  footer,
  imageUrls,
  onContentScroll,
  onOpenImage,
  onSelectImage,
  onShiftImage,
  onShare,
  selectedImageIndex,
  title
}: SimulatedPostSurfaceProps) {
  const { t } = useTranslation();
  const [bodyExpanded, setBodyExpanded] = useState(false);
  const postDate = formatMobilePostDate(new Date());
  return (
    <section className="mockPostPanel simulatedPostSurface" aria-label={t("venue.post.simulatedPage")}>
      <article className="mockContent">
        <MobileDeviceStatusBar />
        <header className="postAuthor mobilePostTopBar">
          <button className="mobileIconButton" type="button" aria-label={t("common.back")}>
            <ChevronLeft size={27} />
          </button>
          <AudienceAvatar name={t("venue.post.author")} seed="author" />
          <div>
            <strong>{t("venue.post.author")}</strong>
          </div>
          <button className="followButton">{t("venue.post.follow")}</button>
          <button className="mobileIconButton mobileShareButton" aria-label={t("venue.action.share")} type="button" onClick={onShare}>
            <Share2 size={25} />
          </button>
        </header>

        <div className="mockContentBody" data-collapsed={bodyExpanded ? undefined : ""} onScroll={onContentScroll}>
          {bodyExpanded ? (
            <PostMediaFrame
              activeImageUrl={activeImageUrl}
              imageUrls={imageUrls}
              onOpenImage={onOpenImage}
              onSelectImage={onSelectImage}
              onShiftImage={onShiftImage}
              selectedImageIndex={selectedImageIndex}
              showBadge={false}
              showExpand={false}
              showThumbnails={false}
            />
          ) : null}
          <h2>{title}</h2>
          {bodyExpanded && bodyText.trim() ? <p id="simulatedPostBody" className="postBody">{bodyText}</p> : null}
          <button
            className="bodyCollapseToggle"
            type="button"
            onClick={() => setBodyExpanded((value) => !value)}
            aria-expanded={bodyExpanded}
            aria-controls="simulatedPostBody"
          >
            {bodyExpanded ? t("venue.post.collapseBody") : t("venue.post.expandBody")}
          </button>
          <p className="postTime">{postDate}</p>
          {afterContent}
        </div>
        <div className="mobileBottomBar">
          {footer}
          {actionBar}
        </div>
      </article>
    </section>
  );
}

export function formatMobilePostDate(date: Date) {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${month}-${day}`;
}

export function formatDeviceTime(date: Date) {
  const hours = date.getHours();
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${hours}:${minutes}`;
}

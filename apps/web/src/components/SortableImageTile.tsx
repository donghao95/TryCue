import type { CSSProperties } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";

export function SortableImageTile({
  index,
  url,
  onOpen,
  onRemove
}: {
  index: number;
  url: string;
  onOpen: () => void;
  onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: url });
  const { t } = useTranslation();
  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 2 : undefined
  };
  return (
    <div
      className={`uploadPreviewTile ${isDragging ? "dragging" : ""}`}
      ref={setNodeRef}
      style={style}
      onClick={onOpen}
      {...attributes}
      {...listeners}
    >
      <img src={url} alt={index === 0 ? t("imageViewer.coverPreview") : t("imageViewer.imageN", { index: index + 1 })} draggable={false} />
      <span>{index === 0 ? t("imageViewer.cover") : index + 1}</span>
      <button
        className="removeImageButton"
        type="button"
        aria-label={t("imageViewer.deleteImage", { index: index + 1 })}
        onClick={(event) => {
          event.stopPropagation();
          onRemove();
        }}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <Trash2 size={14} />
      </button>
    </div>
  );
}

import type { AudienceActionHappenedPayload } from "@trycue/shared";
import i18n from "../i18n.js";

export function actionText(action: AudienceActionHappenedPayload["action"]) {
  if (action === "open_post") return i18n.t("runtimeEvent.open_post");
  if (action === "read_post") return i18n.t("runtimeEvent.read_post");
  if (action === "like_post") return i18n.t("runtimeEvent.like_post");
  if (action === "favorite_post") return i18n.t("runtimeEvent.favorite_post");
  if (action === "share_post") return i18n.t("runtimeEvent.share_post");
  if (action === "write_comment") return i18n.t("runtimeEvent.write_comment");
  if (action === "like_comment") return i18n.t("runtimeEvent.like_comment");
  if (action === "exit_browsing") return i18n.t("runtimeEvent.exit_browsing");
  return i18n.t("runtimeEvent.fallback");
}

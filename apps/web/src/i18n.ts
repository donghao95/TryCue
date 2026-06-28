import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { zhCN } from "./locales/zh-CN.js";
import { enUS } from "./locales/en-US.js";

export type AppLanguage = "zh-CN" | "en-US";

export const APP_LANGUAGES: AppLanguage[] = ["zh-CN", "en-US"];

const STORAGE_KEY = "trycue.lang";

function detectInitialLanguage(): AppLanguage {
  if (typeof window === "undefined") return "zh-CN";
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === "zh-CN" || stored === "en-US") return stored;
  } catch {
    // localStorage 不可用时回退到默认
  }
  return "zh-CN";
}

void i18n.use(initReactI18next).init({
  resources: {
    "zh-CN": { translation: zhCN },
    "en-US": { translation: enUS }
  },
  lng: detectInitialLanguage(),
  fallbackLng: "zh-CN",
  supportedLngs: APP_LANGUAGES,
  interpolation: {
    escapeValue: false
  }
});

export async function setAppLanguage(language: AppLanguage) {
  await i18n.changeLanguage(language);
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(STORAGE_KEY, language);
    } catch {
      // 忽略 localStorage 不可用
    }
  }
}

export function getCurrentLanguage(): AppLanguage {
  return (i18n.language as AppLanguage) || "zh-CN";
}

export default i18n;

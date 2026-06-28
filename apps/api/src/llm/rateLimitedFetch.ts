/**
 * LLM capacity-limited fetch.
 *
 * This module provides backward-compatible access to the shared capacity
 * manager's fetch function. The actual rate + concurrency limiting and AIMD
 * auto-tuning lives in LlmCapacityManager.
 *
 * All LLM calls through the same provider share one capacity manager instance,
 * so journeys, audience generation, persona generation, report generation, etc.
 * are coordinated automatically.
 */

import type { LlmCapacitySettings } from "@trycue/shared";
import { LlmCapacityManager } from "./llmCapacityManager.js";

let _sharedManager: LlmCapacityManager | null = null;

/**
 * Initializes the shared capacity manager with the given settings.
 * Called once at API startup after LlmConfigStore.load().
 * Subsequent calls update the existing manager (hot reload).
 */
export function initSharedCapacityManager(settings: LlmCapacitySettings): LlmCapacityManager {
  if (!_sharedManager) {
    _sharedManager = new LlmCapacityManager(settings);
  } else {
    _sharedManager.update(settings);
  }
  return _sharedManager;
}

/**
 * Returns the shared capacity manager.
 * Throws if initSharedCapacityManager has not been called yet.
 */
export function getSharedCapacityManager(): LlmCapacityManager {
  if (!_sharedManager) {
    throw new Error("Shared capacity manager not initialized. Call initSharedCapacityManager() first.");
  }
  return _sharedManager;
}

/**
 * Updates the shared capacity manager with new settings (hot reload).
 * Called when /api/settings/llm is saved.
 */
export function updateSharedCapacityManager(settings: LlmCapacitySettings): void {
  if (!_sharedManager) {
    initSharedCapacityManager(settings);
  } else {
    _sharedManager.update(settings);
  }
}

/**
 * Returns the shared capacity-limited fetch function.
 * All real LLM HTTP attempts should use this fetch.
 */
export function getSharedRateLimitedFetch(): typeof globalThis.fetch {
  return getSharedCapacityManager().getFetch();
}

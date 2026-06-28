import type { LlmRuntimeConfig } from "../llmConfigStore.js";
import { shouldUseRealLlm } from "../llmConfigStore.js";
import { MockAgentProvider } from "./mockAgent.js";
import { RealAgentProvider } from "./realAgent.js";
import type { AgentProvider } from "./types.js";

export function createAgentProvider(config: LlmRuntimeConfig, options?: { platformName?: string }): AgentProvider {
  if (shouldUseRealLlm(config)) return new RealAgentProvider(config, options);
  return new MockAgentProvider();
}

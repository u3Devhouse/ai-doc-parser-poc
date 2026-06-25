import { createMockAiOverrides } from "./ai-mock";
import type { AiOverrides } from "./extraction";

export function isAiMockEnabled(): boolean {
  return process.env.AI_GATEWAY_MOCK === "true";
}

export function resolveAiOverrides(explicit?: AiOverrides): AiOverrides | undefined {
  if (explicit) {
    return explicit;
  }
  if (isAiMockEnabled()) {
    return createMockAiOverrides();
  }
  return undefined;
}

import { DEEPSEEK_FLASH_MODEL_ID } from "@/contracts/deepseek/Models";
import { isOfficialDeepSeekEndpoint } from "@/shared/usage/Usage";

// Extend only after validating auxiliary capabilities AND model-specific usage attribution.
const VERIFIED_PRIMARY_MODELS: ReadonlySet<string> = new Set([DEEPSEEK_FLASH_MODEL_ID]);

export function resolveAuxiliaryModel(config: { model: string; baseUrl: string }): string {
  if (!isOfficialDeepSeekEndpoint(config.baseUrl) || !VERIFIED_PRIMARY_MODELS.has(config.model)) {
    return config.model;
  }
  return DEEPSEEK_FLASH_MODEL_ID;
}

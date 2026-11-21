export const DEEPSEEK_FLASH_MODEL_ID = "deepseek-flash" as const;
export const DEEPSEEK_PRO_MODEL_ID = "deepseek-v4-pro" as const;

type DeepSeekModelId = typeof DEEPSEEK_FLASH_MODEL_ID | typeof DEEPSEEK_PRO_MODEL_ID;
export const MAX_OUTPUT_TOKENS = 384_000;

interface DeepSeekModelInfo {
  id: DeepSeekModelId;
  name: string;
  contextLength: number;
  maxOutputTokens: number;
  supportsVision: boolean;
}

export const MODEL_REGISTRY: DeepSeekModelInfo[] = [
  {
    id: DEEPSEEK_FLASH_MODEL_ID,
    name: "DeepSeek V4.1 Flash",
    contextLength: 1_000_000,
    maxOutputTokens: MAX_OUTPUT_TOKENS,
    supportsVision: true,
  },
  {
    id: DEEPSEEK_PRO_MODEL_ID,
    name: "DeepSeek V4 Pro",
    contextLength: 1_000_000,
    maxOutputTokens: MAX_OUTPUT_TOKENS,
    supportsVision: false,
  },
] as const;

export function modelSupportsVision(modelId: string): boolean {
  return MODEL_REGISTRY.find((entry) => entry.id === modelId)?.supportsVision ?? true;
}

type ModelOption = { value: DeepSeekModelId; label: string };
export const MODEL_OPTIONS: ModelOption[] = MODEL_REGISTRY.map((m) => ({
  value: m.id,
  label: m.name,
}));

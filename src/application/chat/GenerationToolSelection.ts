import type { ToolDefinition } from "@/contracts";
import { DEEPSEEK_PRO_MODEL_ID, DEEPSEEK_FLASH_MODEL_ID } from "@/contracts/deepseek/Models";
import type { ToolRegistry } from "@/application/tools/ToolRegistry";
import { NATIVE_IMAGE_ANALYSIS_DESCRIPTION } from "./context/ImageReferences";

const WEB_TOOL_NAMES = new Set(["search_web", "read_web"]);
const TERMINAL_TOOL_NAME = "run_terminal_command";
const IMAGE_ANALYSIS_TOOL_NAME = "analyze_images";

export interface GenerationToolAvailability {
  files: boolean;
  terminal: boolean;
  webSearchEnabled: boolean;
  modelId: string;
  hasImageAttachments: boolean;
}

export function selectGenerationTools(
  registry: ToolRegistry,
  availability: GenerationToolAvailability,
): ToolDefinition[] {
  return registry.getDefinitionsForAPI().filter((tool) => {
    const name = tool.function.name;
    const registered = registry.get(name);

    if (name === IMAGE_ANALYSIS_TOOL_NAME) {
      return ([DEEPSEEK_PRO_MODEL_ID, DEEPSEEK_FLASH_MODEL_ID] as readonly string[]).includes(availability.modelId);
    }

    if (registered?.metadata.scope !== "global") {
      if (!availability.files) {
        return false;
      }
      if (name === TERMINAL_TOOL_NAME && !availability.terminal) {
        return false;
      }
    }

    if (!availability.webSearchEnabled && WEB_TOOL_NAMES.has(name)) {
      return false;
    }

    return true;
  }).map((tool) => tool.function.name === IMAGE_ANALYSIS_TOOL_NAME && availability.modelId === DEEPSEEK_FLASH_MODEL_ID
    ? { ...tool, function: { ...tool.function, description: NATIVE_IMAGE_ANALYSIS_DESCRIPTION } }
    : tool);
}

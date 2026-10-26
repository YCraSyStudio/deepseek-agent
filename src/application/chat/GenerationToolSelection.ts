import type { ToolDefinition } from "@/contracts";
import { DEEPSEEK_PRO_MODEL_ID } from "@/contracts/deepseek/Models";
import type { ToolRegistry } from "@/application/tools/ToolRegistry";

const WEB_TOOL_NAMES = new Set(["search_web", "read_web"]);
const TERMINAL_TOOL_NAMES = new Set(["run_terminal_command", "application_session"]);
const IMAGE_ANALYSIS_TOOL_NAME = "analyze_images";

export interface GenerationToolAvailability {
  files: boolean;
  terminal: boolean;
  webSearchEnabled: boolean;
  modelId: string;
  betaFeaturesEnabled?: boolean;
}

export function selectGenerationTools(
  registry: ToolRegistry,
  availability: GenerationToolAvailability,
): ToolDefinition[] {
  return registry.getDefinitionsForAPI().filter((tool) => {
    const name = tool.function.name;
    const registered = registry.get(name);
    if (name === "complete_code" && !availability.betaFeaturesEnabled) {return false;}

    if (name === "capture_screenshot" && !availability.files) {return false;}

    if (name === IMAGE_ANALYSIS_TOOL_NAME) {
      return availability.modelId === DEEPSEEK_PRO_MODEL_ID;
    }

    if (registered?.metadata.scope !== "global") {
      if (!availability.files) {
        return false;
      }
      if (TERMINAL_TOOL_NAMES.has(name) && !availability.terminal) {
        return false;
      }
    }

    if (!availability.webSearchEnabled && WEB_TOOL_NAMES.has(name)) {
      return false;
    }

    return true;
  });
}

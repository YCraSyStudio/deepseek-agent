import * as assert from "node:assert";
import { selectGenerationTools } from "@/application/chat/GenerationToolSelection";
import { ToolRegistry } from "@/application/tools/ToolRegistry";
import type { RegisteredTool, ToolMetadata } from "@/application/tools/Types";
import { DEEPSEEK_FLASH_MODEL_ID, DEEPSEEK_PRO_MODEL_ID } from "@/contracts";
import { analyzeImagesTool } from "@/infrastructure/tools/builtins/vision/AnalyzeImages";
import { completeCodeTool } from "@/infrastructure/tools/builtins/code/CompleteCode";
import { applicationSessionTool } from "@/infrastructure/tools/builtins/terminal/ApplicationSession";

suite("generation tool selection", () => {
  test("offers beta code generation only when explicitly enabled", () => {
    const registry = createRegistry();
    registry.register(completeCodeTool);
    assert.ok(!names(selectGenerationTools(registry, availability())).includes("complete_code"));
    assert.ok(names(selectGenerationTools(registry, availability({ betaFeaturesEnabled: true, files: false }))).includes("complete_code"));
  });
  test("keeps global tools when workspace files are unavailable", () => {
    const registry = createRegistry();
    assert.deepStrictEqual(
      names(selectGenerationTools(registry, availability({ files: false }))),
      ["search_web", "read_web", "analyze_images"],
    );
  });

  test("removes terminal when the captured workspace has no terminal capability", () => {
    const registry = createRegistry();
    registry.register(applicationSessionTool);
    assert.deepStrictEqual(
      names(selectGenerationTools(registry, availability({ terminal: false }))),
      ["read_file", "create_file", "search_web", "read_web", "analyze_images"],
    );
    assert.ok(names(selectGenerationTools(registry, availability())).includes("application_session"));
    assert.ok(!names(selectGenerationTools(registry, availability({ files: false }))).includes("application_session"));
  });

  test("removes both web tools when web search is disabled", () => {
    const registry = createRegistry();
    assert.deepStrictEqual(
      names(selectGenerationTools(registry, availability({ webSearchEnabled: false }))),
      ["read_file", "create_file", "run_terminal_command", "analyze_images"],
    );
  });

  test("excludes delegated analysis from Flash and keeps it for Pro without requiring attachments", () => {
    const registry = new ToolRegistry();
    registry.register(analyzeImagesTool);
    for (const files of [true, false]) {
      assert.deepStrictEqual(selectGenerationTools(registry, availability({ modelId: DEEPSEEK_FLASH_MODEL_ID, files })), []);
      assert.deepStrictEqual(selectGenerationTools(registry, availability({ modelId: DEEPSEEK_PRO_MODEL_ID, files })), [analyzeImagesTool.definition]);
    }
    assert.strictEqual(registry.get("analyze_images")?.definition, analyzeImagesTool.definition);
  });
});

function createRegistry(): ToolRegistry {
  const registry = new ToolRegistry();
  register(registry, "read_file", { dangerLevel: "safe", requiresConfirmation: false, effect: "read-only" });
  register(registry, "create_file", { dangerLevel: "caution", requiresConfirmation: true, effect: "workspace-mutation" });
  register(registry, "run_terminal_command", { dangerLevel: "dangerous", requiresConfirmation: true, effect: "workspace-mutation" });
  register(registry, "search_web", { dangerLevel: "safe", requiresConfirmation: false, scope: "global", effect: "external-effect" });
  register(registry, "read_web", { dangerLevel: "safe", requiresConfirmation: false, scope: "global", effect: "external-effect" });
  register(registry, "analyze_images", { dangerLevel: "safe", requiresConfirmation: false, scope: "global", effect: "external-effect" });
  return registry;
}

function register(registry: ToolRegistry, name: string, metadata: ToolMetadata): void {
  const tool: RegisteredTool = {
    definition: {
      type: "function",
      function: {
        name,
        description: name,
        strict: true,
        parameters: { type: "object", properties: {}, additionalProperties: false },
      },
    },
    metadata,
    handler: async () => "ok",
  };
  registry.register(tool);
}

function availability(overrides: Partial<Parameters<typeof selectGenerationTools>[1]> = {}): Parameters<typeof selectGenerationTools>[1] {
  return {
    files: true,
    terminal: true,
    webSearchEnabled: true,
    modelId: DEEPSEEK_PRO_MODEL_ID,
    ...overrides,
  };
}

function names(tools: ReturnType<typeof selectGenerationTools>): string[] {
  return tools.map((tool) => tool.function.name);
}

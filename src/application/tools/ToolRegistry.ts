import type { ToolDefinition } from "@/contracts";
import { logWarning } from "@/shared/logging/Logger";
import { isRecord } from "@/shared/utils/TypeGuards";
import type { RegisteredTool, ValidationResult } from "./Types";

export class ToolRegistry {
  private tools = new Map<string, RegisteredTool>();

  register(tool: RegisteredTool): void {
    const name = tool.definition.function.name;
    if (this.tools.has(name)) {
      logWarning(`[ToolRegistry] Tool '${name}' already registered. Overwriting.`);
    }
    this.tools.set(name, tool);
  }

  get(name: string): RegisteredTool | undefined {
    return this.tools.get(name);
  }

  getDefinitionsForAPI(): ToolDefinition[] {
    return Array.from(this.tools.values()).map((t) => t.definition);
  }

  validate(toolCall: { function: { name: string; arguments: string } }): ValidationResult {
    const toolDef = this.tools.get(toolCall.function.name);
    if (!toolDef) {
      return { valid: false, error: `Unknown tool: ${toolCall.function.name}` };
    }

    try {
      const args: unknown = JSON.parse(toolCall.function.arguments);
      const schemaValidation = validateAgainstToolSchema(args, toolDef.definition.function.parameters);
      if (!schemaValidation.valid) {
        return { valid: false, error: `Invalid arguments for ${toolCall.function.name}: ${schemaValidation.error}` };
      }
      return { valid: true };
    } catch {
      return { valid: false, error: `Invalid JSON arguments for ${toolCall.function.name}` };
    }
  }

  get size(): number {
    return this.tools.size;
  }
}

function validateAgainstToolSchema(args: unknown, schema: Record<string, unknown>): ValidationResult {
  if (!args || typeof args !== "object" || Array.isArray(args)) {
    return { valid: false, error: "arguments must be an object" };
  }

  const record = args as Record<string, unknown>;
  const properties = isRecord(schema.properties) ? schema.properties : {};
  const required = Array.isArray(schema.required) ? schema.required.filter((value): value is string => typeof value === "string") : [];

  for (const key of required) {
    if (!(key in record)) {
      return { valid: false, error: `missing required property '${key}'` };
    }
  }

  if (schema.additionalProperties === false) {
    for (const key of Object.keys(record)) {
      if (!(key in properties)) {
        return { valid: false, error: `unknown property '${key}'` };
      }
    }
  }

  for (const [key, value] of Object.entries(record)) {
    const propertySchema = properties[key];
    if (!isRecord(propertySchema)) {
      continue;
    }

    const expectedType = propertySchema.type;
    if (typeof expectedType === "string" && !matchesJsonSchemaType(value, expectedType)) {
      return { valid: false, error: `property '${key}' must be ${expectedType}` };
    }
  }

  return { valid: true };
}

function matchesJsonSchemaType(value: unknown, expectedType: string): boolean {
  switch (expectedType) {
    case "string":
      return typeof value === "string";
    case "boolean":
      return typeof value === "boolean";
    case "number":
      return typeof value === "number";
    case "integer":
      return Number.isInteger(value);
    case "object":
      return isRecord(value);
    case "array":
      return Array.isArray(value);
    default:
      return true;
  }
}

import type { AvailableToolInfo, ToolDefinition } from "@/contracts";

export function getAvailableToolMetadata(definitions: ToolDefinition[]): AvailableToolInfo[] {
  return definitions.map((definition) => {
    const name = definition.function.name;
    const params = definition.function.parameters;
    const properties = getRecord(params.properties);
    const required = (params?.required as string[]) ?? [];

    return {
      name,
      description: definition.function.description ?? "",
      parameters: Object.entries(properties).map(([paramName, schema]) => ({
        name: paramName,
        type: getSchemaType(schema),
        required: required.includes(paramName),
        description: getSchemaDescription(schema),
      })),
    };
  });
}

function getRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function getSchemaType(schema: unknown): string {
  const record = getRecord(schema);
  return typeof record.type === "string" ? record.type : "string";
}

function getSchemaDescription(schema: unknown): string {
  const record = getRecord(schema);
  return typeof record.description === "string" ? record.description : "";
}

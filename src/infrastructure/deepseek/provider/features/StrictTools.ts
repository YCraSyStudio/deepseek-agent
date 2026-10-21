import type { ChatMessage, ToolDefinition } from "@/contracts";
import { isRecord } from "@/shared/utils/TypeGuards";

const UNSUPPORTED = new Set(["minLength", "maxLength", "minItems", "maxItems"]);

export function prepareProviderTools(tools: ToolDefinition[], betaEnabled: boolean): ToolDefinition[] {
  return tools.map((tool) => {
    const { strict: _strict, ...fn } = tool.function;
    return { ...tool, function: betaEnabled
      ? { ...fn, strict: true, parameters: strictSchema(fn.parameters) }
      : fn };
  });
}

function strictSchema(schema: Record<string, unknown>): Record<string, unknown> {
  const result = Object.fromEntries(Object.entries(schema).filter(([key]) => !UNSUPPORTED.has(key)));
  if (Array.isArray(schema.anyOf)) {
    result.anyOf = schema.anyOf.map((item) => isRecord(item) ? strictSchema(item) : item);
  }
  if (isRecord(schema.items)) {result.items = strictSchema(schema.items);}
  if (isRecord(schema.properties)) {
    const required = new Set(Array.isArray(schema.required) ? schema.required : []);
    result.properties = Object.fromEntries(Object.entries(schema.properties).map(([key, value]) => {
      if (!isRecord(value)) {throw new Error("Invalid tool parameter schema");}
      const property = strictSchema(value);
      return [key, required.has(key) ? property : {
        anyOf: [property, { enum: [null] }],
        description: `${typeof value.description === "string" ? value.description : key} Use null to omit this optional parameter.`,
      }];
    }));
    result.required = Object.keys(schema.properties);
    result.additionalProperties = false;
  }
  return result;
}

export function normalizeBetaToolMessages(messages: ChatMessage[], tools: ToolDefinition[]): ChatMessage[] {
  return messages.map((message) => !message.tool_calls ? message : {
    ...message,
    tool_calls: message.tool_calls.map((call) => {
      const tool = tools.find((item) => item.function.name === call.function.name);
      if (!tool) {return call;}
      try {
        const args = JSON.parse(call.function.arguments) as unknown;
        return { ...call, function: { ...call.function, arguments: JSON.stringify(omitOptionalNulls(args, tool.function.parameters)) } };
      } catch {return call;}
    }),
  });
}

function omitOptionalNulls(value: unknown, schema: Record<string, unknown>): unknown {
  if (Array.isArray(value) && isRecord(schema.items)) {return value.map((item) => omitOptionalNulls(item, schema.items as Record<string, unknown>));}
  if (!isRecord(value) || !isRecord(schema.properties)) {return value;}
  const required = new Set(Array.isArray(schema.required) ? schema.required : []);
  const properties = schema.properties;
  return Object.fromEntries(Object.entries(value)
    .filter(([key, item]) => item !== null || required.has(key) || !Object.hasOwn(properties, key))
    .map(([key, item]) => [key, isRecord(properties[key]) ? omitOptionalNulls(item, properties[key]) : item]));
}

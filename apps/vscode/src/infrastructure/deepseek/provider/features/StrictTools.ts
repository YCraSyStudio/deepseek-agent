import type { ChatMessage, ToolDefinition } from "@/contracts";
import { isRecord } from "@/shared/utils/TypeGuards";

const UNSUPPORTED = new Set(["minLength", "maxLength", "minItems", "maxItems"]);

export function prepareProviderTools(tools: ToolDefinition[], betaEnabled: boolean): ToolDefinition[] {
  return tools.map((tool) => {
    const { strict: _strict, parameters, ...fn } = tool.function;
    if (!betaEnabled) {return { ...tool, function: { ...fn, ...(parameters ? { parameters } : {}) } };}
    const noArguments = !parameters || (parameters.type === "object" && isRecord(parameters.properties) && Object.keys(parameters.properties).length === 0);
    return { ...tool, function: { ...fn, strict: true, ...(!noArguments ? { parameters: strictSchema(parameters!) } : {}) } };
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
        anyOf: [property, { type: "object", properties: { __omit: { type: "boolean", enum: [true] } }, required: ["__omit"], additionalProperties: false }],
        description: `${typeof value.description === "string" ? value.description : key} Use {"__omit":true} to omit this optional parameter.`,
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
        return { ...call, function: { ...call.function, arguments: JSON.stringify(omitOptionalArguments(args, tool.function.parameters ?? { type: "object", properties: {}, additionalProperties: false })) } };
      } catch {return call;}
    }),
  });
}

function omitOptionalArguments(value: unknown, schema: Record<string, unknown>): unknown {
  if (Array.isArray(value) && isRecord(schema.items)) {return value.map((item) => omitOptionalArguments(item, schema.items as Record<string, unknown>));}
  if (!isRecord(value) || !isRecord(schema.properties)) {return value;}
  const required = new Set(Array.isArray(schema.required) ? schema.required : []);
  const properties = schema.properties;
  return Object.fromEntries(Object.entries(value)
    .filter(([key, item]) => {
      if (required.has(key) || !isRecord(properties[key])) {return true;}
      if (isRecord(item) && item.__omit === true && Object.keys(item).length === 1) {return false;}
      // Keep accepting null from older in-flight beta responses. Object-valued
      // host parameters retain their own empty objects rather than becoming omissions.
      return item !== null && !(isRecord(item) && Object.keys(item).length === 0 && properties[key].type !== "object");
    })
    .map(([key, item]) => [key, isRecord(properties[key]) ? omitOptionalArguments(item, properties[key]) : item]));
}

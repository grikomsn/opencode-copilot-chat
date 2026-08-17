import * as vscode from "vscode";
import { sanitizeToolSchema } from "./schema";

export interface FunctionTool {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export function buildFunctionTools(tools: readonly vscode.LanguageModelChatTool[] | undefined): FunctionTool[] {
  return (tools ?? []).map((tool) => ({
    type: "function",
    function: {
      name: providerToolName(tool.name),
      description: tool.description,
      parameters: sanitizeToolSchema(tool.inputSchema),
    },
  }));
}

export function buildResponsesTools(tools: readonly vscode.LanguageModelChatTool[] | undefined): Record<string, unknown>[] {
  return (tools ?? []).map((tool) => ({
    type: "function",
    name: providerToolName(tool.name),
    description: tool.description,
    parameters: sanitizeToolSchema(tool.inputSchema),
  }));
}

export function providerToolName(name: string): string {
  if (name.length <= 64) return name;
  let hash = 2166136261;
  for (let index = 0; index < name.length; index += 1) hash = Math.imul(hash ^ name.charCodeAt(index), 16777619);
  const suffix = `_${(hash >>> 0).toString(16).padStart(8, "0")}`;
  return `${name.slice(0, 64 - suffix.length)}${suffix}`;
}

export function originalToolName(alias: string, tools: readonly vscode.LanguageModelChatTool[] | undefined): string {
  return (tools ?? []).find((tool) => providerToolName(tool.name) === alias)?.name ?? alias;
}

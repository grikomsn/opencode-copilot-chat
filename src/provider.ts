import * as vscode from "vscode";
import { randomUUID } from "node:crypto";
import { OpenCodeAuth } from "./auth/auth";
import { messageOf, responseError } from "./errors";
import { catalogScope, ModelCatalog, type OpenCodeModel } from "./models/catalog";
import { advertisedModelLimits, requestOutputLimit } from "./models/limits";
import { modelConfigurationSchema, requestModelConfiguration, resolveThinkingSelection, thinkingFamilyForModel, type ReasoningEffort } from "./models/options";
import { convertChatMessages, convertResponsesMessages } from "./provider/messages";
import { buildRequestBody, mergeRequestBody } from "./provider/request";
import { analyzeHttp400ForRetry, isTransientServerError, retryDelayMs } from "./provider/retry";
import { reportStreamEvent } from "./provider/response";
import { buildFunctionTools, buildResponsesTools, originalToolName } from "./tools/client-tools";
import { endpointUrl, buildRequestHeaders, type OpenCodeMode } from "./transport/protocol";
import { OpenCodeStreamParser } from "./transport/sse";
import type { OpenCodeUsageSnapshot } from "./usage/domain";
import { OpenCodeUsageStore } from "./usage/store";

export interface OpenCodeModelInformation extends vscode.LanguageModelChatInformation {
  readonly rawModelId: string;
  readonly catalogId: string;
  readonly mode: OpenCodeMode;
}

export class OpenCodeProvider implements vscode.LanguageModelChatProvider<OpenCodeModelInformation> {
  private readonly changeEmitter = new vscode.EventEmitter<void>();
  private readonly catalog: ModelCatalog;

  readonly onDidChangeLanguageModelChatInformation = this.changeEmitter.event;
  readonly onDidChangeUsage: vscode.Event<OpenCodeUsageSnapshot>;

  constructor(
    private readonly auth: OpenCodeAuth,
    private readonly output: vscode.OutputChannel,
    private readonly userAgent: string,
    private readonly mode: OpenCodeMode,
    catalog = new ModelCatalog(),
    private readonly usageStore = new OpenCodeUsageStore(),
  ) {
    this.catalog = catalog;
    this.onDidChangeUsage = usageStore.onDidChange;
  }

  fireDidChange(): void { this.changeEmitter.fire(); }
  getUsageSnapshot(): OpenCodeUsageSnapshot { return this.usageStore.get(); }
  clearUsage(): void { this.usageStore.clear(); }

  async refreshModels(): Promise<readonly OpenCodeModel[]> {
    const mode = this.mode;
    const credential = await this.auth.getCredential(mode);
    const models = await this.catalog.refresh(mode, credential, this.freeOnly());
    this.changeEmitter.fire();
    return models;
  }

  async provideLanguageModelChatInformation(
    _options: vscode.PrepareLanguageModelChatModelOptions,
    token: vscode.CancellationToken,
  ): Promise<OpenCodeModelInformation[]> {
    if (token.isCancellationRequested) return [];
    const mode = this.mode;
    const credential = await this.auth.getCredential(mode);
    const maxAge = Math.max(1, vscode.workspace.getConfiguration("opencode").get<number>("catalogCacheMinutes", 5)) * 60_000;
    if (!this.catalog.isFresh(mode, maxAge, catalogScope(mode, credential, this.freeOnly())) && (mode !== "console" || credential)) {
      const controller = new AbortController();
      const listener = token.onCancellationRequested(() => controller.abort());
      try { await this.catalog.refreshSafely(mode, credential, this.freeOnly(), controller.signal); }
      catch (error) { this.output.appendLine(`[models] ${messageOf(error)}`); }
      finally { listener.dispose(); }
    }
    return this.catalog.list(mode).map((model) => this.toInformation(model, mode, Boolean(credential)));
  }

  async provideLanguageModelChatResponse(
    information: OpenCodeModelInformation,
    messages: readonly vscode.LanguageModelChatRequestMessage[],
    options: vscode.ProvideLanguageModelChatResponseOptions,
    progress: vscode.Progress<vscode.LanguageModelResponsePart2>,
    token: vscode.CancellationToken,
  ): Promise<void> {
    const mode = information.mode;
    let credential = await this.auth.getCredential(mode);
    if (!credential) throw new Error(`Sign in to OpenCode ${mode === "console" ? "Console" : mode === "go" ? "Go" : "Zen"} before using this model`);
    const model = this.catalog.get(mode, information.catalogId) ?? this.catalog.list(mode).find((item) => item.rawModelId === information.rawModelId);
    if (!model) throw new Error(`OpenCode model is no longer available: ${information.rawModelId}`);
    const converted = model.endpoint === "responses" ? [] : convertChatMessages(messages);
    const responsesInput = model.endpoint === "responses" ? convertResponsesMessages(messages) : [];
    const tools = model.endpoint === "responses" ? [] : buildFunctionTools(options.tools);
    const responsesTools = model.endpoint === "responses" ? buildResponsesTools(options.tools) : [];
    const config = vscode.workspace.getConfiguration("opencode");
    const family = thinkingFamilyForModel(model);
    const familyEffort = family ? configuredValue<ReasoningEffort>(config, `thinking.${family}`) : undefined;
    const fallbackEffort = familyEffort ?? config.get<ReasoningEffort>("reasoningEffort", "high");
    const fallbackBudget = family === "qwen" ? config.get<string>("thinking.qwenBudget", "auto") : undefined;
    const thinking = resolveThinkingSelection(model, requestModelConfiguration(options), fallbackEffort, fallbackBudget);
    const maxOutput = requestOutputLimit(model, config.get<number>("maxOutputTokens", 0), estimateInputTokens(messages, options.tools));
    const body = buildRequestBody(model, converted, responsesInput, tools, responsesTools, thinking, maxOutput, options.toolMode === vscode.LanguageModelChatToolMode.Required ? "required" : "auto");
    const controller = new AbortController();
    const cancellation = token.onCancellationRequested(() => controller.abort());
    const timeoutSeconds = Math.max(10, config.get<number>("requestTimeoutSeconds", 600));
    const idleSeconds = Math.max(10, config.get<number>("streamIdleTimeoutSeconds", 120));
    const sessionId = sessionIdFrom(messages, model.rawModelId);
    let idle: ReturnType<typeof setTimeout> | undefined;
    let sawOutput = false;
    let requestBody = mergeRequestBody(model.body, body);
    let authRefreshed = false;
    let parameterRetried = false;
    let transientRetries = 0;
    try {
      if (config.get<boolean>("debugLogging", false)) {
        this.output.appendLine(`[request] mode=${mode} model=${model.rawModelId} endpoint=${model.endpoint} maxOutput=${String(maxOutput)} tools=${String(options.tools?.length ?? 0)} initiator=${options.requestInitiator ?? "unknown"}`);
      }
      while (true) {
        const requestId = randomUUID();
        const headers = buildRequestHeaders(model.endpoint, credential.token, this.userAgent, requestId, sessionId, model.headers);
        if (credential.orgId) headers["x-org-id"] = credential.orgId;
        const total = setTimeout(() => controller.abort(), timeoutSeconds * 1000);
        const resetIdle = () => {
          if (idle) clearTimeout(idle);
          idle = setTimeout(() => controller.abort(), idleSeconds * 1000);
        };
        resetIdle();
        try {
          const response = await fetch(endpointUrl(model.baseUrl, model.endpoint, model.rawModelId), { method: "POST", headers, body: JSON.stringify(requestBody), signal: controller.signal });
          if (response.status === 401 && mode === "console" && !authRefreshed) {
            authRefreshed = true;
            credential = await this.auth.getCredential(mode, true);
            if (!credential) throw new Error("OpenCode credentials expired; sign in again");
            continue;
          }
          if (!response.ok) {
            const error = await responseError(`OpenCode request failed for ${model.rawModelId}`, response);
            if (response.status === 400 && !parameterRetried) {
              const patch = analyzeHttp400ForRetry(error.message, requestBody);
              if (patch) {
                parameterRetried = true;
                requestBody = patch.body;
                this.output.appendLine(`[request] retrying ${model.rawModelId}: ${patch.reason}`);
                continue;
              }
            }
            if (transientRetries < 2 && isTransientServerError(response.status, error.message)) {
              const delay = retryDelayMs(transientRetries++);
              this.output.appendLine(`[request] retrying transient ${response.status} for ${model.rawModelId} in ${String(delay)}ms`);
              await waitForRetry(delay, controller.signal);
              continue;
            }
            throw error;
          }
          if (!response.body) throw new Error("OpenCode returned an empty response stream");
          const parser = new OpenCodeStreamParser(model.endpoint);
          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          while (true) {
            const part = await reader.read();
            if (part.done) break;
            resetIdle();
            for (const event of parser.push(decoder.decode(part.value, { stream: true }))) {
              sawOutput ||= Boolean(event.text || event.reasoning || event.toolCalls?.length);
              const usage = reportStreamEvent(event, progress, model.rawModelId, (name) => originalToolName(name, options.tools));
              if (usage) this.setUsage(usage);
            }
            if (token.isCancellationRequested) return;
          }
          for (const event of parser.finish()) {
            sawOutput ||= Boolean(event.text || event.reasoning || event.toolCalls?.length);
            const usage = reportStreamEvent(event, progress, model.rawModelId, (name) => originalToolName(name, options.tools));
            if (usage) this.setUsage(usage);
          }
          if (!sawOutput) throw new Error(`OpenCode returned no content for ${model.rawModelId}`);
          if (config.get<boolean>("debugLogging", false)) this.output.appendLine(`[response] mode=${mode} model=${model.rawModelId} completed=true`);
          return;
        } finally {
          clearTimeout(total);
          if (idle) clearTimeout(idle);
        }
      }
    } catch (error) {
      if (token.isCancellationRequested) return;
      throw error;
    } finally {
      if (idle) clearTimeout(idle);
      cancellation.dispose();
    }
  }

  async provideTokenCount(_model: OpenCodeModelInformation, value: string | vscode.LanguageModelChatRequestMessage, _token: vscode.CancellationToken): Promise<number> {
    const text = typeof value === "string" ? value : value.content.map((part) => part instanceof vscode.LanguageModelTextPart ? part.value : "").join("\n");
    return Math.max(0, Math.ceil(text.length / 4));
  }

  private toInformation(model: OpenCodeModel, mode: OpenCodeMode, authenticated: boolean): OpenCodeModelInformation {
    const config = vscode.workspace.getConfiguration("opencode");
    const family = thinkingFamilyForModel(model);
    const defaultEffort = family ? configuredValue<ReasoningEffort>(config, `thinking.${family}`) : config.get<ReasoningEffort>("reasoningEffort", "high");
    const defaultBudget = family === "qwen" ? config.get<string>("thinking.qwenBudget", "auto") : undefined;
    const configurationSchema = modelConfigurationSchema(model, defaultEffort, defaultBudget);
    return {
      id: model.id,
      name: model.name,
      version: "3-provider-groups",
      family: model.family,
      ...advertisedModelLimits(model),
      capabilities: { imageInput: model.imageInput, toolCalling: model.toolCalling },
      ...(configurationSchema ? { configurationSchema } : {}),
      isUserSelectable: true,
      ...(authenticated ? {} : { requiresAuthorization: { label: `Sign in to OpenCode ${mode}` } }),
      rawModelId: model.rawModelId,
      catalogId: model.id,
      mode,
    };
  }

  private freeOnly(): boolean { return vscode.workspace.getConfiguration("opencode").get("freeOnly", true); }
  private setUsage(usage: OpenCodeUsageSnapshot): void { this.usageStore.record(usage); }
}

function configuredValue<T>(config: vscode.WorkspaceConfiguration, key: string): T | undefined {
  const inspected = config.inspect<T>(key);
  return inspected?.workspaceFolderValue ?? inspected?.workspaceValue ?? inspected?.globalValue;
}

function estimateInputTokens(messages: readonly vscode.LanguageModelChatRequestMessage[], tools: readonly vscode.LanguageModelChatTool[] | undefined): number {
  let characters = 0;
  let images = 0;
  for (const message of messages) for (const part of message.content) {
    if (part instanceof vscode.LanguageModelTextPart) characters += part.value.length;
    else if (part instanceof vscode.LanguageModelDataPart && part.mimeType.startsWith("image/")) images += 1;
    else if (part instanceof vscode.LanguageModelToolCallPart) characters += JSON.stringify(part.input ?? {}).length + part.name.length;
    else if (part instanceof vscode.LanguageModelToolResultPart) characters += part.content.map((item) => item instanceof vscode.LanguageModelTextPart ? item.value.length : 0).reduce((sum, value) => sum + value, 0);
  }
  characters += (tools ?? []).reduce((sum, tool) => sum + tool.name.length + tool.description.length + JSON.stringify(tool.inputSchema ?? {}).length, 0);
  return Math.ceil(characters / 4) + images * 1_024;
}

function waitForRetry(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, milliseconds);
    signal.addEventListener("abort", () => { clearTimeout(timer); reject(signal.reason ?? new Error("Request cancelled")); }, { once: true });
  });
}

function sessionIdFrom(messages: readonly vscode.LanguageModelChatRequestMessage[], model: string): string {
  const text = `${model}:${messages.slice(0, 2).map((message) => message.content.map((part) => part instanceof vscode.LanguageModelTextPart ? part.value : "").join(" ")).join("|")}`;
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) hash = Math.imul(hash ^ text.charCodeAt(index), 16777619);
  return `vscode-${(hash >>> 0).toString(16)}`;
}

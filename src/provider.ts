import * as vscode from "vscode";
import { randomUUID } from "node:crypto";
import { DEFAULT_CONSOLE_PROFILE, normalizeConsoleProfile, OpenCodeAuth, type Credential } from "./auth/auth";
import { messageOf, responseError } from "./errors";
import { catalogScope, ModelCatalog, type OpenCodeModel } from "./models/catalog";
import { advertisedModelLimits, requestOutputLimit } from "./models/limits";
import { modelConfigurationSchema, requestModelConfiguration, resolveThinkingSelection, thinkingFamilyForModel, type ReasoningEffort } from "./models/options";
import { convertChatMessages, convertResponsesMessages } from "./provider/messages";
import { apiKeyCredentialId, managementCredentialOptions, resolveManagementCredential, type ManagementCredentialOption } from "./provider/management";
import { buildRequestBody, mergeRequestBody } from "./provider/request";
import { analyzeHttp400ForRetry, isTransientServerError, retryDelayMs } from "./provider/retry";
import { reportStreamEvent } from "./provider/response";
import { buildFunctionTools, buildResponsesTools, originalToolName } from "./tools/client-tools";
import { endpointUrl, buildRequestHeaders, type OpenCodeMode } from "./transport/protocol";
import { OpenCodeStreamParser } from "./transport/sse";
import { recordRequestUsage, type OpenCodeUsageSnapshot } from "./usage/domain";
import { consoleProfileFromConfiguration, qualifiedModelId } from "./provider-profile";

export interface OpenCodeModelInformation extends vscode.LanguageModelChatInformation {
  readonly rawModelId: string;
  readonly catalogId: string;
  readonly mode: OpenCodeMode;
  readonly credentialId: string;
  readonly profile?: string;
}

export class OpenCodeProvider implements vscode.LanguageModelChatProvider<OpenCodeModelInformation> {
  private readonly changeEmitter = new vscode.EventEmitter<void>();
  private readonly usageEmitter = new vscode.EventEmitter<{ scope: string; usage: OpenCodeUsageSnapshot }>();
  private readonly catalogs = new Map<string, ModelCatalog>();
  private readonly credentials = new Map<string, Credential>();
  private readonly usageByScope = new Map<string, OpenCodeUsageSnapshot>();
  private activeCredentialId = "legacy";
  private lastUsedCredentialId = "legacy";
  private activeProfile = DEFAULT_CONSOLE_PROFILE;

  readonly onDidChangeLanguageModelChatInformation = this.changeEmitter.event;
  readonly onDidChangeUsage = this.usageEmitter.event;

  constructor(
    private readonly auth: OpenCodeAuth,
    private readonly output: vscode.OutputChannel,
    private readonly userAgent: string,
    private readonly mode: OpenCodeMode,
    private readonly catalogFactory: () => ModelCatalog = () => new ModelCatalog(),
    initialUsage: Readonly<Record<string, OpenCodeUsageSnapshot>> = {},
  ) {
    for (const [scope, usage] of Object.entries(initialUsage)) {
      if (scope.startsWith(`${mode}:`)) this.usageByScope.set(scope, usage);
    }
  }

  fireDidChange(): void { this.changeEmitter.fire(); }
  getActiveScope(): string { return this.scopeFor(this.lastUsedCredentialId); }
  getActiveCredentialId(): string { return this.activeCredentialId; }
  getActiveProfile(): string { return this.activeProfile; }
  setActiveConsoleProfile(profile: string): void {
    this.activeProfile = normalizeConsoleProfile(profile);
    this.activeCredentialId = `profile-${this.activeProfile}`;
  }
  getUsageSnapshot(): OpenCodeUsageSnapshot { return this.usageByScope.get(this.getActiveScope()) ?? {}; }
  getManagementUsageSnapshot(): OpenCodeUsageSnapshot { return this.usageByScope.get(this.scopeFor(this.activeCredentialId)) ?? {}; }
  getUsageSnapshots(): Readonly<Record<string, OpenCodeUsageSnapshot>> { return Object.fromEntries(this.usageByScope); }
  clearUsage(): void { this.setUsageSnapshot(this.scopeFor(this.activeCredentialId), {}); }

  invalidateConsoleProfile(profile: string): void {
    this.credentials.delete(`profile-${normalizeConsoleProfile(profile)}`);
  }

  async refreshModels(): Promise<readonly OpenCodeModel[]> {
    const mode = this.mode;
    const credentialId = mode === "console" ? `profile-${this.activeProfile}` : this.activeCredentialId;
    this.activeCredentialId = credentialId;
    const legacy = await this.auth.getCredential(mode, false, this.activeProfile);
    const credential = mode === "console"
      ? legacy
      : resolveManagementCredential(credentialId, this.credentials, legacy);
    if (!credential) {
      throw new Error(`The selected OpenCode ${mode === "go" ? "Go" : "Zen"} provider credential is unavailable. Choose an entry again or update it in Manage Language Models.`);
    }
    if (credential) this.credentials.set(this.activeCredentialId, credential);
    const models = await this.catalogFor(this.activeCredentialId).refresh(mode, credential, this.freeOnly());
    this.changeEmitter.fire();
    return models;
  }

  async provideLanguageModelChatInformation(
    options: vscode.PrepareLanguageModelChatModelOptions,
    token: vscode.CancellationToken,
  ): Promise<OpenCodeModelInformation[]> {
    if (token.isCancellationRequested) return [];
    if (!options.configuration) return [];
    const mode = this.mode;
    let entry: Awaited<ReturnType<OpenCodeProvider["entryFromConfiguration"]>>;
    try {
      entry = await this.entryFromConfiguration(options.configuration);
    } catch (error) {
      const message = messageOf(error);
      this.output.appendLine(`[models] ${message}`);
      if (!options.silent) void vscode.window.showErrorMessage(message);
      return [];
    }
    if (!entry) return [];
    const { credential, credentialId, profile } = entry;
    this.credentials.set(credentialId, credential);
    const catalog = this.catalogFor(credentialId);
    const maxAge = Math.max(1, vscode.workspace.getConfiguration("opencode").get<number>("catalogCacheMinutes", 5)) * 60_000;
    if (!catalog.isFresh(mode, maxAge, catalogScope(mode, credential, this.freeOnly()))) {
      const controller = new AbortController();
      const listener = token.onCancellationRequested(() => controller.abort());
      try { await catalog.refreshSafely(mode, credential, this.freeOnly(), controller.signal); }
      catch (error) { this.output.appendLine(`[models] ${messageOf(error)}`); }
      finally { listener.dispose(); }
    }
    return catalog.list(mode).map((model) => this.toInformation(model, mode, credentialId, profile));
  }

  async provideLanguageModelChatResponse(
    information: OpenCodeModelInformation,
    messages: readonly vscode.LanguageModelChatRequestMessage[],
    options: vscode.ProvideLanguageModelChatResponseOptions,
    progress: vscode.Progress<vscode.LanguageModelResponsePart2>,
    token: vscode.CancellationToken,
  ): Promise<void> {
    const mode = information.mode;
    this.lastUsedCredentialId = information.credentialId;
    this.activeCredentialId = information.credentialId;
    let credential = information.mode === "console"
      ? await this.auth.getCredential("console", false, information.profile ?? DEFAULT_CONSOLE_PROFILE)
      : this.credentials.get(information.credentialId);
    if (!credential) throw new Error(`The credential for this OpenCode provider entry is unavailable. Update it in Manage Language Models.`);
    this.credentials.set(information.credentialId, credential);
    const catalog = this.catalogFor(information.credentialId);
    const model = catalog.get(mode, information.catalogId) ?? catalog.list(mode).find((item) => item.rawModelId === information.rawModelId);
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
            credential = await this.auth.getCredential(mode, true, information.profile ?? DEFAULT_CONSOLE_PROFILE);
            if (!credential) throw new Error("OpenCode credentials expired; sign in again");
            this.credentials.set(information.credentialId, credential);
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
              if (usage) this.setUsage(usage, information.credentialId);
            }
            if (token.isCancellationRequested) return;
          }
          for (const event of parser.finish()) {
            sawOutput ||= Boolean(event.text || event.reasoning || event.toolCalls?.length);
            const usage = reportStreamEvent(event, progress, model.rawModelId, (name) => originalToolName(name, options.tools));
            if (usage) this.setUsage(usage, information.credentialId);
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

  private toInformation(
    model: OpenCodeModel,
    mode: OpenCodeMode,
    credentialId: string,
    profile?: string,
  ): OpenCodeModelInformation {
    const config = vscode.workspace.getConfiguration("opencode");
    const family = thinkingFamilyForModel(model);
    const defaultEffort = family ? configuredValue<ReasoningEffort>(config, `thinking.${family}`) : config.get<ReasoningEffort>("reasoningEffort", "high");
    const defaultBudget = family === "qwen" ? config.get<string>("thinking.qwenBudget", "auto") : undefined;
    const configurationSchema = modelConfigurationSchema(model, defaultEffort, defaultBudget);
    return {
      id: qualifiedModelId(credentialId, model.id),
      name: model.name,
      version: "3-provider-groups",
      family: model.family,
      ...advertisedModelLimits(model),
      capabilities: { imageInput: model.imageInput, toolCalling: model.toolCalling },
      ...(configurationSchema ? { configurationSchema } : {}),
      isUserSelectable: true,
      isBYOK: true,
      requiresAuthorization: { label: `OpenCode ${this.mode === "console" ? `Console (${profile ?? DEFAULT_CONSOLE_PROFILE})` : this.mode === "go" ? "Go" : "Zen"}` },
      rawModelId: model.rawModelId,
      catalogId: model.id,
      mode,
      credentialId,
      ...(profile ? { profile } : {}),
    };
  }

  private freeOnly(): boolean { return vscode.workspace.getConfiguration("opencode").get("freeOnly", true); }
  private catalogFor(credentialId: string): ModelCatalog {
    let catalog = this.catalogs.get(credentialId);
    if (!catalog) {
      catalog = this.catalogFactory();
      this.catalogs.set(credentialId, catalog);
    }
    return catalog;
  }

  private async entryFromConfiguration(configuration: Readonly<Record<string, unknown>>): Promise<{
    credential: Credential;
    credentialId: string;
    profile?: string;
  } | undefined> {
    if (this.mode === "console") {
      const profile = consoleProfileFromConfiguration(configuration);
      const credential = await this.auth.getCredential("console", false, profile);
      return credential ? { credential, credentialId: `profile-${profile}`, profile } : undefined;
    }
    const apiKey = typeof configuration.apiKey === "string" ? configuration.apiKey.trim() : "";
    if (!apiKey) return undefined;
    const legacy = await this.auth.getCredential(this.mode);
    return {
      credential: { mode: this.mode, token: apiKey },
      credentialId: legacy?.token === apiKey
        ? "legacy"
        : apiKeyCredentialId(apiKey),
    };
  }

  async managementCredentials(): Promise<readonly ManagementCredentialOption[]> {
    if (this.mode === "console") return [];
    return managementCredentialOptions(
      this.credentials.keys(),
      Boolean(await this.auth.getCredential(this.mode)),
    );
  }

  selectManagementCredential(credentialId: string): void {
    if (this.mode === "console") return;
    if (credentialId !== "legacy" && !this.credentials.has(credentialId)) {
      throw new Error(`OpenCode ${this.mode === "go" ? "Go" : "Zen"} provider entry ${credentialId} is unavailable`);
    }
    this.activeCredentialId = credentialId;
  }

  private scopeFor(credentialId: string): string { return `${this.mode}:${credentialId}`; }

  private setUsage(usage: OpenCodeUsageSnapshot, credentialId: string): void {
    const scope = this.scopeFor(credentialId);
    this.setUsageSnapshot(scope, recordRequestUsage(this.usageByScope.get(scope) ?? {}, usage));
  }

  private setUsageSnapshot(scope: string, usage: OpenCodeUsageSnapshot): void {
    this.usageByScope.set(scope, usage);
    this.usageEmitter.fire({ scope, usage });
  }

  async testConnection(): Promise<{ model: string; text: string }> {
    const models = await this.refreshModels();
    const model = models[0];
    if (!model) throw new Error(`OpenCode ${this.mode} registered no usable models`);
    const information = this.toInformation(
      model,
      this.mode,
      this.activeCredentialId,
      this.mode === "console" ? this.activeProfile : undefined,
    );
    let text = "";
    const cancellation = new vscode.CancellationTokenSource();
    try {
      await this.provideLanguageModelChatResponse(
        information,
        [vscode.LanguageModelChatMessage.User("Reply with OK.")],
        { toolMode: vscode.LanguageModelChatToolMode.Auto, requestInitiator: "opencodeCopilot.testConnection" },
        { report: (part) => { if (part instanceof vscode.LanguageModelTextPart) text += part.value; } },
        cancellation.token,
      );
    } finally {
      cancellation.dispose();
    }
    if (!text.trim()) throw new Error(`${model.name} returned no text`);
    return { model: model.name, text: text.trim() };
  }
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

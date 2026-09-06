/** Engine contracts for the inline completion pipeline. */

export interface CompletionContext {
  readonly prefix: string;
  readonly suffix: string;
  readonly modelId: string;
  readonly maxTokens: number;
}

export interface CompletionResult {
  readonly text?: string;
  readonly durationMs: number;
}

export interface CompletionEngine {
  readonly id: string;
  complete(context: CompletionContext, signal: AbortSignal): Promise<CompletionResult>;
}

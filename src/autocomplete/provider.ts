/**
 * InlineCompletionItemProvider for ghost-text suggestions.
 *
 * Strictly opt-in via `opencode.inlineSuggestions`. The provider debounces
 * typing, aborts superseded in-flight requests, excludes the Copilot Chat
 * prompt box unless explicitly enabled, and returns a single completion item
 * whose insertText is the model's suggestion.
 */

import * as vscode from "vscode";
import { buildCompletionWindow, isChatInputDocument, isCompletionDocument } from "./context";
import { Debouncer } from "./throttle";
import type { CompletionContext, CompletionEngine } from "./types";

export interface InlineCompletionProviderOptions {
  readonly engine: CompletionEngine;
  /** Called once when a ghost-text suggestion is actually returned. */
  onSuggestion?: (text: string, position: vscode.Position, document: vscode.TextDocument) => void;
  /** Whether suggestions are currently enabled (config-driven). */
  isEnabled: () => boolean;
  /** The model id used for suggestions (config-driven). */
  resolveModelId: () => string;
  /** Whether suggestions are allowed inside the chat prompt box (opt-in). */
  resolveChatInputEnabled: () => boolean;
  resolveDebounceMs: () => number;
  resolveMaxTokens: () => number;
  resolvePrefixLines: () => number;
  resolveSuffixChars: () => number;
}

export class OpenCodeInlineCompletionProvider implements vscode.InlineCompletionItemProvider {
  private readonly debouncer: Debouncer;

  constructor(private readonly options: InlineCompletionProviderOptions) {
    this.debouncer = new Debouncer(options.resolveDebounceMs());
  }

  provideInlineCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
    _context: vscode.InlineCompletionContext,
    token: vscode.CancellationToken,
  ): Promise<vscode.InlineCompletionItem[] | undefined> {
    if (!this.options.isEnabled()) return Promise.resolve(undefined);

    // Only offer completions on real editable code surfaces. The Copilot Chat
    // prompt box is a virtual chatSessionInput document — excluded by default
    // (users can opt in via opencode.inlineSuggestionsChatInput).
    if (!isCompletionDocument(document.uri) && !(isChatInputDocument(document.uri) && this.options.resolveChatInputEnabled())) {
      return Promise.resolve(undefined);
    }

    // Keep the debounce window live: config changes apply on the next keystroke.
    const debounceMs = this.options.resolveDebounceMs();
    if (debounceMs !== this.debouncer.delayMs) this.debouncer.delayMs = debounceMs;

    const text = document.getText();
    const offset = document.offsetAt(position);
    const { prefix, suffix } = buildCompletionWindow(text, offset, {
      prefixLines: this.options.resolvePrefixLines(),
      suffixChars: this.options.resolveSuffixChars(),
    });
    if (!prefix.trim()) return Promise.resolve(undefined);
    const modelId = this.options.resolveModelId();
    if (!modelId) return Promise.resolve(undefined);

    return new Promise<vscode.InlineCompletionItem[] | undefined>((resolve) => {
      const finish = (items: vscode.InlineCompletionItem[] | undefined): void => {
        if (token.isCancellationRequested) {
          resolve(undefined);
          return;
        }
        resolve(items);
      };

      const tokenSubscription = token.onCancellationRequested(() => {
        // Do NOT cancel the shared debouncer: VS Code may cancel this request
        // after a newer keystroke already scheduled its own debounced run.
        // The debouncer aborts superseded runs itself; here we only resolve
        // this request as "no suggestion".
        finish(undefined);
      });

      this.debouncer.debounce(async (signal) => {
        tokenSubscription.dispose();
        if (signal.aborted || token.isCancellationRequested) {
          finish(undefined);
          return;
        }
        try {
          const request: CompletionContext = {
            prefix,
            suffix,
            modelId,
            maxTokens: this.options.resolveMaxTokens(),
          };
          const result = await this.options.engine.complete(request, signal);
          if (!result.text || token.isCancellationRequested || signal.aborted) {
            finish(undefined);
            return;
          }
          this.options.onSuggestion?.(result.text, position, document);
          finish([new vscode.InlineCompletionItem(result.text, new vscode.Range(position, position))]);
        } catch {
          // Completion failures are quiet by design; ghost text simply stays away.
          finish(undefined);
        }
      });
    });
  }

  dispose(): void {
    this.debouncer.dispose();
  }
}
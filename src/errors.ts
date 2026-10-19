export function messageOf(error: unknown): string {
  if (error instanceof Error) {
    if (error.name === "AbortError") return "Request cancelled or timed out";
    return error.message;
  }
  return String(error);
}

export async function responseError(prefix: string, response: Response): Promise<Error> {
  let detail = "";
  try {
    const payload = await response.clone().json() as { error?: unknown; message?: unknown };
    const value = payload.error ?? payload.message;
    if (typeof value === "string") detail = value;
    else if (value && typeof value === "object" && "message" in value && typeof value.message === "string") detail = value.message;
  } catch {
    try { detail = (await response.clone().text()).slice(0, 300); } catch { /* keep the status */ }
  }
  return new Error(`${prefix} (${response.status})${detail ? `: ${detail}` : ""}`);
}

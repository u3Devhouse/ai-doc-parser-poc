export async function readJsonResponse(response: Response): Promise<{
  payload: Record<string, unknown> | null;
  parseError: string | null;
}> {
  const text = await response.text();
  if (!text.trim()) {
    return {
      payload: null,
      parseError: response.ok ? null : `Server returned ${response.status} with an empty body`,
    };
  }

  try {
    const parsed = JSON.parse(text) as Record<string, unknown>;
    return { payload: parsed, parseError: null };
  } catch {
    return {
      payload: null,
      parseError: `Server returned non-JSON (${response.status})`,
    };
  }
}

export function apiErrorMessage(payload: Record<string, unknown> | null, fallback: string): string {
  if (!payload) {
    return fallback;
  }
  const error = typeof payload.error === "string" ? payload.error : "request_failed";
  const message = typeof payload.message === "string" ? payload.message : fallback;
  return `${error}: ${message}`;
}

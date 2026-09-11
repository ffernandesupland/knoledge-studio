import { tracked } from "../autonomous/telemetry";
import type { RaHttpError } from "./errors";

export interface RaRequestOptions {
  method?: "GET" | "POST" | "DELETE";
  path: string;
  query?: Record<string, string | number | boolean | undefined | null>;
  headers?: Record<string, string>;
  body?: unknown;
  bodyKind?: "json" | "form";
  timeoutMs?: number;
  /** Retries apply to 5xx and network faults only, never to 4xx. */
  retries?: number;
}

export class RaError extends Error implements RaHttpError {
  readonly status: number;
  readonly url: string;
  readonly responseBody: string;

  constructor(message: string, status: number, url: string, responseBody: string) {
    super(message);
    this.name = "RaError";
    this.status = status;
    this.url = url;
    this.responseBody = responseBody;
  }
}

function buildQuery(query: RaRequestOptions["query"]): string {
  if (!query) return "";
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null || v === "") continue;
    p.set(k, String(v));
  }
  const s = p.toString();
  return s ? `?${s}` : "";
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function raFetch(
  baseUrl: string,
  opts: RaRequestOptions,
): Promise<{ status: number; text: string }> {
  const url = `${baseUrl}${opts.path}${buildQuery(opts.query)}`;
  const retries = opts.method && opts.method !== "GET" ? 0 : (opts.retries ?? 2);

  const headers: Record<string, string> = { accept: "application/json", ...opts.headers };
  let body: string | undefined;

  if (opts.body !== undefined) {
    if (opts.bodyKind === "form") {
      const p = new URLSearchParams();
      for (const [k, v] of Object.entries(opts.body as Record<string, unknown>)) {
        if (v === undefined || v === null) continue;
        p.set(k, String(v));
      }
      body = p.toString();
      headers["content-type"] = "application/x-www-form-urlencoded";
    } else {
      body = JSON.stringify(opts.body);
      headers["content-type"] = "application/json";
    }
  }

  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const { status, ok, text } = await tracked("tool", `HTTP attempt ${attempt + 1}: ${opts.path}`, { method: opts.method ?? "GET", path: opts.path }, async () => {
        const res = await fetch(url, {
          method: opts.method ?? "GET",
          headers,
          body,
          signal: AbortSignal.timeout(opts.timeoutMs ?? 30_000),
        });
        return { status: res.status, ok: res.ok, text: await res.text() };
      }, false, value => opts.path === "/api/rest/login" ? { status: value.status, ok: value.ok, text: "Authentication response omitted" } : value);

      if (status >= 500 && attempt < retries) {
        await sleep(2 ** attempt * 300);
        continue;
      }
      if (!ok) {
        // RA puts the actual reason in the body; a bare status code is not diagnosable.
        const detail = (opts.path === "/api/rest/login" || text.trim().startsWith("<")) ? "" : text.trim().slice(0, 200);
        throw new RaError(
          status >= 500 && (!opts.method || opts.method === "GET")
            ? `RightAnswers is temporarily unavailable (HTTP ${status}) while ${opts.path === "/api/rest/templates" ? "loading article templates" : "reading knowledge-base data"}. Please try again shortly.`
            : `RA ${status} on ${opts.path}${detail ? `: ${detail}` : ""}`,
          status,
          url,
          text.slice(0, 500),
        );
      }
      return { status: status, text };
    } catch (err) {
      lastErr = err;
      if (err instanceof RaError) throw err;
      if (attempt >= retries) break;
      await sleep(2 ** attempt * 300);
    }
  }
  throw new RaError(
    `RA request failed: ${opts.path} (${(lastErr as Error)?.message ?? "unknown"})`,
    0,
    url,
    "",
  );
}

export function parseJson<T>(text: string, path: string): T {
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new RaError(`Non-JSON response from ${path}`, 0, path, text.slice(0, 300));
  }
}

import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import type { LookupFunction } from "node:net";
import { lookup } from "node:dns/promises";
import { checkUrlShape, isBlockedAddress } from "./ssrf";

export interface FetchedPage {
  url: string;
  title: string;
  text: string;
  bytes: number;
}

const MAX_BYTES = 2 * 1024 * 1024;
const MAX_REDIRECTS = 3;
const TIMEOUT_MS = 15_000;

const TEXTUAL = /^(text\/|application\/(xhtml\+xml|json|xml))/;

/**
 * Resolve-then-validate. Checking the hostname alone is not enough: an attacker controls DNS
 * for their own domain and can point it at 169.254.169.254.
 */
async function publicAddresses(hostname: string): Promise<{ address: string; family: number }[]> {
  let records: { address: string; family: number }[];
  try {
    records = await lookup(hostname.replace(/^\[|\]$/g, ""), { all: true });
  } catch {
    throw new Error(`Could not resolve ${hostname}`);
  }
  if (!records.length) throw new Error(`Could not resolve ${hostname}`);

  for (const r of records) {
    if (isBlockedAddress(r.address, r.family === 6 ? 6 : 4)) {
      throw new Error(`${hostname} resolves to a blocked address (${r.address})`);
    }
  }
  return records;
}

/** Reuse the checked addresses at connection time; never resolve the hostname twice. */
export function pinnedLookup(records: { address: string; family: number }[]): LookupFunction {
  return (_host, options, callback) => {
    if (options.all) callback(null, records);
    else callback(null, records[0].address, records[0].family);
  };
}

async function fetchPinned(url: URL, records: { address: string; family: number }[]) {
  return new Promise<{ status: number; headers: Record<string, string | string[] | undefined>; body: Buffer }>((resolve, reject) => {
    const transport = url.protocol === "https:" ? httpsRequest : httpRequest;
    const req = transport(url, { lookup: pinnedLookup(records), agent: false, signal: AbortSignal.timeout(TIMEOUT_MS), headers: { accept: "text/html,text/plain;q=0.9,*/*;q=0.1", "accept-encoding": "identity", "user-agent": "KnowledgeStudio/0.1" } }, (res) => {
      res.on("error", reject);
      const status = res.statusCode ?? 0;
      if (status >= 300 && status < 400) { resolve({ status, headers: res.headers, body: Buffer.alloc(0) }); res.destroy(); return; }
      if (Number(res.headers["content-length"] ?? 0) > MAX_BYTES) { res.destroy(new Error("Page is larger than the 2 MB limit")); return; }
      const chunks: Buffer[] = []; let bytes = 0;
      res.on("data", (chunk: Buffer) => { bytes += chunk.length; if (bytes > MAX_BYTES) { res.destroy(new Error("Page is larger than the 2 MB limit")); return; } chunks.push(chunk); });
      res.on("end", () => resolve({ status, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on("error", reject); req.end();
  });
}

function stripHtml(html: string): { title: string; text: string } {
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1]?.trim() ?? "";
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<\/(p|div|li|h[1-6]|tr|section|article)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n\s*\n+/g, "\n\n")
    .trim();
  return { title, text };
}

/**
 * Fetches a user-supplied URL with SSRF protection: scheme allowlist, DNS resolve-then-validate,
 * manual redirect handling that re-validates each hop, a size cap and a timeout.
 */
export async function fetchUrlSafely(raw: string): Promise<FetchedPage> {
  let current = raw;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const shape = checkUrlShape(current);
    if (!shape.ok || !shape.url) throw new Error(shape.reason ?? "Invalid URL");
    const records = await publicAddresses(shape.url.hostname);
    const response = await fetchPinned(shape.url, records);

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.location as string | undefined;
      if (!location) throw new Error(`Redirect from ${current} had no Location header`);
      // Re-validated on the next iteration, so a redirect cannot smuggle us into private space.
      current = new URL(location, shape.url).toString();
      continue;
    }

    if (response.status < 200 || response.status >= 300) throw new Error(`Fetch failed: HTTP ${response.status}`);

    const contentType = String(response.headers["content-type"] ?? "");
    if (!TEXTUAL.test(contentType)) {
      throw new Error(`Unsupported content type: ${contentType || "unknown"}`);
    }

    const bytes = response.body.length;
    const body = response.body.toString("utf8");
    const isHtml = /html|xml/.test(contentType);
    const { title, text } = isHtml ? stripHtml(body) : { title: "", text: body.trim() };
    if (!text) throw new Error("No readable text found at that URL");

    return { url: shape.url.toString(), title, text, bytes };
  }

  throw new Error(`Too many redirects (limit ${MAX_REDIRECTS})`);
}

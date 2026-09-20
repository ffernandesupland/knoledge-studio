import { marked } from "marked";
import sanitizeHtml from "sanitize-html";

/** Handles a legacy model habit without ever treating arbitrary JSON as instructions. */
export function userFacingAssistantContent(value: string): string {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed) && Object.keys(parsed).length === 1 && typeof (parsed as { message?: unknown }).message === "string") {
      return (parsed as { message: string }).message;
    }
  } catch {
    // Normal Markdown is not JSON.
  }
  return value;
}

/** Markdown comes from a model that has read untrusted KB content, so sanitize before rendering. */
export function renderAssistantMarkdown(value: string): string {
  const html = marked.parse(value, { async: false, gfm: true });
  return sanitizeHtml(html, {
    allowedTags: ["p", "br", "h1", "h2", "h3", "h4", "h5", "h6", "strong", "em", "del", "ul", "ol", "li", "blockquote", "code", "pre", "hr", "a", "table", "thead", "tbody", "tr", "th", "td"],
    allowedAttributes: { a: ["href", "title"] },
    allowedSchemes: ["http", "https", "mailto"],
  });
}

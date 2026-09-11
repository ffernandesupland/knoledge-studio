import { marked } from "marked";
import sanitizeHtml from "sanitize-html";
import type { WSDisplayField, WSTemplate } from "../ra/types";

export function bodyField(template: WSTemplate) {
  const names = ["solution", "resolution", "answer", "body", "content", "definition", "details", "description"];
  return names.map((name) => template.fields.find((f) => f.fieldName.toLowerCase() === name)).find(Boolean);
}

export function hasContent(value: string): boolean {
  return !!sanitizeHtml(value, { allowedTags: [], allowedAttributes: {} }).replace(/&nbsp;|&#160;/g, " ").trim();
}

export function textAsHtml(text: string): string {
  return `<p>${text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\n/g, "<br>")}</p>`;
}

export function draftFields(text: string, template: WSTemplate): WSDisplayField[] {
  const body = bodyField(template);
  if (!body) throw new Error(`Template ${template.templateName} has no recognized answer field. Enable restructuring or choose a body template.`);
  return template.fields.map((f) => ({ fieldName: f.fieldName, fieldValue: f === body ? marked.parse(text, { async: false }).trim() : "" }));
}

/** Exact template contract, then allowlisted HTML. Never silently drop model fields. */
export function validateFields(fields: WSDisplayField[], template: WSTemplate): WSDisplayField[] {
  const names = new Set(fields.map((f) => f.fieldName));
  if (names.size !== fields.length || fields.length !== template.fields.length || template.fields.some((f) => !names.has(f.fieldName))) {
    throw new Error(`Content does not match all fields of ${template.templateName}; edit the fields before retrying.`);
  }
  const clean = template.fields.map((f) => ({
    fieldName: f.fieldName,
    fieldValue: sanitizeHtml(toHtml(fields.find((v) => v.fieldName === f.fieldName)!.fieldValue), {
      allowedTags: ["p", "br", "ol", "ul", "li", "strong", "em", "b", "i", "code", "pre", "blockquote", "h2", "h3", "h4", "table", "thead", "tbody", "tr", "th", "td", "a"],
      allowedAttributes: { a: ["href", "title"] }, allowedSchemes: ["http", "https", "mailto"],
    }),
  }));
  for (const f of template.fields) {
    if (f.required && !hasContent(clean.find((v) => v.fieldName === f.fieldName)!.fieldValue)) {
      throw new Error(`Required field “${f.fieldName}” needs source-supported content.`);
    }
  }
  if (!clean.some((f) => hasContent(f.fieldValue))) throw new Error(`Template “${template.templateName}” has no populated fields. Map the saved source into this template or choose a suitable template before submitting.`);
  return clean;
}

/** Convert plain/Markdown responses while leaving authored HTML structure intact. */
function toHtml(value: string): string {
  if (!value.trim()) return "";
  if (!/<\/?[a-z][^>]*>/i.test(value)) return marked.parse(value, { async: false });
  const prose = value.replace(/<(pre|code)\b[^>]*>[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>|<\/(?:p|div|h[1-6]|li)>/gi, "\n").replace(/<[^>]+>/g, "");
  if (/(^|\n)\s*(?:#{1,6}\s|```|[-*]\s|\d+\.\s)|\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\(https?:/m.test(prose)) {
    throw new Error("Content contains Markdown inside HTML. Convert headings, lists, links and code to HTML before submitting.");
  }
  return value;
}

/** Metadata is plain text; only template body fields accept HTML. */
export function validateSummary(summary: string): void {
  if (/<\/?[a-z][^>]*>/i.test(summary)) {
    throw new Error("Summary must be plain text. Remove HTML tags from the summary; keep HTML formatting in the template content fields.");
  }
}

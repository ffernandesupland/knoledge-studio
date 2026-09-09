export interface ArticleDocument {
  title: string;
  summary?: string;
  keywords?: string[];
  templateName?: string;
  fields?: { fieldName: string; fieldValue: string }[];
}
const escape = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
/** Metadata is plain text; field HTML is rendered only in the isolated preview frame. */
export function articleDocumentBody(article: ArticleDocument): string {
  return `<h1>${escape(article.title)}</h1><p><strong>Template:</strong> ${escape(article.templateName ?? "Not recorded")}</p>
<section><h2>Summary</h2><p>${escape(article.summary || "Not provided")}</p></section>
<section><h2>Keywords</h2><p>${escape(article.keywords?.join(", ") || "Not provided")}</p></section>
${(article.fields ?? []).map((f) => `<section><h2>${escape(f.fieldName)}</h2>${f.fieldValue.trim() || '<p class="empty">No content in this field.</p>'}</section>`).join("\n")}`;
}

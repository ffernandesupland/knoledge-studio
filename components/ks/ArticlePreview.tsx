"use client";

import { articleDocumentBody, type ArticleDocument } from "@/lib/ks/article-document";

/** No scripts, navigation, forms or remote assets; article markup stays outside the app DOM. */
export function ArticlePreview({ body, article }: { body?: string; article?: ArticleDocument }) {
  const content = article ? articleDocumentBody(article) : body;
  const document = `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><style>body{font:14px/1.6 system-ui;color:#243549;padding:16px;overflow-wrap:anywhere}h1{font-size:20px}h2{font-size:16px}section{border-top:1px solid #ddd;margin-top:20px;padding-top:8px}.empty{color:#687585}pre{white-space:pre-wrap}table{border-collapse:collapse}td,th{border:1px solid #ddd;padding:8px}</style></head><body>${content || "No content yet."}</body></html>`;
  return <iframe title="Article content preview" sandbox="" srcDoc={document} style={{ width: "100%", height: 420, border: 0, background: "white" }} />;
}

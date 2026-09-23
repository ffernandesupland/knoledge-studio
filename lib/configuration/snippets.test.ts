import { expect, it } from "vitest";
import { sanitizeSnippetHtml } from "./snippets";

it("keeps safe structure and removes executable snippet markup", () => {
  expect(sanitizeSnippetHtml('<section class="note"><h3>Note</h3><p>Use the supported procedure.</p><script>alert(1)</script><a href="javascript:alert(1)">Unsafe</a></section>')).toBe('<section class="note"><h3>Note</h3><p>Use the supported procedure.</p><a>Unsafe</a></section>');
  expect(() => sanitizeSnippetHtml("<script>alert(1)</script>")).toThrow("readable content");
});

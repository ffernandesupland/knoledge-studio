import { describe, expect, it } from "vitest";
import { bodyField, draftFields, validateFields } from "./content";
const template = { templateName: "Error (RA)", templateType: "standard", kbPrefix: "", fields: ["Error Message", "Cause", "Solution"].map((fieldName) => ({ fieldName, required: fieldName === "Solution", searchable: true, description: "" })) };
describe("template and HTML validation", () => {
  it("converts Markdown headings, lists and code before writing", () => {
    const values = draftFields("## Setup\n\n- Run `tool`\n- Check **status**", template);
    const html = validateFields(values, template)[2].fieldValue;
    expect(html).toContain("<h2>Setup</h2>"); expect(html).toContain("<ul>");
    expect(html).toContain("<code>tool</code>"); expect(html).not.toContain("##");
  });
  it("blocks Markdown disguised as an HTML paragraph", () => {
    const values = draftFields("Answer", template); values[2].fieldValue = "<p>## Setup<br>- Do this</p>";
    expect(() => validateFields(values, template)).toThrow("Markdown inside HTML");
  });
  it("uses semantic answer fields rather than template order", () => {
    expect(bodyField(template)?.fieldName).toBe("Solution");
    expect(draftFields("An answer", template)[2].fieldValue).toBe("<p>An answer</p>");
  });
  it("rejects missing and duplicate fields", () => {
    expect(() => validateFields([{ fieldName: "Solution", fieldValue: "Answer" }], template)).toThrow("all fields");
    expect(() => validateFields(Array(3).fill({ fieldName: "Solution", fieldValue: "Answer" }), template)).toThrow("all fields");
  });
  it("removes executable markup and preserves supported formatting", () => {
    const fields = draftFields("Answer", template);
    fields[2].fieldValue = '<ol><li onclick="steal()">Answer</li></ol><script>alert(1)</script><a href="javascript:alert(1)">bad link</a>';
    const clean = validateFields(fields, template)[2].fieldValue;
    expect(clean).toContain("<ol><li>Answer</li></ol>");
    expect(clean).not.toMatch(/script|onclick|javascript/);
  });
  it("does not permit visually empty required fields", () => {
    const fields = draftFields("Answer", template); fields[2].fieldValue = "<p>&nbsp;</p>";
    expect(() => validateFields(fields, template)).toThrow("Required field");
  });
});

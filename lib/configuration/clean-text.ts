/**
 * Normalizes extracted configuration material before it is persisted or shown to
 * a model. This deliberately preserves wording and paragraph boundaries; it
 * only repairs common UTF-8-as-Latin-1 mojibake, invisible controls, and
 * whitespace noise introduced by PDF/DOCX extractors.
 */
function repairMojibake(value: string): string {
  return value.replace(/(?:Ã[\u0080-\u00BF]|Â[\u00A0\s]|â[\u0080-\u00BF]{2})/g, candidate => {
    const repaired = Buffer.from(candidate, "latin1").toString("utf8");
    return repaired.includes("�") ? candidate : repaired;
  });
}

export function cleanConfigurationText(value: string): string {
  return repairMojibake(value)
    .normalize("NFC")
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u200B-\u200D\uFEFF]/g, "")
    .replace(/[\u00A0\t ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

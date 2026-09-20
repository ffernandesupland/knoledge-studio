import { buildUserPrompt, wrapUntrusted, type UntrustedBlock } from "./prompt";
import { getImage } from "../ingest/image-store";
import { getAgentFile } from "../agent/file-store";

type Part = { type: "input_text"; text: string } | { type: "input_image"; image_url: string; detail: "high" } | { type: "input_file"; filename: string; file_data: string };
export async function orderedModelContent(originals: UntrustedBlock[], blocks: UntrustedBlock[], task: string, resolveImage = async (id: string) => {
  const image = await getImage(id);
  return `data:${image.mime};base64,${image.bytes.toString("base64")}`;
}): Promise<Part[]> {
  const parts: Part[] = [];
  for (const block of originals) {
    parts.push({ type: "input_text", text: wrapUntrusted([block]) });
    if (block.imageId) parts.push({ type: "input_image", image_url: await resolveImage(block.imageId), detail: "high" });
    if (block.fileId) {
      if (!block.fileOwner) throw new Error("Original file ownership is missing. Reattach the document before running analysis.");
      const file = await getAgentFile(block.fileId, block.fileOwner);
      parts.push({ type: "input_file", filename: file.name, file_data: `data:${file.mime};base64,${file.bytes.toString("base64")}` });
    }
  }
  parts.push({ type: "input_text", text: buildUserPrompt(task, blocks) });
  return parts;
}

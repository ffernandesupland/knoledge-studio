import { buildUserPrompt, wrapUntrusted, type UntrustedBlock } from "./prompt";
import { getImage } from "../ingest/image-store";

type Part = { type: "input_text"; text: string } | { type: "input_image"; image_url: string; detail: "high" };
export async function orderedModelContent(originals: UntrustedBlock[], blocks: UntrustedBlock[], task: string, resolveImage = async (id: string) => {
  const image = await getImage(id);
  return `data:${image.mime};base64,${image.bytes.toString("base64")}`;
}): Promise<Part[]> {
  const parts: Part[] = [];
  for (const block of originals) {
    parts.push({ type: "input_text", text: wrapUntrusted([block]) });
    if (block.imageId) parts.push({ type: "input_image", image_url: await resolveImage(block.imageId), detail: "high" });
  }
  parts.push({ type: "input_text", text: buildUserPrompt(task, blocks) });
  return parts;
}

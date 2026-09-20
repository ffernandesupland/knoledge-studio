export type SourceBlock = { id: string; type: "text"; text: string } | { id: string; type: "attachment"; attachmentId: string };
export interface SourceAttachment { id?: string; label: string; text: string; kind?: "file" | "url"; imageId?: string; fileId?: string; /** Server-assigned; never accepted from the browser. */ fileOwner?: string; meta?: string }
export interface SourceInput { text: string; attachments?: SourceAttachment[]; content?: SourceBlock[] }

export function legacyDocument(text: string, attachments: SourceAttachment[]): SourceBlock[] {
  return [{ id: "text-start", type: "text", text }, ...attachments.flatMap((a, i): SourceBlock[] => [
    { id: `source-${i}`, type: "attachment", attachmentId: a.id ?? `legacy-${i}` },
    { id: `text-${i}`, type: "text", text: "" },
  ])];
}

export function insertSources(blocks: SourceBlock[], blockId: string, start: number, end: number, ids: string[], newId: () => string): SourceBlock[] {
  const index = blocks.findIndex(b => b.id === blockId && b.type === "text");
  const target = blocks[index];
  if (!target || target.type !== "text") return blocks;
  return [...blocks.slice(0, index), { ...target, text: target.text.slice(0, start) },
    ...ids.flatMap((id, i): SourceBlock[] => [{ id: newId(), type: "attachment", attachmentId: id }, { id: newId(), type: "text", text: i === ids.length - 1 ? target.text.slice(end) : "" }]), ...blocks.slice(index + 1)];
}

export function orderedSources(input: SourceInput): { label: string; content: string; imageId?: string; fileId?: string; fileOwner?: string }[] {
  if (!input.content) return [
    ...(input.text.trim() ? [{ label: "pasted text", content: input.text }] : []),
    ...(input.attachments ?? []).map(a => ({ label: a.label, content: a.text, imageId: a.imageId, fileId: a.fileId, fileOwner: a.fileOwner })),
  ];
  const byId = new Map((input.attachments ?? []).map(a => [a.id, a]));
  return input.content.flatMap((b, i) => {
    if (b.type === "text") return b.text.trim() ? [{ label: `Text ${i + 1}`, content: b.text }] : [];
    const a = byId.get(b.attachmentId);
    if (!a) throw new Error("An editor source is missing. Wait for uploads or remove the failed source.");
    return [{ label: a.label, content: a.text || `Original image: ${a.label}`, imageId: a.imageId, fileId: a.fileId, fileOwner: a.fileOwner }];
  });
}

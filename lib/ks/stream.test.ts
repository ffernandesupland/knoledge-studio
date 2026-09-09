import { describe, expect, it } from "vitest";
import { readNdjson } from "./stream";
const stream = (chunks: string[]) => new Response(new ReadableStream({ start(c) { for (const part of chunks) c.enqueue(new TextEncoder().encode(part)); c.close(); } }));
describe("NDJSON stream recovery", () => {
  it("handles split JSON and a last line without newline", async () => {
    const messages: unknown[] = [];
    await readNdjson(stream(['{"type":"pro', 'gress"}\n{"type":"result"}']), (m) => messages.push(m));
    expect(messages).toEqual([{ type: "progress" }, { type: "result" }]);
  });
  it("reports early EOF instead of remaining in running state", async () => {
    await expect(readNdjson(stream(['{"type":"progress"}\n']), () => undefined)).rejects.toThrow("before completion");
  });
  it("reports stream read failures", async () => {
    const response = new Response(new ReadableStream({ start(c) { c.error(new Error("disconnected")); } }));
    await expect(readNdjson(response, () => undefined)).rejects.toThrow("disconnected");
  });
  it("surfaces HTTP validation errors", async () => {
    await expect(readNdjson(Response.json({ error: "Invalid plan" }, { status: 400 }), () => undefined)).rejects.toThrow("Invalid plan");
  });
});

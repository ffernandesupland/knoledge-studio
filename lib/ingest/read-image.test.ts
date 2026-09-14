import { beforeEach, describe, expect, it, vi } from "vitest";
import { parseDocument, classify, MAX_UPLOAD_BYTES } from "./parse-document";
import { imageMime } from "./read-image";
import { runOperation } from "../llm/client";
vi.mock("../llm/client", () => ({ runOperation: vi.fn() }));
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=", "base64");
beforeEach(() => vi.clearAllMocks());
describe("image ingestion", () => {
  it.each([["a.png", "image/png"], ["a.jpeg", "image/jpeg"], ["a.jpg", ""], ["a.webp", "application/octet-stream"]])("accepts %s", (name, mime) => {
    expect(classify(name, mime)).toBe("image");
  });
  it("passes actual image bytes to vision and returns source evidence", async () => {
    vi.mocked(runOperation).mockResolvedValue({ data: { text: "Visible text\r\nDiagram evidence" }, model: "test", inputTokens: 1, outputTokens: 1, costUsd: 0 });
    const result = await parseDocument("screen.png", "image/png", png);
    expect(result).toMatchObject({ kind: "image", text: "Visible text\nDiagram evidence" });
    expect(runOperation).toHaveBeenCalledWith(expect.objectContaining({ images: [`data:image/png;base64,${png.toString("base64")}`] }));
  });
  it("rejects invalid image bytes before calling the model", async () => {
    await expect(parseDocument("fake.png", "image/png", Buffer.from("not an image"))).rejects.toThrow("Invalid image");
    expect(runOperation).not.toHaveBeenCalled();
  });
  it("detects JPEG and WebP bytes", () => {
    expect(imageMime(Buffer.from([255,216,255,224]))).toBe("image/jpeg");
    expect(imageMime(Buffer.from("RIFF0000WEBP"))).toBe("image/webp");
  });
  it("rejects oversized images", async () => {
    await expect(parseDocument("big.png", "image/png", Buffer.alloc(MAX_UPLOAD_BYTES + 1))).rejects.toThrow("4 MB");
    expect(runOperation).not.toHaveBeenCalled();
  });
  it("does not mark empty or refused extraction as a ready source", async () => {
    vi.mocked(runOperation).mockResolvedValue({ data: { text: " " }, model: "test", inputTokens: 1, outputTokens: 1, costUsd: 0 });
    await expect(parseDocument("empty.png", "image/png", png)).rejects.toThrow("No readable text");
    vi.mocked(runOperation).mockRejectedValue(new Error("Model unavailable"));
    await expect(parseDocument("screen.png", "image/png", png)).rejects.toThrow("Model unavailable");
  });
});

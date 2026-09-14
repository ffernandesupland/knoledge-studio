import { expect, it, vi } from "vitest";
import { createUploadQueue } from "./upload-queue";

it("starts two selected files before either upload completes", async () => {
  const queue = createUploadQueue();
  let finish!: () => void;
  const gate = new Promise<void>(resolve => { finish = resolve; });
  const first = vi.fn(() => gate);
  const second = vi.fn(() => gate);
  const results = [queue.add(first), queue.add(second)];
  await Promise.resolve();
  expect(first).toHaveBeenCalledOnce();
  expect(second).toHaveBeenCalledOnce();
  finish();
  await Promise.all(results);
});

it("bounds concurrency and continues queued files when one upload fails", async () => {
  const queue = createUploadQueue(2);
  let finish!: () => void;
  const gate = new Promise<void>(resolve => { finish = resolve; });
  const first = queue.add(() => gate);
  const second = queue.add(async () => { throw new Error("Bad file"); });
  const thirdTask = vi.fn(async () => {});
  const third = queue.add(thirdTask);
  expect(thirdTask).not.toHaveBeenCalled();
  await expect(second).rejects.toThrow("Bad file");
  await third;
  expect(thirdTask).toHaveBeenCalledOnce();
  finish();
  await first;
});

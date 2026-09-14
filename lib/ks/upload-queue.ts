/** Keep file requests separate for the per-request upload limit, but read several at once. */
export function createUploadQueue(concurrency = 3) {
  let active = 0;
  const waiting: (() => void)[] = [];
  function drain() {
    while (active < concurrency && waiting.length) waiting.shift()!();
  }
  return {
    add(task: () => Promise<void>): Promise<void> {
      return new Promise((resolve, reject) => {
        waiting.push(() => {
          active++;
          Promise.resolve().then(task).then(resolve, reject).finally(() => {
            active--;
            drain();
          });
        });
        drain();
      });
    },
  };
}

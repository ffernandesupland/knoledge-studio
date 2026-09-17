/** Strict terminal-message contract, including a final line without a newline. */
export async function readNdjson(response: Response, onMessage: (msg: Record<string, unknown>) => void) {
  if (!response.ok) throw new Error((await response.json().catch(() => ({ error: `HTTP ${response.status}` }))).error ?? "Request failed");
  if (!response.body) throw new Error("Server returned no response stream");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "", terminal = false;
  const consume = (line: string) => {
    if (!line.trim()) return;
    const msg = JSON.parse(line) as Record<string, unknown>;
    if (msg.type === "error") { onMessage(msg); throw new Error(String(msg.message)); }
    if (msg.type === "result") terminal = true;
    onMessage(msg);
  };
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) { buffer += decoder.decode(); if (buffer.trim()) consume(buffer); break; }
      buffer += decoder.decode(value, { stream: true });
      if (buffer.length > 8_000_000) throw new Error("Response exceeded the supported size");
      const lines = buffer.split("\n"); buffer = lines.pop() ?? "";
      for (const line of lines) consume(line);
    }
    if (!terminal) throw new Error("Connection ended before completion. Reload to resume, or retry unfinished work.");
  } finally { reader.releaseLock(); }
}

import "dotenv/config";
import { randomUUID } from "node:crypto";
import { claim, enabled, heartbeat, workerHeartbeat, removeWorker } from "../lib/autonomous/store";
import { processJob } from "../lib/autonomous/runner";
import { assertConfig } from "../lib/config";

async function main() {
  if (!enabled()) throw new Error("Set KS_AUTONOMOUS_ENABLED=true to enable the autonomous worker");
  assertConfig();
  if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is required");
  const workerId = randomUUID();
  let stopping = false;
  process.on("SIGTERM", () => { stopping = true; });
  process.on("SIGINT", () => { stopping = true; });
  console.log("Autonomous worker ready. Uses the existing AI models and database; no Vercel services.");
  await workerHeartbeat(workerId);
  const presence = setInterval(() => { void workerHeartbeat(workerId).catch(() => { console.error("Worker heartbeat unavailable"); }); }, 15_000);
  try {
    while (!stopping) {
      const claimed = await claim();
      if (!claimed) { if (process.argv.includes("--once")) break; await new Promise(r => setTimeout(r, 2000)); continue; }
      const timer = setInterval(() => { void heartbeat(claimed.job.runId, claimed.token).catch(() => { console.error("Run lease lost; subsequent operations will be blocked"); }); }, 15_000);
      try { await processJob(claimed.job, claimed.token); }
      catch (e) { console.error("Run worker stopped", claimed.job.runId, e instanceof Error ? e.message : "Unknown error"); }
      finally { clearInterval(timer); }
      if (process.argv.includes("--once")) break;
    }
  } finally { clearInterval(presence); await removeWorker(workerId); }
}
main().catch(e => { console.error(e instanceof Error ? e.message : String(e)); process.exitCode = 1; });

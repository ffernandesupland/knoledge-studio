import { db } from "../db";
import { assertGroundReferencesCurrent, GroundReferenceChangedError } from "./server";
import type { GroundContextSnapshot } from "./types";

/** Share the same persisted diagnostics across research, preparation, and submission. */
export async function checkRunReferences(run: { id: string; groundContext?: GroundContextSnapshot }, user: string) {
  try {
    await assertGroundReferencesCurrent(run.groundContext, user);
    await db().prepare("DELETE FROM reference_checks WHERE run_id=?").run(run.id);
  } catch (error) {
    if (error instanceof GroundReferenceChangedError) {
      await db().prepare("INSERT INTO reference_checks(run_id,payload) VALUES (?,?) ON CONFLICT(run_id) DO UPDATE SET payload=excluded.payload").run(run.id, JSON.stringify(error.changes));
    }
    throw error;
  }
}

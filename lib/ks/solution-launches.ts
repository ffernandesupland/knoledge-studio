import { randomUUID } from "node:crypto";
import { ApiError } from "../api/auth";
import { db } from "../db";
import { solutionVersion } from "../pipeline/version";
import { ra } from "../ra/client";
import { resolveConnection } from "../ra/connections";

type LaunchRow = { id: string; author: string; connection_id: string; solution_id: string; source_version: string; created_at: string };
type LaunchContextRow = { source_solution_ids: string; operations: string; duplicate_scope_ids: string };
export type SolutionLaunch = {
  id: string; connectionId: string; solutionId: string; sourceVersion: string; createdAt: string; title: string; stale: boolean;
  sourceSolutionIds: string[]; operations: string[]; duplicateScopeIds: string[];
};

function parseStringArray(value: string | undefined, fallback: string[]) {
  try { const parsed = JSON.parse(value ?? ""); return Array.isArray(parsed) && parsed.every((item): item is string => typeof item === "string") ? parsed : fallback; }
  catch { return fallback; }
}

export async function createSolutionLaunch(author: string, input: { connectionId?: string; solutionId: string; sourceSolutionIds?: string[]; operations?: string[]; duplicateScopeIds?: string[] }): Promise<SolutionLaunch> {
  const connection = await resolveConnection(author, input.connectionId);
  const solution = await ra.getSolution(input.solutionId, { impUser: author, connection });
  if (solution.id !== input.solutionId) throw new ApiError("Solution not found", 404);
  const sourceSolutionIds = [...new Set([solution.id, ...(input.sourceSolutionIds ?? [])])];
  const duplicateScopeIds = [...new Set(input.duplicateScopeIds ?? [])];
  if (duplicateScopeIds.some((id) => !sourceSolutionIds.includes(id))) throw new ApiError("Duplicate comparison targets must be selected source solutions");
  // Resolve each supplied ID now, so a launch cannot carry an inaccessible target into Studio.
  await Promise.all(sourceSolutionIds.filter((id) => id !== solution.id).map(async (id) => {
    const target = await ra.getSolution(id, { impUser: author, connection });
    if (target.id !== id) throw new ApiError("Selected solution not found", 404);
  }));
  const launch = { id: randomUUID(), author, connectionId: connection.id, solutionId: solution.id, sourceVersion: solutionVersion(solution), createdAt: new Date().toISOString(), title: solution.title, stale: false, sourceSolutionIds, operations: input.operations ?? [], duplicateScopeIds };
  await db().transaction(async () => {
    await db().prepare("INSERT INTO solution_launches(id,author,connection_id,solution_id,source_version,created_at) VALUES(?,?,?,?,?,?)")
      .run(launch.id, launch.author, launch.connectionId, launch.solutionId, launch.sourceVersion, launch.createdAt);
    await db().prepare("INSERT INTO solution_launch_contexts(launch_id,source_solution_ids,operations,duplicate_scope_ids) VALUES(?,?,?,?)")
      .run(launch.id, JSON.stringify(launch.sourceSolutionIds), JSON.stringify(launch.operations), JSON.stringify(launch.duplicateScopeIds));
  })();
  return launch;
}

export async function getSolutionLaunch(author: string, id: string): Promise<SolutionLaunch> {
  const row = await db().prepare("SELECT * FROM solution_launches WHERE id=? AND author=?").get(id, author) as LaunchRow | undefined;
  if (!row) throw new ApiError("Knowledge Studio launch not found", 404);
  const connection = await resolveConnection(author, row.connection_id);
  const solution = await ra.getSolution(row.solution_id, { impUser: author, connection });
  if (solution.id !== row.solution_id) throw new ApiError("Solution not found", 404);
  const context = await db().prepare("SELECT source_solution_ids,operations,duplicate_scope_ids FROM solution_launch_contexts WHERE launch_id=?").get(id) as LaunchContextRow | undefined;
  const sourceSolutionIds = parseStringArray(context?.source_solution_ids, [row.solution_id]).filter((item) => /^\d{15}$/.test(item));
  return {
    id: row.id, connectionId: row.connection_id, solutionId: row.solution_id, sourceVersion: row.source_version, createdAt: row.created_at,
    title: solution.title, stale: solutionVersion(solution) !== row.source_version,
    sourceSolutionIds: sourceSolutionIds.includes(row.solution_id) ? sourceSolutionIds : [row.solution_id, ...sourceSolutionIds],
    operations: parseStringArray(context?.operations, []),
    duplicateScopeIds: parseStringArray(context?.duplicate_scope_ids, []).filter((item) => /^\d{15}$/.test(item)),
  };
}

import { randomUUID } from "node:crypto";
import { ApiError } from "../api/auth";
import { db } from "../db";
import { solutionVersion } from "../pipeline/version";
import { ra } from "../ra/client";
import { resolveConnection } from "../ra/connections";

type LaunchRow = { id: string; author: string; connection_id: string; solution_id: string; source_version: string; created_at: string };
export type SolutionLaunch = { id: string; connectionId: string; solutionId: string; sourceVersion: string; createdAt: string; title: string; stale: boolean };

export async function createSolutionLaunch(author: string, input: { connectionId?: string; solutionId: string }): Promise<SolutionLaunch> {
  const connection = await resolveConnection(author, input.connectionId);
  const solution = await ra.getSolution(input.solutionId, { impUser: author, connection });
  if (solution.id !== input.solutionId) throw new ApiError("Solution not found", 404);
  const launch = { id: randomUUID(), author, connectionId: connection.id, solutionId: solution.id, sourceVersion: solutionVersion(solution), createdAt: new Date().toISOString(), title: solution.title, stale: false };
  await db().prepare("INSERT INTO solution_launches(id,author,connection_id,solution_id,source_version,created_at) VALUES(?,?,?,?,?,?)")
    .run(launch.id, launch.author, launch.connectionId, launch.solutionId, launch.sourceVersion, launch.createdAt);
  return launch;
}

export async function getSolutionLaunch(author: string, id: string): Promise<SolutionLaunch> {
  const row = await db().prepare("SELECT * FROM solution_launches WHERE id=? AND author=?").get(id, author) as LaunchRow | undefined;
  if (!row) throw new ApiError("Knowledge Studio launch not found", 404);
  const connection = await resolveConnection(author, row.connection_id);
  const solution = await ra.getSolution(row.solution_id, { impUser: author, connection });
  if (solution.id !== row.solution_id) throw new ApiError("Solution not found", 404);
  return { id: row.id, connectionId: row.connection_id, solutionId: row.solution_id, sourceVersion: row.source_version, createdAt: row.created_at, title: solution.title, stale: solutionVersion(solution) !== row.source_version };
}

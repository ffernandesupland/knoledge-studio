import { createHash, randomUUID } from "node:crypto";
import { ApiError } from "../api/auth";
import { db } from "../db";
import { PROMPT_VERSION } from "../llm/audit";
import type { DemandPlan } from "./plan";
import type { DemandSpecification } from "./spec";

export type DemandRecommendationStatus = "available" | "accepted" | "dismissed";

export interface StoredDemandRecommendation {
  id: string;
  recommendation: DemandPlan;
  model: string;
  promptVersion: string;
  status: DemandRecommendationStatus;
  createdAt: string;
  updatedAt: string;
}

type RecommendationRow = {
  id: string;
  payload: string;
  model: string;
  prompt_version: string;
  status: DemandRecommendationStatus;
  created_at: string;
  updated_at: string;
};

const now = () => new Date().toISOString();
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const decode = (row: RecommendationRow): StoredDemandRecommendation => ({
  id: row.id,
  recommendation: JSON.parse(row.payload),
  model: row.model,
  promptVersion: row.prompt_version,
  status: row.status,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

/** Stores the bounded model advice separately from a run until the operator chooses it. */
export async function createDemandRecommendation(args: {
  author: string;
  specification: DemandSpecification;
  sourceSummary: string;
  recommendation: DemandPlan;
  model: string;
}): Promise<StoredDemandRecommendation> {
  const id = randomUUID();
  const createdAt = now();
  await db().prepare(`INSERT INTO demand_recommendations
    (id,author,requirement_hash,source_hash,payload,model,prompt_version,status,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?)`).run(
    id, args.author, hash(args.specification), hash(args.sourceSummary), JSON.stringify(args.recommendation),
    args.model, PROMPT_VERSION, "available", createdAt, createdAt,
  );
  return { id, recommendation: args.recommendation, model: args.model, promptVersion: PROMPT_VERSION, status: "available", createdAt, updatedAt: createdAt };
}

export async function getDemandRecommendation(author: string, id: string): Promise<StoredDemandRecommendation | undefined> {
  const row = await db().prepare("SELECT id,payload,model,prompt_version,status,created_at,updated_at FROM demand_recommendations WHERE id=? AND author=?").get(id, author) as RecommendationRow | undefined;
  return row && decode(row);
}

export async function setDemandRecommendationStatus(author: string, id: string, status: Exclude<DemandRecommendationStatus, "available">): Promise<StoredDemandRecommendation> {
  const result = await db().prepare("UPDATE demand_recommendations SET status=?,updated_at=? WHERE id=? AND author=? AND status='available'").run(status, now(), id, author);
  if (!result.changes) throw new ApiError("This workflow recommendation was already decided", 409);
  return (await getDemandRecommendation(author, id))!;
}

export async function validateDemandRecommendation(author: string, id: string, specification: DemandSpecification | undefined): Promise<StoredDemandRecommendation> {
  if (!specification) throw new ApiError("A workflow recommendation requires matching demand requirements", 400);
  const row = await db().prepare("SELECT id,payload,model,prompt_version,status,created_at,updated_at,requirement_hash FROM demand_recommendations WHERE id=? AND author=?").get(id, author) as (RecommendationRow & { requirement_hash: string }) | undefined;
  if (!row) throw new ApiError("Workflow recommendation not found", 404);
  if (row.status !== "accepted") throw new ApiError("Apply the workflow recommendation before starting analysis", 409);
  if (row.requirement_hash !== hash(specification)) throw new ApiError("Demand requirements changed after the workflow recommendation. Request a new recommendation.", 409);
  return decode(row);
}

/** Binds only an accepted recommendation whose requirements exactly match the frozen run input. */
export async function attachDemandRecommendation(runId: string, author: string, id: string, specification: DemandSpecification | undefined): Promise<StoredDemandRecommendation> {
  const recommendation = await validateDemandRecommendation(author, id, specification);
  await db().prepare("INSERT INTO run_demand_recommendations(run_id,recommendation_id) VALUES (?,?) ON CONFLICT(run_id) DO UPDATE SET recommendation_id=excluded.recommendation_id").run(runId, id);
  return recommendation;
}

export async function getRunDemandRecommendation(runId: string): Promise<StoredDemandRecommendation | undefined> {
  const row = await db().prepare(`SELECT r.id,r.payload,r.model,r.prompt_version,r.status,r.created_at,r.updated_at
    FROM run_demand_recommendations link JOIN demand_recommendations r ON r.id=link.recommendation_id WHERE link.run_id=?`).get(runId) as RecommendationRow | undefined;
  return row && decode(row);
}

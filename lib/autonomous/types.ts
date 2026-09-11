import type { RunInput } from "../pipeline/run";

/** Autonomous state is separate from the guided wizard's run/approval state. */
export type AutonomousStage = "queued" | "analysis" | "decisions" | "preparation" | "review" | "submission" | "finished";
export type AutonomousStatus = "queued" | "running" | "completed" | "partial" | "failed";
export interface AutonomousInput extends RunInput {
  path?: "create" | "improve" | "gap";
  standardsRules: string[];
}
export interface AutonomousAuthorization {
  actor: string;
  authorizedAt: string;
  policyVersion: string;
  scope: "create-review-drafts-and-revisions";
}
export interface AutonomousEvent {
  id: number;
  runId: string;
  at: string;
  stage: AutonomousStage;
  kind: "state" | "decision" | "tool" | "model" | "validation" | "write" | "error";
  name: string;
  status: "started" | "succeeded" | "failed" | "skipped";
  /** Explicit evidence-based explanation, not hidden model chain-of-thought. */
  explanation?: string;
  input?: unknown;
  output?: unknown;
  correlationId?: string;
}
export interface AutonomousJob {
  runId: string;
  author: string;
  input: AutonomousInput;
  authorization: AutonomousAuthorization;
  status: AutonomousStatus;
  stage: AutonomousStage;
  createdAt: string;
  updatedAt: string;
  error?: string;
}
export const AUTONOMOUS_POLICY_VERSION = "2026-09-11.1";
// Separate from user authorization so planner fixes do not invalidate saved runs.
export const DECISION_REPAIR_KEY = "decision-repair:2026-09-11.2";
export const MAX_DECISION_ATTEMPTS = 3;

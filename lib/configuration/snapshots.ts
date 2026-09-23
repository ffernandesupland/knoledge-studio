import sanitizeHtml from "sanitize-html";
import { createHash } from "node:crypto";
import { db } from "../db";
import { ra } from "../ra/client";
import { getConfigurationDocument } from "./documents";
import { listConfigurationProfiles } from "./store";
import { listSnippets } from "./snippets";
import type { ConfigurationProfile, ConfigurationProfileKind, ConfigurationSource, Snippet } from "./types";

export interface CapturedConfigurationSource {
  type: ConfigurationSource["type"];
  label: string;
  content: string;
  sourceId?: string;
  version: string;
}
export interface CapturedConfigurationProfile extends Omit<ConfigurationProfile, "sources"> {
  sources: CapturedConfigurationSource[];
}
export interface CapturedConfigurationSnapshot {
  capturedAt: string;
  profiles: CapturedConfigurationProfile[];
}
export interface RunConfigurationSnapshots {
  contentStandards: CapturedConfigurationSnapshot;
  groundTruth: CapturedConfigurationSnapshot;
  snippets: { capturedAt: string; snippets: Snippet[] };
}

const fingerprint = (content: string) => createHash("sha256").update(content.normalize("NFC")).digest("hex");
const clean = (value: string) => sanitizeHtml(value, { allowedTags: [], allowedAttributes: {} }).replace(/\s+/g, " ").trim();

function solutionText(solution: { title: string; summary?: string; fields?: { name: string; content: string }[] }) {
  return [solution.title, solution.summary ?? "", ...(solution.fields ?? []).map(field => `${field.name}\n${clean(field.content)}`)].filter(Boolean).join("\n\n");
}

async function captureSource(connectionId: string, source: ConfigurationSource, user: string): Promise<CapturedConfigurationSource> {
  if (source.type === "text") return { type: "text", label: "Written instruction", content: source.text, version: fingerprint(source.text) };
  if (source.type === "document") {
    const document = await getConfigurationDocument(source.documentId, connectionId);
    return { type: "document", label: document.name, content: document.extractedText, sourceId: document.id, version: fingerprint(document.extractedText) };
  }
  const solution = await ra.getSolution(source.solutionId, { impUser: user });
  if (solution.id !== source.solutionId) throw new Error("Configuration solution retrieval returned a different solution.");
  const content = solutionText(solution);
  if (!content) throw new Error(`Configuration solution ${source.solutionId} has no readable content.`);
  return { type: "solution", label: solution.title, content, sourceId: solution.id, version: fingerprint(content) };
}

async function captureProfiles(connectionId: string, user: string, kind: ConfigurationProfileKind): Promise<CapturedConfigurationSnapshot> {
  const profiles = await listConfigurationProfiles(connectionId, kind);
  const capturedAt = new Date().toISOString();
  const captured: CapturedConfigurationProfile[] = [];
  for (const profile of profiles) {
    const sources = await Promise.all(profile.sources.map(source => captureSource(connectionId, source, user)));
    if (sources.reduce((total, source) => total + source.content.length, 0) > 120_000) throw new Error(`${profile.name} exceeds the 120,000-character configuration limit.`);
    captured.push({ ...profile, sources });
  }
  return { capturedAt, profiles: captured };
}

export async function captureRunConfigurationSnapshots(connectionId: string, user: string): Promise<RunConfigurationSnapshots> {
  const [contentStandards, groundTruth, snippets] = await Promise.all([
    captureProfiles(connectionId, user, "content_standard"),
    captureProfiles(connectionId, user, "ground_truth"),
    listSnippets(connectionId),
  ]);
  return { contentStandards, groundTruth, snippets: { capturedAt: new Date().toISOString(), snippets } };
}

export async function saveRunConfigurationSnapshots(runId: string, snapshots: RunConfigurationSnapshots): Promise<void> {
  await db().transaction(async () => {
    for (const [kind, payload] of [["content_standards", snapshots.contentStandards], ["ground_truth", snapshots.groundTruth], ["snippets", snapshots.snippets]] as const) {
      await db().prepare("INSERT INTO run_configuration_snapshots(run_id,kind,payload) VALUES(?,?,?) ON CONFLICT(run_id,kind) DO UPDATE SET payload=excluded.payload").run(runId, kind, JSON.stringify(payload));
    }
  })();
}

export async function getRunConfigurationSnapshots(runId: string): Promise<Partial<RunConfigurationSnapshots>> {
  const rows = await db().prepare("SELECT kind,payload FROM run_configuration_snapshots WHERE run_id=?").all(runId) as { kind: string; payload: string }[];
  const result: Partial<RunConfigurationSnapshots> = {};
  for (const row of rows) {
    if (row.kind === "content_standards") result.contentStandards = JSON.parse(row.payload);
    if (row.kind === "ground_truth") result.groundTruth = JSON.parse(row.payload);
    if (row.kind === "snippets") result.snippets = JSON.parse(row.payload);
  }
  return result;
}

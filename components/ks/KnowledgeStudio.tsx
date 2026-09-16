"use client";
import PipelineMetadata from "./PipelineMetadata";
import { GroundContextInput } from "./GroundContextInput";
import { emptyGroundSelection, groundIdentity, type GroundContextInput as GroundSelection } from "@/lib/ground-context/types";
import type { MetadataSettings } from "@/lib/metadata/settings";
import { legacyDocument, type SourceBlock, type SourceAttachment } from "@/lib/ks/source-document";

import { AutonomousRun } from "./AutonomousRun";
import { SignOutButton } from "@/components/auth/SignOutButton";
import { useEffect, useMemo, useRef, useState } from "react";
import { DsDropdown, IdChip, Snackbar, useActionToast } from "@/components/ds";
import {
  KsAddRuleMenu,
  KsSmartInput,
  KsStepper,
  type Attachment,
  type KbRow,
} from "./parts";
import { usePipelineRun } from "./usePipelineRun";
import { useSubmitRun } from "./useSubmitRun";
import { LoadingProgress } from "./LoadingProgress";
import { submissionStatus } from "@/lib/ks/submission-status";
import { SubmissionGraph } from "./SubmissionGraph";
import { buildSubmissionGraph } from "@/lib/ks/submission-graph";
import { submissionIdentity } from "@/lib/ks/submission-plan";
import { SubmissionReview } from "./SubmissionReview";
import { ProposalPreview } from "./ProposalPreview";
import { ArticlePreview } from "./ArticlePreview";
import type { DecisionSnapshot } from "@/lib/db/runs";
import type { ContentReview } from "@/lib/pipeline/execute";
import Link from "next/link";
import { MergeWorkspaceModal } from "./MergeWorkspaceModal";
import {
  KS_CS_ALL_RULES,
  KS_CS_PRESETS,
  KS_OPS_DEFAULT,
  KS_PATHS,
  KS_STEPS,
  type PathKey,
  type StepId,
} from "@/lib/ks/data";
import {
  ksCheckGate,
  ksDupTier,
  type DupeResolution,
} from "@/lib/ks/helpers";
import { buildWritePlan, isSolutionId } from "@/lib/pipeline/submit";
import { T } from "@/lib/ks/theme";
import type { MetadataOptions } from "@/app/api/metadata/route";

/** Preserves content for fields the old and new templates share by name; drops the rest. */
function remapFieldsToTemplate(
  fields: { fieldName: string; fieldValue: string }[],
  templateFieldNames: string[],
): { fieldName: string; fieldValue: string }[] {
  const byName = new Map(fields.map((f) => [f.fieldName.toLowerCase(), f.fieldValue]));
  return templateFieldNames.map((name) => ({ fieldName: name, fieldValue: byName.get(name.toLowerCase()) ?? "" }));
}

type Screen = StepId;

const ACTION_CLASS: Record<string, string> = {
  New: "ks-tag-new",
  Update: "ks-tag-upd",
  Merge: "ks-tag-mrg",
};

/**
 * Collections come back in tenant order, which on QA starts with punctuation-only test names.
 * Prefer the first that reads like a real collection rather than defaulting to noise.
 */
function pickDefaultCollection(collections: { code: string; label: string }[]): string {
  const sensible = collections.find((c) => /^[A-Za-z][\w &'()-]{2,}$/.test(c.label.trim()));
  return (sensible ?? collections[0])?.label ?? "";
}

export default function KnowledgeStudio({ initialAutonomousRun }: { initialAutonomousRun?: string } = {}) {
  const [autoMode, setAutoMode] = useState(false);
  const [autoJob, setAutoJob] = useState<string | null>(initialAutonomousRun ?? null);
  const [autoStarting, setAutoStarting] = useState(false);
  const [autoCapability, setAutoCapability] = useState<{ latest?: { runId: string; status: string } } | null>(null);
  const autoRequest = useRef<{ fingerprint: string; id: string } | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/autonomous", { signal: controller.signal }).then(async r => { if (r.ok) setAutoCapability(await r.json()); }).catch(() => {});
    return () => controller.abort();
  }, []);
  function openAuto(id: string) {
    const url = new URL(window.location.href); url.searchParams.set("autonomousRun", id);
    window.history.replaceState(null, "", url); setAutoJob(id);
  }
  function closeAuto() {
    const url = new URL(window.location.href); url.searchParams.delete("autonomousRun");
    window.history.replaceState(null, "", url); setAutoJob(null); setAutoMode(false); autoRequest.current = null;
  }
  const [screen, setScreen] = useState<Screen>("input");
  const [path, setPath] = useState<PathKey | null>(null);
  const [contentText, setContentText] = useState("");
  const [sourceContent, setSourceContent] = useState<SourceBlock[]>([{ id: "text-start", type: "text", text: "" }]);
  function changeSourceContent(blocks: SourceBlock[]) {
    setSourceContent(blocks);
    setContentText(blocks.flatMap(b => b.type === "text" ? [b.text] : []).join("\n"));
  }
  const [gapQuestion, setGapQuestion] = useState("");
  const [sourcesBusy, setSourcesBusy] = useState(false);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [dragOver, setDragOver] = useState(false);

  const [groundContext, setGroundContext] = useState<GroundSelection>(emptyGroundSelection);
  const [kbSearchOpen, setKbSearchOpen] = useState(false);
  const [kbQuery, setKbQuery] = useState("");
  const [kbRows, setKbRows] = useState<KbRow[]>([]);
  const [kbLoading, setKbLoading] = useState(false);
  const [kbSelected, setKbSelected] = useState<Record<string, KbRow>>({});

  const [ops, setOps] = useState(() => KS_OPS_DEFAULT.map((o) => ({ ...o })));

  const pipeline = usePipelineRun();
  const submitRun = useSubmitRun();
  const candidates = useMemo(() => pipeline.run?.candidates ?? [], [pipeline.run]);
  const groups = useMemo(() => pipeline.run?.groups ?? [], [pipeline.run]);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [resolutions, setResolutions] = useState<DupeResolution[]>([]);
  const [dupeModal, setDupeModal] = useState<number | null>(null);
  const [mergeModal, setMergeModal] = useState<number | null>(null);
  /** Survivor chosen per group on the picker screen; falls back to the pipeline's pick. */
  const [survivorChoice, setSurvivorChoice] = useState<Record<number, string>>({});

  const [meta, setMeta] = useState<MetadataOptions | null>(null);
  const [metaError, setMetaError] = useState<string | null>(null);
  const [metadataSettings, setMetadataSettings] = useState<MetadataSettings>({});
  const [metadataBusy, setMetadataBusy] = useState(false);
  const [metaFields, setMetaFields] = useState({ Collection: "", Language: "", Owner: "Loading author…" });
  const [csStandard, setCsStandard] = useState("Default company standard");
  const [csRules, setCsRules] = useState<string[]>([...KS_CS_PRESETS["Default company standard"]]);
  /** Default template new solutions are created with; a per-solution override wins over this. */
  const [newSolutionTemplate, setNewSolutionTemplate] = useState<string | null>(null);
  const [templateOverrides, setTemplateOverrides] = useState<Set<string>>(new Set());
  const [templateEditOpen, setTemplateEditOpen] = useState<Record<string, boolean>>({});

  const restored = useRef(false);
  const [sessionReady, setSessionReady] = useState(false);
  const [preview, setPreview] = useState<{ title: string; article?: { summary?: string; keywords?: string[]; templateName?: string; fields?: { fieldName: string; fieldValue: string }[] }; candidateKey?: string } | null>(null);
  const [toast, showToast, dismissToast] = useActionToast();

  /* A run costs minutes and real money, so a refresh resumes rather than discards it. */
  useEffect(() => {
    let cancelled = false;
    fetch("/api/runs/latest")
      .then((r) => r.json())
      .then((d) => {
        if (cancelled || !d.run) return;
        const stored = d.run;
        const snapshot = stored.snapshot as DecisionSnapshot | undefined;
        setGroundContext(stored.groundContext?.selection ?? emptyGroundSelection);
        pipeline.restore(stored.id, {
          groundContext: stored.groundContext,
          candidates: snapshot?.candidates ?? stored.candidates, groups: snapshot?.groups ?? stored.groups,
          costUsd: stored.costUsd, steps: stored.steps,
        });
        setSelected(new Set(snapshot?.selectedKeys ?? stored.decisions?.selectedKeys ?? stored.candidates.filter((c: { researchOnly?: boolean }) => !c.researchOnly).map((c: { key: string }) => c.key)));
        setResolutions(snapshot?.resolutions ?? stored.decisions?.resolutions ?? stored.groups.map(() => null));
        setOps(KS_OPS_DEFAULT.map(o => ({ ...o, on: snapshot?.operations.find(v => v.name === o.name)?.on ?? stored.operations.includes(o.name) })));
        setMetadataSettings(snapshot?.metadata ?? {});
        if (snapshot) {
          restored.current = true;
          setMetaFields((p) => ({ ...p, Collection: snapshot.collection, Language: snapshot.language }));
          setCsStandard(snapshot.standard); setCsRules(snapshot.standardsRules);
          setNewSolutionTemplate(snapshot.newSolutionTemplate); setTemplateOverrides(new Set(snapshot.templateOverrides));
        } else if (stored.decisions?.collection) {
          restored.current = true;
          setMetaFields((p) => ({ ...p, Collection: stored.decisions.collection, Language: stored.decisions.language ?? p.Language }));
        }
        setPath(stored.path ?? null); setContentText(stored.inputText ?? "");
        const restoredAttachments: SourceAttachment[] = (stored.attachments ?? []).map((a: SourceAttachment, i: number) => ({ ...a, id: a.id ?? `legacy-${i}` }));
        setAttachments(restoredAttachments.map(a => ({ id: a.id!, imageId: a.imageId, meta: a.meta, name: a.label, text: a.text, icon: a.kind === "url" ? "link" : /\.(png|jpe?g|webp)$/i.test(a.label) ? "image" : /\.pdf$/i.test(a.label) ? "picture_as_pdf" : "description" })));
        setSourceContent(stored.content ?? legacyDocument(stored.inputText ?? "", restoredAttachments));
        setKbSelected(Object.fromEntries((stored.sourceIds ?? []).map((id: string) => [id, { id, title: `Solution ${id}`, meta: "Selected source" }])));
        if (d.execution) { submitRun.restore(d.execution.plan, d.results ?? [], d.execution.stage, d.execution.reviewIdentity); setScreen("submit"); }
        else setScreen("check");
        showToast({ message: "Resumed your last session — use Reset to start clean instead.", icon: "history" });
      })
      .catch(() => undefined)
      .finally(() => { if (!cancelled) setSessionReady(true); });
    return () => {
      cancelled = true;
    };
    // Intentionally mount-only: this restores the previous session once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/metadata")
      .then((r) => (r.ok ? r.json() : r.json().then((e) => Promise.reject(new Error(e.error)))))
      .then((d: MetadataOptions) => {
        if (cancelled) return;
        setMeta(d);
        setMetaFields((p) => ({
          ...p,
          Owner: d.author ?? "Pilot author",
          Collection: restored.current ? p.Collection : pickDefaultCollection(d.collections),
          Language: restored.current ? p.Language : d.languages.find((l) => /^english/i.test(l)) ?? d.languages[0] ?? "English",
        }));
      })
      .catch((e: Error) => !cancelled && setMetaError(e.message));
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!kbSearchOpen || !kbQuery.trim()) {
      return;
    }
    let cancelled = false;
    const t = setTimeout(() => {
      setKbLoading(true);
      fetch(`/api/kb/search?q=${encodeURIComponent(kbQuery)}`)
        .then((r) => r.json())
        .then((d: { rows?: KbRow[] }) => !cancelled && setKbRows(d.rows ?? []))
        .catch(() => !cancelled && setKbRows([]))
        .finally(() => !cancelled && setKbLoading(false));
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [kbQuery, kbSearchOpen]);

  function pickPath(k: PathKey) {
    setPath(k);
    const onList = KS_PATHS[k].on;
    setOps(KS_OPS_DEFAULT.map((o) => ({ ...o, on: onList.includes(o.name) })));
    showToast({ message: `${KS_PATHS[k].label} · options preset` });
  }

  async function createPlan() {
    if (sourcesBusy) return;
    if (sourceContent.some(b => b.type === "attachment" && !attachments.some(a => a.id === b.attachmentId))) {
      showToast({ message: "Remove failed uploads or wait until every source is ready." }); return;
    }
    const orderedContent: SourceBlock[] = gapQuestion ? [{ id: "gap-question", type: "text", text: `Question: ${gapQuestion}` }, ...sourceContent] : sourceContent;
    const sourceSolutionIds = Object.entries(kbSelected)
      .filter(([, on]) => on)
      .map(([id]) => id);
    if (!contentText.trim() && attachments.length === 0 && sourceSolutionIds.length === 0 && !ops.some((o) => o.name === "Find gaps" && o.on)) {
      showToast({ message: "Add some content, a file, or pick a solution first" });
      return;
    }
    if (groundContext.enabled && (!groundContext.referenceSolutionIds.length || groundContext.referenceSolutionIds.some(id => sourceSolutionIds.includes(id)))) {
      showToast({ message: "Choose Ground Context references that are different from your processing targets." }); return;
    }
    if (autoMode) {
      if (autoStarting) return;
      const input = {
        text: gapQuestion && contentText.trim() ? `Question: ${gapQuestion}\n\nSupported source material:\n${contentText}` : contentText,
        content: orderedContent,
        attachments: attachments.map(a => ({ id: a.id, imageId: a.imageId, meta: a.meta, label: a.name, text: a.text, kind: a.icon === "link" ? "url" : "file" })),
        groundContext, sourceSolutionIds, operations: ops.filter(o => o.on).map(o => o.name), path: path ?? undefined,
        standardsRules: ops.some(o => o.name === "Apply content standards" && o.on) ? csRules : [],
      };
      const fingerprint = JSON.stringify(input);
      if (autoRequest.current?.fingerprint !== fingerprint) autoRequest.current = { fingerprint, id: crypto.randomUUID() };
      setAutoStarting(true);
      try {
        const response = await fetch("/api/autonomous", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ requestId: autoRequest.current.id, autonomous: true, input }) });
        const data = await response.json(); if (!response.ok) throw new Error(data.error);
        setAutoCapability({ latest: { runId: data.runId, status: data.status } });
        openAuto(data.runId);
      } catch (e) { showToast({ message: e instanceof Error ? e.message : "Could not start autonomous run" }); }
      finally { setAutoStarting(false); }
      return;
    }
    setScreen("check");
    setMetadataSettings({});
    setSelected(new Set());
    setResolutions([]);
    setSurvivorChoice({}); setTemplateOverrides(new Set()); submitRun.reset();
    const view = await pipeline.start({
      text: gapQuestion && contentText.trim() ? `Question: ${gapQuestion}\n\nSupported source material:\n${contentText}` : contentText,
      content: orderedContent,
      attachments: attachments.map((a) => ({ id: a.id, imageId: a.imageId, meta: a.meta, label: a.name, text: a.text, kind: a.icon === "link" ? "url" : "file" })),
      groundContext,
      sourceSolutionIds,
      operations: ops.filter((o) => o.on).map((o) => o.name),
      path: path ?? undefined,
    });
    if (view) {
      setSelected(new Set(view.candidates.filter((c) => !c.researchOnly).map((c) => c.key)));
      setResolutions(view.groups.map(() => null));
      setNewSolutionTemplate(view.candidates.find((c) => !c.targetSolutionId)?.templateName ?? null);
    }
  }

  function toggleSelect(key: string) {
    if (candidates.find((c) => c.key === key)?.researchOnly) return;
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  /** "Start over": clears every screen's state and stops the server from offering this run back. */
  function resetAll(finished = false) {
    if (sourcesBusy) return;
    setGapQuestion("");
    const hasProgress =
      path != null || contentText.trim().length > 0 || attachments.length > 0 || pipeline.phase !== "idle";
    if (!finished && hasProgress && !window.confirm("Start over? This clears your current content, selections and analysis.")) {
      return;
    }

    setAutoMode(false); autoRequest.current = null;
    setScreen("input");
    setPath(null);
    setContentText(""); setSourceContent([{ id: "text-start", type: "text", text: "" }]);
    setAttachments([]);
    setDragOver(false);
    setKbSearchOpen(false);
    setKbQuery("");
    setKbRows([]);
    setKbSelected({});
    setGroundContext(emptyGroundSelection);
    setOps(KS_OPS_DEFAULT.map((o) => ({ ...o })));
    setMetadataSettings({});

    pipeline.reset();
    submitRun.reset();
    setSelected(new Set());
    setResolutions([]);
    setDupeModal(null);
    setMergeModal(null);
    setSurvivorChoice({});

    setMetaFields((p) => ({
      ...p,
      Collection: meta ? pickDefaultCollection(meta.collections) : "",
      Language: meta ? (meta.languages.find((l) => /^english/i.test(l)) ?? meta.languages[0] ?? "English") : "English",
    }));
    setCsStandard("Default company standard");
    setCsRules([...KS_CS_PRESETS["Default company standard"]]);
    setNewSolutionTemplate(null);
    setTemplateOverrides(new Set());
    setTemplateEditOpen({});

    setPreview(null);

    if (!finished) void fetch("/api/runs/latest", { method: "DELETE" }).catch(() => undefined);
    showToast({ message: finished ? "Finished. Your execution is saved in Explore engine flow → Past executions." : "Started over" });
  }

  function resolveGroup(idx: number, value: DupeResolution, message: string) {
    setResolutions((prev) => prev.map((v, i) => (i === idx ? value : v)));
    setDupeModal(null);
    setMergeModal(null);
    showToast({ message });
  }

  /** Applies a template to one new-solution candidate, remapping its fields to match. */
  function applyTemplate(key: string, templateName: string) {
    const c = candidates.find((x) => x.key === key);
    const fieldNames = meta?.templates.find((t) => t.name === templateName)?.fields;
    if (!c || !fieldNames) return;
    pipeline.updateCandidate(key, { templateName, fields: remapFieldsToTemplate(c.fields, fieldNames) });
  }

  /** Sets the default template for every new solution that hasn't been individually overridden. */
  function applyGlobalTemplate(templateName: string) {
    setNewSolutionTemplate(templateName);
    for (const c of candidates) {
      if (isSolutionId(c.key) || templateOverrides.has(c.key)) continue;
      applyTemplate(c.key, templateName);
    }
  }

  function overrideTemplate(key: string, templateName: string) {
    setTemplateOverrides((prev) => new Set(prev).add(key));
    applyTemplate(key, templateName);
  }

  function resetTemplateOverride(key: string) {
    setTemplateOverrides((prev) => {
      const next = new Set(prev);
      next.delete(key);
      return next;
    });
    if (newSolutionTemplate) applyTemplate(key, newSolutionTemplate);
  }

  /** Groups with the picker screen's chosen survivor applied, so it flows through everywhere. */
  const effectiveGroups = useMemo(() => {
    if (!Object.keys(survivorChoice).length) return groups;
    return groups.map((g, i) => {
      const chosen = survivorChoice[i];
      if (!chosen || chosen === g.survivorId) return g;
      return {
        ...g,
        survivorId: chosen,
        members: g.members.map((m) => ({ ...m, retained: m.id === chosen })),
      };
    });
  }, [groups, survivorChoice]);

  const metadataEnabled = ops.some(o => o.name === "Discover and suggest metadata" && o.on);
  const showMetadataEditor = metadataEnabled || Object.keys(metadataSettings.global ?? {}).length > 0 || Object.keys(metadataSettings.solutions ?? {}).length > 0;
  const flowKeys: Record<string, string> = { "Split topics": "split", "Restructure content": "restructure", "Apply content standards": "standards", "Find duplicates": "dedupe", "Optimize for search": "optimize", "Find gaps": "gaps", "Discover and suggest metadata": "metadataSuggest" };
  const flowHref = `/flow?options=${ops.filter((o) => o.on).map((o) => flowKeys[o.name]).join(",")}&sources=${[contentText.trim() ? "text" : "", attachments.some((a) => a.icon !== "link") ? "file" : "", attachments.some((a) => a.icon === "link") ? "url" : "", Object.values(kbSelected).some(Boolean) ? "existing" : ""].filter(Boolean).join(",")}&runId=${encodeURIComponent(pipeline.runId ?? "")}`;
  const groundContextIdentity = groundIdentity(pipeline.run?.groundContext);
  const snapshot = useMemo<DecisionSnapshot>(() => ({
    groundContextIdentity,
    candidates, groups: effectiveGroups, selectedKeys: [...selected], resolutions, operations: ops,
    collection: metaFields.Collection, language: metaFields.Language, standard: csStandard, standardsRules: csRules,
    newSolutionTemplate, templateOverrides: [...templateOverrides], metadata: metadataSettings,
  }), [groundContextIdentity, candidates, effectiveGroups, selected, resolutions, ops, metaFields.Collection, metaFields.Language, csStandard, csRules, newSolutionTemplate, templateOverrides, metadataSettings]);
  useEffect(() => {
    if (!sessionReady || pipeline.phase !== "done" || !pipeline.runId || (submitRun.locked || submitRun.phase === "preparing" || submitRun.phase === "submitting")) return;
    const t = setTimeout(() => {
      void fetch("/api/runs/latest", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ runId: pipeline.runId, snapshot }) })
        .then((r) => { if (!r.ok) throw new Error("Could not save session decisions"); })
        .catch((e: Error) => showToast({ message: e.message, icon: "error" }));
    }, 400);
    return () => clearTimeout(t);
  }, [sessionReady, pipeline.phase, pipeline.runId, submitRun.phase, submitRun.locked, snapshot, showToast]);
  function prepareCurrent(reviews?: Record<string, ContentReview>) {
    void submitRun.prepare({ runId: pipeline.runId ?? "", snapshot, reviews });
  }
  function submitCurrent() {
    void submitRun.submit({ runId: pipeline.runId ?? "", snapshot, approvals: Object.fromEntries(submitRun.results.filter((r) => r.prepared).map((r) => [r.idempotencyKey, r.prepared!.version])) });
  }
  const [draftEditing, setDraftEditing] = useState(false);

  const gate = ksCheckGate(candidates, effectiveGroups, selected, resolutions);
  const proposedWritePlan = useMemo(() => {
    try { return { plan: buildWritePlan({ runId: pipeline.runId ?? "", candidates, groups: effectiveGroups, selected, resolutions, metadata: metadataSettings }), error: "" }; }
    catch (e) { return { plan: [], error: (e as Error).message }; }
  }, [pipeline.runId, candidates, effectiveGroups, selected, resolutions, metadataSettings]);
  const currentIdentity = submissionIdentity(proposedWritePlan.plan, snapshot);
  const preparedMatches = submitRun.identity === currentIdentity;
  const displayPlan = submitRun.locked ? submitRun.plan : proposedWritePlan.plan;
  const displayResults = preparedMatches || submitRun.locked ? submitRun.results : [];
  const submissionGraph = buildSubmissionGraph(displayPlan, candidates, displayResults, { groups: effectiveGroups, restructureEnabled: ops.some((o) => o.name === "Restructure content" && o.on), standardsRules: ops.some((o) => o.name === "Apply content standards" && o.on) ? csRules : [] });
  const submissionBusy = submitRun.phase === "preparing" || submitRun.phase === "submitting";
  const draftsReady = displayPlan.some((op) => op.kind !== "flag") && (preparedMatches || submitRun.locked) && displayPlan.every((op) => op.kind === "flag" || displayResults.some((r) => r.idempotencyKey === op.idempotencyKey && (r.outcome === "ok" || (r.prepared?.readyForSubmission && r.outcome !== "uncertain"))));
  const completion = submissionStatus(displayPlan, displayResults);
  const allWritten = completion.complete;


  const stepperActiveId: StepId = screen;
  const doneIds = KS_STEPS.slice(
    0,
    KS_STEPS.findIndex((s) => s.id === stepperActiveId),
  ).map((s) => s.id);

  const collectionOptions = meta?.collections.map((c) => c.label) ?? [];
  const languageOptions = meta?.languages.length ? meta.languages : ["English"];
  const templateOptions = meta?.templates.map((t) => t.name) ?? [];

  /* ── Content ── */
  function renderInputScreen() {
    if (!path) {
      return (
        <div className="ks-scroll">
          <div style={{ maxWidth: 880, margin: "0 auto" }}>
            <div className="ks-banner ks-banner--info">
              <div className="ks-banner__row">
                <div className="ks-banner__icon">
                  <span className="ms">info</span>
                </div>
                <div className="ks-banner__text">
                  <div className="ks-banner__title">What Knowledge Studio does</div>
                  <div className="ks-banner__desc">
                    Turns raw content into structured solutions and cleans up duplicates.
                  </div>
                </div>
              </div>
              <div className="ks-reasons">
                <div className="ks-reason">
                  <span className="ms">note_add</span>
                  <div>
                    <div className="ks-reason-t">Create</div>
                    <div className="ks-reason-d">From pasted text, a URL or uploaded documents.</div>
                  </div>
                </div>
                <div className="ks-reason">
                  <span className="ms">auto_fix_high</span>
                  <div>
                    <div className="ks-reason-t">Improve</div>
                    <div className="ks-reason-d">
                      Reformat, split or merge what&apos;s already in your knowledge base.
                    </div>
                  </div>
                </div>
                <div className="ks-reason">
                  <span className="ms">troubleshoot</span>
                  <div>
                    <div className="ks-reason-t">Close a gap</div>
                    <div className="ks-reason-d">Fix questions Gen Answers couldn&apos;t answer.</div>
                  </div>
                </div>
              </div>
              <div className="ks-note">
                It runs inside RightAnswers, so it uses your own templates, taxonomy and existing
                solutions.
              </div>
            </div>
            <div style={{ fontSize: 20, fontWeight: 600, color: T.textPrimary, marginBottom: 4 }}>
              What do you want to do?
            </div>
            <div style={{ fontSize: 14, color: T.textSecondary, lineHeight: 1.5, marginBottom: 20 }}>
              Pick a starting point to get set up.
            </div>
            <div className="ks-paths">
              {(["create", "improve", "gap"] as PathKey[]).map((k) => {
                const p = KS_PATHS[k];
                return (
                  <button type="button" key={k} className="ks-path" onClick={() => pickPath(k)}>
                    <div className="ks-path-top">
                      <span className="ms">{p.icon}</span>
                      <span className="ks-path-t">{p.label}</span>
                    </div>
                    <div className="ks-path-d">{p.desc}</div>
                    <div className="ks-path-ops">{p.ops}</div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      );
    }

    return (
      <div className="ks-scroll">
        <div style={{ maxWidth: 880, margin: "0 auto" }}>
          <div className="ks-pathbar">
            <span>Starting point:</span>
            <span className="ks-chip">
              <span className="ms">{KS_PATHS[path].icon}</span>
              {KS_PATHS[path].label}
            </span>
            <button
              type="button"
              className="ds-btn ds-btn-secondary"
              style={{ height: 28, padding: "0 10px" }}
              disabled={sourcesBusy}
              onClick={() => setPath(null)}
            >
              <span className="ms" style={{ fontSize: 16 }}>
                swap_horiz
              </span>
              Change
            </button>
          </div>
          <div style={{ fontSize: 20, fontWeight: 600, color: T.textPrimary, marginBottom: 4 }}>
            Add your content
          </div>
          <div style={{ fontSize: 14, color: T.textSecondary, lineHeight: 1.5, marginBottom: 20 }}>
            Add your content however you have it. You&apos;ll review a plan before anything is
            created.
          </div>
          <div className="ks-card">
            <div className="ks-card-head">
              <span className="ms">input</span>Content
            </div>
            <KsSmartInput
              content={sourceContent}
              onContentChange={changeSourceContent}
              attachments={attachments}
              onBusyChange={setSourcesBusy}
              onRemoveAttachment={(i) => setAttachments((p) => p.filter((_, idx) => idx !== i))}
              onAttach={(a) => setAttachments((p) => [...p, a])}
              dragOver={dragOver}
              onDragOver={setDragOver}
              kbOpen={kbSearchOpen}
              onToggleKb={() => setKbSearchOpen((o) => !o)}
              kbQuery={kbQuery}
              onKbQuery={(query) => { setKbQuery(query); setKbRows([]); setKbLoading(!!query.trim()); }}
              kbRows={kbRows}
              kbLoading={kbLoading}
              kbSelected={kbSelected}
              onToggleKbRow={(id) => setKbSelected((previous) => {
                const next = { ...previous };
                if (next[id]) delete next[id];
                else {
                  const row = kbRows.find((item) => item.id === id);
                  if (row) next[id] = row;
                }
                return next;
              })}
              showToast={showToast}
            />
          </div>
          <GroundContextInput value={groundContext} onChange={setGroundContext} excludedIds={Object.keys(kbSelected)} savedReferences={pipeline.run?.groundContext?.references} />
          <div className="ks-card auto-option">
            <div><strong>Run fully autonomously</strong><p>The agent will choose articles, merges, templates and metadata, check the prepared content, and create review drafts and revisions. You can inspect every decision in the executed engine flow.</p>
            </div>
            <button type="button" className={"toggle" + (autoMode ? " on" : "")} role="switch" aria-checked={autoMode} aria-label="Run fully autonomously" disabled={autoStarting} onClick={() => setAutoMode(value => !value)} />
            {autoCapability?.latest && <button type="button" className="ds-btn ds-btn-secondary" onClick={() => openAuto(autoCapability.latest!.runId)}>Open last autonomous run</button>}
          </div>
          <div className="ks-card">
            <div className="ks-card-head">
              <span className="ms">tune</span>Choose what to do
            </div>
            <p style={{ fontSize: 13, color: T.textSecondary, padding: "0 20px" }}>AI builds a reviewable plan from your sources. These options control evidence gathering and later article preparation.</p>
            <div className="ks-ops-grid">
              {ops.map((op, i) => (
                <div
                  key={op.name}
                  role="button" tabIndex={0} aria-pressed={op.on}
                  onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.currentTarget.click(); } }}
                  className={"ks-op" + (op.on ? " on" : "")}
                  onClick={() =>
                    setOps((prev) => prev.map((o, idx) => (idx === i ? { ...o, on: !o.on } : o)))
                  }
                >
                  <span className="ms ks-op-ic">{op.icon}</span>
                  <div className="ks-op-body">
                    <div className="ks-op-name">{op.name}</div>
                    <div className="ks-op-desc">{op.desc}</div>
                  </div>
                  <button
                    type="button"
                    className={"toggle" + (op.on ? " on" : "")}
                    style={{ pointerEvents: "none" }}
                  />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  /* ── Check ── */
  function renderCheckStep() {
    if (pipeline.phase === "running" || pipeline.phase === "idle") {
      return (
        <div className="ks-scroll">
          <div style={{ maxWidth: 720, margin: "0 auto" }}>
            <div className="ks-triage">
              <span className="ms">auto_awesome</span>
              <div>
                <div className="t">Building your plan</div>
                <div className="s">Nothing is created yet. This runs against your knowledge base.</div>
              </div>
            </div>
            <div className="ks-card">
              <LoadingProgress label={pipeline.steps.findLast((s) => s.status === "running")?.name ?? (pipeline.steps.length ? "Saving your plan…" : "Starting your analysis…")} />
              {pipeline.steps.map((s) => (
                <div
                  key={s.name}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    padding: "8px 0",
                    fontSize: 13,
                    color: s.status === "done" ? T.textSecondary : T.textPrimary,
                  }}
                >
                  <span
                    className="ms"
                    style={{
                      fontSize: 18,
                      color: s.status === "done" ? T.success : T.accent,
                    }}
                  >
                    {s.status === "done" ? "check_circle" : "progress_activity"}
                  </span>
                  {s.name}
                </div>
              ))}
            </div>
          </div>
        </div>
      );
    }

    if (pipeline.phase === "error") {
      return (
        <div className="ks-scroll">
          <div style={{ maxWidth: 720, margin: "0 auto" }}>
            <div className="list-empty">
              <span className="ms">error</span>
              <div className="list-empty-title">The plan could not be built</div>
              <div className="list-empty-desc">{pipeline.error}</div>
              <button
                type="button"
                className="ds-btn ds-btn-secondary"
                style={{ marginTop: 16 }}
                onClick={() => setScreen("input")}
              >
                Back to content
              </button>
            </div>
          </div>
        </div>
      );
    }

    return (
      <div className="ks-scroll">
        <div style={{ maxWidth: 1000, margin: "0 auto" }}>
          <div className="ks-triage">
            <span className="ms">insights</span>
            <div>
              <div className="t">{candidates.length} proposals ready to review</div>
              <div className="s">
                Nothing is created yet. This is what we plan to create
                {pipeline.run ? ` · $${pipeline.run.costUsd.toFixed(3)} to analyse` : ""}.
              </div>
            </div>
          </div>
          <div style={{ fontSize: 20, fontWeight: 600, color: T.textPrimary, marginBottom: 4 }}>
            Review the content plan
          </div>
          {pipeline.runId && <p><Link href={`/flow?view=executed&runId=${encodeURIComponent(pipeline.runId)}`} target="_blank">Open executed engine flow</Link></p>}
          <div style={{ fontSize: 14, color: T.textSecondary, lineHeight: 1.5, marginBottom: 20 }}>
            Review the proposed scope and why it matters. Choose what to keep and resolve suggested merges. Templates are confirmed in the next step.
          </div>

          {candidates.length === 0 ? (
            <div className="list-empty">
              <span className="ms">rule</span>
              <div className="list-empty-title">Nothing to create</div>
              <div className="list-empty-desc">The run produced no proposals from that content.</div>
            </div>
          ) : (
            <table className="ltable">
              <thead>
                <tr>
                  <th style={{ width: 36 }}>
                    <div
                      className={"ks-cbx" + (selected.size === candidates.length ? " on" : "")}
                      onClick={() =>
                        setSelected((prev) =>
                          prev.size === candidates.length
                            ? new Set()
                            : new Set(candidates.filter((c) => !c.researchOnly).map((c) => c.key)),
                        )
                      }
                    >
                      <span className="ms">check</span>
                    </div>
                  </th>
                  <th>Proposed topic</th>
                  <th>Suggested template</th>
                  <th>Proposed action</th>
                  <th>Duplicates</th>
                  <th>Why</th>
                  <th style={{ textAlign: "right" }}>Plan</th>
                </tr>
              </thead>
              <tbody>
                {candidates.map((c) => {
                  const top = c.duplicates[0];
                  const idx = c.dupeGroup;
                  const resolution = idx != null ? resolutions[idx] : null;
                  const proposedAction = resolution === "separate" ? (c.targetSolutionId ? "Update" : "New") : c.action;

                  let dupeCell: React.ReactNode;
                  if (idx == null) {
                    dupeCell = top ? (
                      <span className={"ks-dedup " + ksDupTier(top.similarity)}>
                        {top.similarity}%
                      </span>
                    ) : (
                      <span style={{ fontSize: 12, color: T.textSecondary }}>{c.researchOnly || !ops.some((o) => o.name === "Find duplicates" && o.on) ? "Not checked" : "No matches found"}</span>
                    );
                  } else if (resolution === "separate") {
                    dupeCell = (
                      <button
                        type="button"
                        className="ks-dupe-resolved sep"
                        onClick={() => setMergeModal(idx)}
                      >
                        <span className="ms">check_circle</span>Kept separate
                        <span className="ms ks-dupe-resolved-edit">edit</span>
                      </button>
                    );
                  } else if (resolution === "merged") {
                    const survivor = effectiveGroups[idx].members.find((m) => m.retained);
                    dupeCell = (
                      <button
                        type="button"
                        className="ks-dupe-resolved merged"
                        onClick={() => setMergeModal(idx)}
                      >
                        <span className="ms">check_circle</span>Merging into {survivor?.title}
                        <span className="ms ks-dupe-resolved-edit">edit</span>
                      </button>
                    );
                  } else {
                    dupeCell = (
                      <button
                        type="button"
                        className="ks-dupe-trigger"
                        onClick={() => setMergeModal(idx)}
                      >
                        <span className="ms">warning</span>
                        <span className="ks-dupe-trigger-label">
                          {effectiveGroups[idx].averageSimilarity}% · Review
                        </span>
                      </button>
                    );
                  }

                  return (
                    <tr key={c.key} className={selected.has(c.key) ? "sel" : ""}>
                      <td style={{ width: 36 }}>
                        <div
                          className={"ks-cbx" + (selected.has(c.key) ? " on" : "")}
                          onClick={() => toggleSelect(c.key)}
                        >
                          <span className="ms">check</span>
                        </div>
                      </td>
                      <td>
                        <div style={{ fontWeight: 600, color: T.textPrimary }}>{c.title}</div>
                        <div style={{ fontSize: 12, color: T.textSecondary }}>{c.subtitle}</div>
                        {c.researchOnly && <button type="button" className="ds-btn ds-btn-secondary" onClick={() => {
                          setGapQuestion(c.summary ?? c.title); setContentText(""); setSourceContent([{ id: "text-start", type: "text", text: "" }]); setAttachments([]); setKbSelected({});
                          pipeline.reset(); submitRun.reset(); pickPath("gap"); setScreen("input");
                        }}>Research this gap</button>}
                      </td>
                      <td>
                        <span className="ks-tag ks-tag-tmpl">{c.templateName}</span>
                      </td>
                      <td>
                        <span className={"ks-tag " + (ACTION_CLASS[proposedAction] ?? "ks-tag-new")}>
                          {c.researchOnly ? "Research task" : proposedAction === "Merge" && !resolution ? "Review merge" : proposedAction}
                        </span>
                      </td>
                      <td>{dupeCell}</td>
                      <td>
                        <div style={{ fontSize: 12, lineHeight: 1.5, minWidth: 180, maxWidth: 300 }}>{c.why}</div>
                      </td>
                      <td style={{ textAlign: "right" }}>
                        <button
                          type="button"
                          className="icon-btn"
                          title="Review proposal"
                          aria-label={`Review plan for ${c.title}`}
                          onClick={() => setPreview({ title: c.title, candidateKey: c.key })}
                        >
                          <span className="ms">visibility</span>
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    );
  }

  /* ── Duplicate review (Sankey confirm; second screen, after the survivor picker) ── */
  function renderDupeModal() {
    if (dupeModal == null) return null;
    const g = effectiveGroups[dupeModal];
    if (!g) return null;
    const archived = g.members.filter((m) => !m.retained);
    const survivor = g.members.find((m) => m.retained) ?? g.members[0];

    return (
      <div
        className="entity-modal-scrim"
        onClick={(e) => e.target === e.currentTarget && setDupeModal(null)}
      >
        <div
          className="entity-modal"
          role="dialog"
          aria-modal="true"
          style={{ width: 900, maxWidth: "94%", height: "90vh", display: "flex", flexDirection: "column" }}
        >
          <div className="entity-modal-hdr">
            <div className="entity-modal-title">
              <span
                className="ms"
                style={{ verticalAlign: "middle", marginRight: 8, color: T.warningDark }}
              >
                warning
              </span>
              Review duplicates
            </div>
          </div>
          <div
            className="entity-modal-body"
            style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", overflow: "hidden" }}
          >
            <div className="ks-merge-head">
              <span className="ks-tag ks-tag-mrg">Duplicates</span>
              <span style={{ flex: 1 }} />
              <span className="ks-dedup hi">{g.averageSimilarity}% avg</span>
            </div>
            <div className="ks-sankey">
              <div className="ks-sankey-col left">
                {archived.map((m) => (
                  <div key={m.id} className="ks-merge-side archive">
                    <div className="role">
                      <span className="ms">label</span>
                      Will flag as merged
                    </div>
                    <div className="nm">{m.title}</div>
                    <IdChip id={m.id} copyable={isSolutionId(m.id)} />
                    <div className="stat">{m.stat}</div>
                  </div>
                ))}
              </div>
              <svg
                className="ks-sankey-links"
                viewBox="0 0 100 100"
                preserveAspectRatio="none"
                aria-hidden="true"
              >
                {archived.map((m, i) => {
                  const y = ((i + 0.5) / archived.length) * 100;
                  return <path key={m.id} d={`M0,${y} C50,${y} 50,50 100,50`} />;
                })}
              </svg>
              <div className="ks-sankey-col right">
                <div className="ks-merge-side retain">
                  <div className="role">
                    <span className="ms">star</span>
                    Will keep
                  </div>
                  <div className="nm">{survivor.title}</div>
                  <IdChip id={survivor.id} copyable={isSolutionId(survivor.id)} />
                  <div className="stat">{survivor.stat}</div>
                </div>
              </div>
            </div>
            <div className="ks-merge-reason">
              <span className="ms">auto_awesome</span>
              {g.reason}
            </div>
            <div className="ks-merge-xref">
              <span className="ms">info</span>
              The solution you keep holds on to its own URL, ID, history and view counts. The others
              stay in place with a comment recording the merge.
            </div>
          </div>
          <div className="entity-modal-footer" style={{ justifyContent: "space-between" }}>
            <button
              type="button"
              className="ds-btn ds-btn-secondary"
              onClick={() => {
                setDupeModal(null);
                setMergeModal(dupeModal);
              }}
            >
              <span className="ms" style={{ fontSize: 18 }}>
                arrow_back
              </span>
              Back
            </button>
            <button
              type="button"
              className="ds-btn ds-btn-primary"
              onClick={() => resolveGroup(dupeModal, "merged", `Merging into ${survivor.title}`)}
            >
              <span className="ms" style={{ fontSize: 18 }}>
                merge
              </span>
              Merge {g.members.length} into one
            </button>
          </div>
        </div>
      </div>
    );
  }

  /* ── Metadata ── */
  function renderMetadataStep() {
    const availRules = KS_CS_ALL_RULES.filter((r) => !csRules.includes(r));
    return (
      <div className="ks-scroll">
        <div style={{ maxWidth: 880, margin: "0 auto" }}>
          <div style={{ fontSize: 20, fontWeight: 600, color: T.textPrimary, marginBottom: 4 }}>
            Set metadata
          </div>
          <div style={{ fontSize: 14, color: T.textSecondary, lineHeight: 1.5, marginBottom: 20 }}>
            Confirm the final templates and shared fields. Submission prepares new articles with summary, keywords and relevant template fields. Restructuring controls rewriting.
          </div>

          {metaError && (
            <div className="ks-merge-warn" style={{ marginBottom: 16 }}>
              <span className="ms">error</span>
              Couldn&apos;t load options from RightAnswers: {metaError}
            </div>
          )}

          {(templateOptions.length > 0 || showMetadataEditor) && (
            <div className="ks-card">
              <div className="ks-meta-group">
                <span className="ms">auto_awesome</span>Suggested from your knowledge base
              </div>
              {showMetadataEditor && pipeline.runId && meta && <PipelineMetadata enabled={metadataEnabled} runId={pipeline.runId} snapshot={snapshot} plan={proposedWritePlan.plan} options={meta} value={metadataSettings} onChange={setMetadataSettings} onBusy={setMetadataBusy} />}
              <div className="ks-meta-grid">
                <div className="form-field">
                  <div className="form-label">Template</div>
                  <DsDropdown
                    value={newSolutionTemplate ?? templateOptions[0]}
                    options={templateOptions}
                    onChange={applyGlobalTemplate}
                  />
                  <div style={{ fontSize: 11, color: T.textSecondary, marginTop: 4 }}>
                    Applies to every new solution below that hasn&apos;t been overridden.
                  </div>
                </div>
              </div>
            </div>
          )}

          <div className="ks-card">
            <div className="ks-meta-group man">
              <span className="ms">edit_note</span>Required before publishing
            </div>
            <div className="ks-meta-grid">
              <div className="form-field">
                <div className="form-label">
                  Collection <span className="req">*</span>
                </div>
                {showMetadataEditor ? <p>Use the global and per-solution collection choices above.</p> : <DsDropdown
                  value={metaFields.Collection}
                  options={collectionOptions}
                  onChange={(v) => setMetaFields((p) => ({ ...p, Collection: v }))}
                />}
              </div>
              <div className="form-field">
                <div className="form-label">
                  Language <span className="req">*</span>
                </div>
                {showMetadataEditor ? <p>Use the global and per-solution language choices above.</p> : <DsDropdown
                  value={metaFields.Language}
                  options={languageOptions}
                  onChange={(v) => setMetaFields((p) => ({ ...p, Language: v }))}
                />}
              </div>
              <div className="form-field">
                <div className="form-label">
                  Owner <span className="req">*</span>
                </div>
                <div className="dsdd">
                  <button
                    type="button"
                    className="dsdd-trigger"
                    style={{ pointerEvents: "none", background: "#F1F3F3", color: "#6B7786" }}
                  >
                    <span className="dsdd-value">{metaFields.Owner}</span>
                    <span className="ms">lock</span>
                  </button>
                </div>
                <div style={{ fontSize: 11, color: T.textSecondary, marginTop: 4 }}>
                  Acting RightAnswers author for this session.
                </div>
              </div>
              <div className="form-field">
                <div className="form-label">Review date</div>
                <div className="dsdd">
                  <button
                    type="button"
                    className="dsdd-trigger"
                    style={{ pointerEvents: "none", background: "#F1F3F3", color: "#6B7786" }}
                  >
                    <span className="dsdd-value">Managed in RightAnswers</span>
                    <span className="ms">lock</span>
                  </button>
                </div>
                <div style={{ fontSize: 11, color: T.textSecondary, marginTop: 4 }}>
                  Not writable through the API.
                </div>
              </div>
            </div>
          </div>

          <div className="ks-card">
            <div style={{ display: "flex", flexDirection: "column", gap: 14, alignItems: "flex-start" }}>
              <span
                className="section-lbl"
                style={{
                  fontSize: 12,
                  fontWeight: 500,
                  textTransform: "uppercase",
                  color: T.textSecondary,
                }}
              >
                Content standards
              </span>
              <div style={{ width: 260, maxWidth: "100%" }}>
                <DsDropdown
                  value={csStandard}
                  options={Object.keys(KS_CS_PRESETS)}
                  onChange={(v) => {
                    setCsStandard(v);
                    setCsRules([...KS_CS_PRESETS[v]]);
                  }}
                />
                <div style={{ fontSize: 11, color: T.textSecondary, marginTop: 4 }}>
                  Applied to final content on submit, including merges.
                </div>
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
                {csRules.map((r) => (
                  <span key={r} className="ks-cs-chip">
                    {r}
                    <button type="button" onClick={() => setCsRules((p) => p.filter((x) => x !== r))}>
                      <span className="ms">cancel</span>
                    </button>
                  </span>
                ))}
                <KsAddRuleMenu options={availRules} onPick={(r) => setCsRules((p) => [...p, r])} />
              </div>
            </div>
          </div>

          <div
            className="section-lbl"
            style={{
              fontSize: 12,
              fontWeight: 500,
              textTransform: "uppercase",
              color: T.textSecondary,
              marginBottom: 8,
            }}
          >
            Per-solution template
          </div>
          {candidates.map((c) => {
            if (isSolutionId(c.key)) {
              return (
                <div className="ks-ovr-row" key={c.key}>
                  <div className="ks-ovr-row-main">
                    <span className="ks-ovr-row-name">{c.title}</span>
                    <span className="ks-ovr-row-status active">
                      <span className="ms">description</span>
                      {c.templateName}
                    </span>
                  </div>
                </div>
              );
            }

            const overridden = templateOverrides.has(c.key);
            const open = !!templateEditOpen[c.key];
            return (
              <div className="ks-ovr-row" key={c.key}>
                <div className="ks-ovr-row-main">
                  <span className="ks-ovr-row-name">{c.title}</span>
                  <span className={`ks-ovr-row-status${overridden ? " active" : ""}`}>
                    <span className="ms">{overridden ? "tune" : "link"}</span>
                    {overridden ? c.templateName : `Same as above (${c.templateName})`}
                  </span>
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label={`Edit template for ${c.title}`}
                    onClick={() => setTemplateEditOpen((p) => ({ ...p, [c.key]: !p[c.key] }))}
                  >
                    <span className="ms">edit</span>
                  </button>
                </div>
                {open && (
                  <div className="ks-ovr-panel">
                    <div style={{ width: 260, maxWidth: "100%" }}>
                      <DsDropdown
                        value={c.templateName}
                        options={templateOptions}
                        onChange={(v) => overrideTemplate(c.key, v)}
                      />
                    </div>
                    <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
                      <button
                        type="button"
                        className="ds-btn ds-btn-secondary"
                        disabled={!overridden}
                        style={{ opacity: overridden ? 1 : 0.5 }}
                        onClick={() => resetTemplateOverride(c.key)}
                      >
                        Reset to same as above
                      </button>
                      <button
                        type="button"
                        className="ds-btn ds-btn-primary"
                        onClick={() => setTemplateEditOpen((p) => ({ ...p, [c.key]: false }))}
                      >
                        Done
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  /* ── Submit ── */
  function renderSubmitStep() {
    return <div className="ks-scroll sg-page">
      <div className="sg-page-heading"><div><span className="sg-eyebrow">Review and submit</span><h1>{allWritten ? "Submission complete" : "See what your content becomes"}</h1>
        <p>{allWritten ? "The saved results below show what was written to RightAnswers." : "Follow each source to its destination. Prepare the drafts, review the final articles, then submit for approval."}</p></div>
        {pipeline.runId && <Link className="ds-btn ds-btn-secondary" href={`/flow?view=executed&runId=${encodeURIComponent(pipeline.runId)}`} target="_blank">Open recorded engine flow</Link>}
      </div>
      <div className="sg-phase-strip" aria-live="polite"><span className={submitRun.phase === "idle" ? "active" : ""}>1 · Review plan</span><span className={submitRun.phase === "preparing" ? "active" : ""}>2 · Prepare drafts</span><span className={draftsReady && !allWritten ? "active" : ""}>3 · Review final articles</span><span className={submitRun.phase === "submitting" || allWritten ? "active" : ""}>4 · Submit</span></div>
      {submitRun.locked && <p className={allWritten ? "ks-card" : "sg-warning"} role="status">{completion.message} {allWritten ? "Your execution is saved in Past executions. You can finish now." : completion.uncertain ? "A write needs verification in RightAnswers before continuing. See the verification section below; completed writes will not be sent again." : "Only unfinished operations will be retried."}</p>}
      {submitRun.error && <p className="sg-warning" role="alert">{submitRun.error}</p>}
      {proposedWritePlan.error && !submitRun.locked && <p role="alert">{proposedWritePlan.error}</p>}
      {submitRun.identity && !preparedMatches && !submitRun.locked && <p className="sg-warning">The plan or metadata changed. Prepare the updated drafts before submitting.</p>}
      {draftEditing && <p className="sg-warning">Save or cancel your article edits before changing the plan or submitting.</p>}
      {submissionBusy && <div className="ks-card"><LoadingProgress key={submitRun.phase} label={submitRun.phase === "preparing" ? "Preparing drafts — no articles are being written to RightAnswers." : "Writing the reviewed drafts to RightAnswers…"} /></div>}
      <SubmissionGraph templates={templateOptions} model={submissionGraph} busy={submissionBusy} currentKey={submitRun.currentKey} mode={submitRun.phase === "preparing" ? "preparation" : submitRun.locked ? "submission" : "preparation"}
        onSave={(key, review) => prepareCurrent({ [key]: review })} onDirtyChange={setDraftEditing}
        onChangePlan={!submitRun.locked ? () => setScreen("check") : undefined} flowHref={`/flow?view=executed&runId=${encodeURIComponent(pipeline.runId ?? "")}`} />
      {displayResults.some((r) => r.outcome === "uncertain") && <section id="pending-write-verification"><SubmissionReview runId={pipeline.runId ?? ""} results={displayResults.filter((r) => r.outcome === "uncertain")} onRetry={() => prepareCurrent()} /></section>}
      {submitRun.costUsd != null && <p className="sg-cost">Recorded AI cost: ${submitRun.costUsd.toFixed(4)}</p>}
    </div>;
  }

  function renderPreviewModal() {
    if (!preview) return null;
    const proposal = candidates.find((c) => c.key === preview.candidateKey);
    return (
      <div
        className="entity-modal-scrim"
        onClick={(e) => e.target === e.currentTarget && setPreview(null)}
      >
        <div className="entity-modal ks-preview-modal" role="dialog" aria-modal="true" aria-label={preview.candidateKey ? "Content proposal" : "Article preview"}>
          <div className="entity-modal-hdr">
            <div className="entity-modal-title">{preview.candidateKey ? "Content proposal" : "Article preview"}</div>
          </div>
          <div className="entity-modal-body">
            <div style={{ fontSize: 16, fontWeight: 600, color: T.textPrimary, marginBottom: 12 }}>
              {preview.title}
            </div>
            {proposal ? <ProposalPreview candidate={proposal} group={proposal.dupeGroup != null ? effectiveGroups[proposal.dupeGroup] : undefined} resolution={proposal.dupeGroup != null ? resolutions[proposal.dupeGroup] : undefined} duplicatesChecked={ops.some((o) => o.name === "Find duplicates" && o.on)} /> : <ArticlePreview article={{ title: preview.title, ...preview.article }} />}
          </div>
          <div className="entity-modal-footer">
            <button type="button" className="ds-btn ds-btn-secondary" onClick={() => setPreview(null)}>
              Close
            </button>
          </div>
        </div>
      </div>
    );
  }

  let bodyNode: React.ReactNode = null;
  let footer: React.ReactNode = null;

  if (screen === "input") {
    bodyNode = renderInputScreen();
    if (path) {
      footer = (
        <div className="ks-sticky-footer">
          <span className="ks-foot-status">
            {ops.filter((o) => o.on).length} of {ops.length} options on
          </span>
          <div className="ks-foot-actions">
            <button type="button" className="ds-btn ds-btn-primary" disabled={sourcesBusy || !sessionReady || pipeline.phase === "running" || autoStarting} onClick={createPlan}>
              <span className="ms" style={{ fontSize: 18 }}>
                bolt
              </span>
              {autoStarting ? "Starting…" : autoMode ? "Start autonomous run" : "Create plan"}
            </button>
          </div>
        </div>
      );
    }
  } else if (screen === "check") {
    bodyNode = renderCheckStep();
    footer = (
      <div className="ks-sticky-footer">
        <span className="ks-foot-status">
          {pipeline.phase === "done" ? (
            <>
              <span className="ms" style={{ color: gate.ok ? T.success : T.warningDark }}>
                {gate.ok ? "check_circle" : "warning"}
              </span>
              {gate.msg}
            </>
          ) : (
            pipeline.phase === "error" ? "Analysis stopped — return to content to retry" : "Analysing your content…"
          )}
        </span>
        <div className="ks-foot-actions">
          <button
            type="button"
            className="ds-btn ds-btn-secondary"
            disabled={pipeline.phase === "running"}
            onClick={() => {
              pipeline.reset();
              setScreen("input");
            }}
          >
            <span className="ms" style={{ fontSize: 18 }}>
              arrow_back
            </span>
            Back
          </button>
          <button
            type="button"
            className="ds-btn ds-btn-primary"
            disabled={pipeline.phase !== "done" || !gate.ok}
            style={{ opacity: pipeline.phase === "done" && gate.ok ? 1 : 0.5 }}
            onClick={() => setScreen("metadata")}
          >
            Next: metadata
            <span className="ms" style={{ fontSize: 18 }}>
              arrow_forward
            </span>
          </button>
        </div>
      </div>
    );
  } else if (screen === "metadata") {
    bodyNode = renderMetadataStep();
    footer = (
      <div className="ks-sticky-footer">
        <span className="ks-foot-status">Global defaults apply unless a solution has its own settings</span>
        <div className="ks-foot-actions">
          <button type="button" className="ds-btn ds-btn-secondary" onClick={() => setScreen("check")}>
            <span className="ms" style={{ fontSize: 18 }}>
              arrow_back
            </span>
            Back
          </button>
          <button type="button" className="ds-btn ds-btn-primary" disabled={metadataBusy} onClick={() => setScreen("submit")}>
            <span className="ms" style={{ fontSize: 18 }}>
              bolt
            </span>
            Review changes
          </button>
        </div>
      </div>
    );
  } else if (screen === "submit") {
    bodyNode = renderSubmitStep();
    const canPrepare = gate.ok && displayPlan.length > 0 && !!metaFields.Collection && !metadataBusy && !submissionBusy && !draftEditing && !allWritten;
    footer = <div className="ks-sticky-footer">
      <span className="ks-foot-status">{allWritten ? "Submission complete — nothing published" : completion.uncertain ? "Verify the pending write below before continuing." : submitRun.locked ? completion.message : draftEditing ? "Unsaved article edits" : draftsReady ? "Review the final articles before sending them for approval." : "Preparing drafts saves them here; it does not write to RightAnswers."}</span>
      <div className="ks-foot-actions">
        {!submitRun.locked && <button type="button" className="ds-btn ds-btn-secondary" disabled={submissionBusy || draftEditing} onClick={() => setScreen("metadata")}>Back to metadata</button>}
        {allWritten && <button type="button" className="ds-btn ds-btn-primary" disabled={submissionBusy} onClick={() => resetAll(true)}>Finish</button>}
        {!allWritten && <>
          <button type="button" className="ds-btn ds-btn-secondary" disabled={!canPrepare} onClick={() => prepareCurrent()}>{submitRun.phase === "preparing" ? "Preparing…" : draftsReady ? "Refresh draft status" : "Prepare drafts"}</button>
          {completion.uncertain ? <button type="button" className="ds-btn ds-btn-primary" disabled={submissionBusy || draftEditing} onClick={() => document.getElementById("pending-write-verification")?.scrollIntoView({ block: "start" })}>Verify pending writes</button> : <button type="button" className="ds-btn ds-btn-primary" disabled={!draftsReady || submissionBusy || draftEditing} onClick={submitCurrent}>{submitRun.phase === "submitting" ? "Submitting…" : completion.submitLabel}</button>}
        </>}
      </div>
    </div>;
  }


  if (autoJob) return <AutonomousRun key={autoJob} runId={autoJob} onClose={closeAuto} />;

  return (
    <div className="ks-wizard">
      <div id="page-hdr">
        <div className="page-title">Knowledge Studio</div>
        <Link className="ds-btn ds-btn-secondary" href="/metadata-lab" target="_blank">Metadata lab</Link>
        <Link className="ds-btn ds-btn-secondary" href={flowHref} target="_blank">Explore engine flow</Link>
        <SignOutButton />
        <button type="button" className="ds-btn ds-btn-secondary" disabled={sourcesBusy || pipeline.phase === "running" || submissionBusy || draftEditing} onClick={() => resetAll()}>
          <span className="ms" style={{ fontSize: 18 }}>
            restart_alt
          </span>
          Start over
        </button>
      </div>
      <KsStepper
        activeId={stepperActiveId}
        doneIds={doneIds}
        helpers={{
          check: candidates.length ? `${selected.size} of ${candidates.length} proposals` : pipeline.phase === "running" ? "Building plan" : "Review plan",
        }}
        onJump={(id) => {
          if (sourcesBusy || pipeline.phase === "running" || submissionBusy || draftEditing) return;
          if (submitRun.locked) { setScreen("submit"); return; }
          // Later steps only make sense once a plan exists.
          if (id !== "input" && pipeline.phase !== "done") return;
          setScreen(id);
        }}
      />
      {screen === "input" && gapQuestion && <div className="ks-card"><strong>Research question: {gapQuestion}</strong><p>Add verified answer material below, then analyze it as a new draft.</p></div>}
      {pipeline.run?.warnings?.map((warning, i) => <div className="ks-merge-warn" key={i}>{warning}</div>)}
      {bodyNode}
      {footer}
      {mergeModal != null && effectiveGroups[mergeModal] && (
        <MergeWorkspaceModal
          group={effectiveGroups[mergeModal]}
          onCancel={() => setMergeModal(null)}
          onKeepSeparate={() => resolveGroup(mergeModal, "separate", "Kept separate")}
          onContinue={(survivorId) => {
            setSurvivorChoice((prev) => ({ ...prev, [mergeModal]: survivorId }));
            setMergeModal(null);
            setDupeModal(mergeModal);
          }}
        />
      )}
      {renderDupeModal()}
      {renderPreviewModal()}
      {toast && (
        <Snackbar onDismiss={dismissToast} icon={toast.icon}>
          {toast.message}
        </Snackbar>
      )}
    </div>
  );
}

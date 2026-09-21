"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import styles from "./SolutionView.module.css";
import { GroundContextCard, GroundContextEvidence, GroundContextPicker } from "./GroundContext";
import { emptyGroundContext, type GroundContextSelection } from "@/lib/ks/ground-context-demo";
import type { SolutionReview, SolutionReviewDefinition } from "@/lib/ks/solution-reviews";
import type { WSSolution } from "@/lib/ra/types";
import type { KbSearchRow } from "@/app/api/kb/search/route";

const initial = {
  title: "Connect to the corporate VPN",
  summary: "Learn how to connect to the corporate network securely when working remotely, and resolve common VPN connection issues.",
  keywords: "VPN, remote access, network, connection",
  fields: [
    { name: "Overview", value: "Use the corporate VPN to access internal applications and shared resources while working outside the office." },
    { name: "Before you begin", value: "An active employee account, the approved VPN client, and your multi-factor authentication device are required." },
    { name: "Resolution", value: "1. Open the corporate VPN client.\n2. Select the Corporate network profile.\n3. Enter your employee credentials.\n4. Approve the multi-factor authentication request.\n5. Wait for the Connected status before opening internal applications." },
    { name: "Troubleshooting", value: "If the connection fails, check your internet connection and try again. Contact the IT service desk if the issue persists." },
  ],
};

const suggestions = {
  title: { label: "Title", value: "How to connect to the corporate VPN", reason: "Use a task-oriented title that matches the question a reader would search for." },
  summary: { label: "Summary", value: "Connect to the corporate VPN to access internal applications remotely. Follow the setup steps, verify your connection, and troubleshoot common connection issues.", reason: "Describe the task, expected outcome, and troubleshooting coverage in two short sentences." },
  keywords: { label: "Keywords", value: "VPN, remote access, corporate network, multi-factor authentication, VPN troubleshooting", reason: "Include terminology from the article to help readers find this solution." },
  fields: { label: "Fields", value: "If the connection fails:\n1. Confirm that your internet connection is working.\n2. Retry the VPN connection and complete the authentication request.\n3. If the issue persists, contact the IT service desk.", reason: "Turn the troubleshooting paragraph into a clear sequence of actions." },
};

const reviewFindings = [
  {
    id: "gap",
    icon: "find_in_page",
    title: "Knowledge gaps",
    badge: "1 missing answer",
    description: "The solution does not explain what to do when the multi-factor authentication request never arrives.",
    action: "Fix knowledge gap",
    proposal: "Add a troubleshooting section",
    detail: "Cover missing authentication requests, retry steps, and when to contact the service desk. Ask the identity team to verify the recovery procedure before publishing.",
    destination: "SOL-1042 · Troubleshooting",
  },
  {
    id: "duplicate",
    icon: "difference",
    title: "Duplications",
    badge: "1 potential duplicate",
    description: "SOL-0987, “Remote access with VPN,” covers the same connection steps as this solution.",
    action: "Fix duplications",
    proposal: "Merge overlapping solutions",
    detail: "Keep SOL-1042 as the primary solution, bring over any unique troubleshooting guidance from SOL-0987, and review the combined article before retiring the duplicate.",
    destination: "SOL-0987 → SOL-1042",
  },
];

type Suggestion = keyof typeof suggestions;
type Panel = "assist" | "review" | "create";
type DuplicatePreview = {
  solutionId: string; title: string; summary: string; author: string; status: string; collections: string[]; viewCount: number;
  verdict: "duplicate" | "overlapping" | "distinct"; similarity: number; rationale: string; sharedTopics: string[];
};
type DuplicateScope = "knowledge-base" | "selected";
function Icon({ name }: { name: string }) {
  return <span className="ms" aria-hidden="true">{name}</span>;
}

function articleFromSolution(solution: WSSolution) {
  return {
    title: solution.title,
    summary: solution.summary ?? "",
    keywords: solution.keywords ?? "",
    fields: (solution.fields ?? []).map(field => ({ name: field.name, value: field.content })),
  };
}

export default function SolutionView({ solutionId, connectionId }: { solutionId?: string; connectionId?: string }) {
  const router = useRouter();
  const [solutionQuery, setSolutionQuery] = useState("");
  const [solutionRows, setSolutionRows] = useState<KbSearchRow[]>([]);
  const [searchingSolutions, setSearchingSolutions] = useState(false);
  const [solutionSearchError, setSolutionSearchError] = useState("");
  const [article, setArticle] = useState(initial);
  const [source, setSource] = useState<WSSolution | null>(null);
  const [sourceConnectionId, setSourceConnectionId] = useState(connectionId);
  const [sourceVersion, setSourceVersion] = useState<string | null>(null);
  const [sourceError, setSourceError] = useState<string | null>(null);
  const [loadingSource, setLoadingSource] = useState(Boolean(solutionId));
  const [launching, setLaunching] = useState(false);
  const [panel, setPanel] = useState<Panel>("assist");
  const [activeSuggestion, setActiveSuggestion] = useState<Suggestion>("title");
  const [applied, setApplied] = useState<Suggestion[]>([]);
  const [preview, setPreview] = useState(false);
  const [notice, setNotice] = useState("");
  const [format, setFormat] = useState("FAQ");
  const [generated, setGenerated] = useState(false);
  const [reviewPlan, setReviewPlan] = useState<string[]>([]);
  const [reviewDefinitions, setReviewDefinitions] = useState<SolutionReviewDefinition[]>([]);
  const [reviewResults, setReviewResults] = useState<Record<string, SolutionReview>>({});
  const [selectedReviewFindings, setSelectedReviewFindings] = useState<Record<string, number[]>>({});
  const [reviewName, setReviewName] = useState("");
  const [reviewObjective, setReviewObjective] = useState("");
  const [loadingReviews, setLoadingReviews] = useState(false);
  const [creatingReview, setCreatingReview] = useState(false);
  const [runningReviewId, setRunningReviewId] = useState<string | null>(null);
  const [runningAllReviews, setRunningAllReviews] = useState(false);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [groundContext, setGroundContext] = useState<GroundContextSelection>(emptyGroundContext);
  const [groundPickerOpen, setGroundPickerOpen] = useState(false);
  const [reviewModalOpen, setReviewModalOpen] = useState(false);
  const [duplicateModalOpen, setDuplicateModalOpen] = useState(false);
  const [duplicateScope, setDuplicateScope] = useState<DuplicateScope>("knowledge-base");
  const [duplicateResults, setDuplicateResults] = useState<DuplicatePreview[]>([]);
  const [selectedDuplicateIds, setSelectedDuplicateIds] = useState<string[]>([]);
  const [ignoredDuplicateIds, setIgnoredDuplicateIds] = useState<string[]>([]);
  const [duplicateTab, setDuplicateTab] = useState<"duplicates" | "ignored">("duplicates");
  const [duplicateLoading, setDuplicateLoading] = useState(false);
  const [duplicateError, setDuplicateError] = useState("");
  const [duplicateLaunching, setDuplicateLaunching] = useState(false);
  useEffect(() => {
    if (!solutionId) return;
    let cancelled = false;
    const query = new URLSearchParams({ id: solutionId });
    if (connectionId) query.set("connectionId", connectionId);
    fetch(`/api/solution-view?${query}`)
      .then(async response => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error ?? "Unable to load solution");
        return data as { solution: WSSolution; connectionId: string; version: string };
      })
      .then(data => {
        if (cancelled) return;
        setSource(data.solution); setArticle(articleFromSolution(data.solution));
        setSourceConnectionId(data.connectionId); setSourceVersion(data.version);
      })
      .catch((error: Error) => !cancelled && setSourceError(error.message))
      .finally(() => !cancelled && setLoadingSource(false));
    return () => { cancelled = true; };
  }, [solutionId, connectionId]);
  useEffect(() => {
    if (solutionId || !solutionQuery.trim()) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setSearchingSolutions(true); setSolutionSearchError("");
      try {
        const query = new URLSearchParams({ q: solutionQuery.trim() });
        if (connectionId) query.set("connectionId", connectionId);
        const response = await fetch(`/api/kb/search?${query}`, { signal: controller.signal });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error ?? "Unable to search solutions");
        if (!controller.signal.aborted) setSolutionRows(data.rows as KbSearchRow[]);
      } catch (error) {
        if (!controller.signal.aborted) setSolutionSearchError(error instanceof Error ? error.message : "Unable to search solutions");
      } finally { if (!controller.signal.aborted) setSearchingSolutions(false); }
    }, 300);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [solutionId, solutionQuery, connectionId]);
  useEffect(() => {
    if (!source) return;
    let cancelled = false;
    queueMicrotask(() => { if (!cancelled) { setLoadingReviews(true); setReviewError(null); } });
    const query = sourceConnectionId ? `?connectionId=${encodeURIComponent(sourceConnectionId)}` : "";
    const reviewsQuery = new URLSearchParams({ solutionId: source.id });
    if (sourceConnectionId) reviewsQuery.set("connectionId", sourceConnectionId);
    Promise.all([
      fetch(`/api/solution-review-definitions${query}`).then(async response => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error ?? "Unable to load review definitions");
        return data as { definitions: SolutionReviewDefinition[] };
      }),
      fetch(`/api/solution-reviews?${reviewsQuery}`).then(async response => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error ?? "Unable to load saved reviews");
        return data as { reviews: SolutionReview[] };
      }),
    ])
      .then(([definitions, savedReviews]) => {
        if (cancelled) return;
        setReviewDefinitions(definitions.definitions);
        setReviewResults(Object.fromEntries(savedReviews.reviews.filter(review => review.status === "completed").filter((review, index, all) => all.findIndex(item => item.definition.id === review.definition.id) === index).map(review => [review.definition.id, review])));
      })
      .catch((error: Error) => !cancelled && setReviewError(error.message))
      .finally(() => !cancelled && setLoadingReviews(false));
    return () => { cancelled = true; };
  }, [source, sourceConnectionId]);
  function changeGroundContext(value: GroundContextSelection) {
    setGroundContext(value);
    setGenerated(false);
  }

  function openSolution(id: string) {
    const selectedConnection = sourceConnectionId || connectionId;
    const query = selectedConnection ? `?connectionId=${encodeURIComponent(selectedConnection)}` : "";
    router.push(`/ai-solution-view/${id}${query}`);
  }

  async function openKnowledgeCreation() {
    if (!source?.id) { router.push("/"); return; }
    setLaunching(true);
    try {
      const response = await fetch("/api/solution-launches", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ solutionId: source.id, connectionId: sourceConnectionId }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Unable to open Knowledge Studio");
      router.push(`/?launch=${encodeURIComponent(data.launch.id)}`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Unable to open Knowledge Studio");
      setLaunching(false);
    }
  }
  async function openDuplicateStudio(targeted = false) {
    if (!source) return;
    const selectedIds = selectedDuplicateIds.filter((id) => !ignoredDuplicateIds.includes(id));
    if (targeted && !selectedIds.length) { setDuplicateError("Select at least one solution to run a targeted comparison."); return; }
    setDuplicateLaunching(true);
    try {
      const sourceSolutionIds = targeted ? [source.id, ...selectedIds] : [source.id];
      const response = await fetch("/api/solution-launches", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ solutionId: source.id, connectionId: sourceConnectionId, sourceSolutionIds, duplicateScopeIds: targeted ? sourceSolutionIds : undefined, operations: ["Find duplicates"] }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Unable to open duplicate detection");
      router.push(`/?launch=${encodeURIComponent(data.launch.id)}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to open duplicate detection";
      setDuplicateError(message); setNotice(message);
    } finally { setDuplicateLaunching(false); }
  }
  async function runDuplicateDetection(candidateIds?: string[]) {
    if (!source || duplicateLoading) return;
    setDuplicateLoading(true); setDuplicateError(""); setDuplicateTab("duplicates");
    try {
      const response = await fetch("/api/solution-duplicates", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ solutionId: source.id, connectionId: sourceConnectionId, candidateIds }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Duplicate detection could not finish");
      setDuplicateScope(data.scope as DuplicateScope);
      setDuplicateResults(data.matches as DuplicatePreview[]);
    } catch (error) { setDuplicateError(error instanceof Error ? error.message : "Duplicate detection could not finish"); }
    finally { setDuplicateLoading(false); }
  }
  function openDuplicateModal() {
    if (!source) { setNotice("Open a saved solution before checking for duplicates."); return; }
    setDuplicateModalOpen(true); setDuplicateResults([]); setSelectedDuplicateIds([]); setIgnoredDuplicateIds([]); setDuplicateScope("knowledge-base");
    void runDuplicateDetection();
  }
  function toggleDuplicateSelection(id: string) {
    setSelectedDuplicateIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  }
  async function createReviewDefinition(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!source) { setReviewError("Open a saved solution before creating a customer review."); return; }
    setCreatingReview(true); setReviewError(null);
    try {
      const response = await fetch("/api/solution-review-definitions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ connectionId: sourceConnectionId, name: reviewName, objective: reviewObjective }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Unable to save review definition");
      setReviewDefinitions(current => [data.definition as SolutionReviewDefinition, ...current]);
      setReviewName(""); setReviewObjective(""); setNotice("Customer review saved. Run it when you are ready.");
    } catch (error) { setReviewError(error instanceof Error ? error.message : "Unable to save review definition"); }
    finally { setCreatingReview(false); }
  }
  async function runReview(definition: SolutionReviewDefinition) {
    if (!source) return;
    setRunningReviewId(definition.id); setReviewError(null);
    try {
      const response = await fetch("/api/solution-reviews", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ connectionId: sourceConnectionId, solutionId: source.id, definitionId: definition.id }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Unable to run review");
      setReviewResults(current => ({ ...current, [definition.id]: data.review as SolutionReview }));
      setSelectedReviewFindings(current => ({ ...current, [definition.id]: [] }));
      setNotice(`${definition.name} completed. Findings are read-only until you choose a Knowledge Studio workflow.`);
    } catch (error) { setReviewError(error instanceof Error ? error.message : "Unable to run review"); }
    finally { setRunningReviewId(null); }
  }
  async function runAllReviews() {
    if (!source || !reviewDefinitions.length || runningAllReviews) return;
    setRunningAllReviews(true); setReviewError(null);
    for (const definition of reviewDefinitions) await runReview(definition);
    setRunningAllReviews(false);
    setNotice(`Completed ${reviewDefinitions.length} customer review${reviewDefinitions.length === 1 ? "" : "s"}. Select the findings you want to use in Knowledge Studio.`);
  }
  function toggleReviewFinding(definitionId: string, index: number) {
    setSelectedReviewFindings(current => {
      const selected = new Set(current[definitionId] ?? []);
      if (selected.has(index)) selected.delete(index); else selected.add(index);
      return { ...current, [definitionId]: [...selected].sort((a, b) => a - b) };
    });
  }
  function selectAllReviewFindings() {
    setSelectedReviewFindings(Object.fromEntries(Object.entries(reviewResults).filter(([, review]) => !!review.result).map(([definitionId, review]) => [definitionId, review.result!.findings.map((_, index) => index)])));
  }
  async function openSelectedReviewHandoff() {
    const selections = Object.values(reviewResults).map(review => ({ reviewId: review.id, selectedFindingIndexes: selectedReviewFindings[review.definition.id] ?? [] })).filter(selection => selection.selectedFindingIndexes.length);
    if (!selections.length) { setReviewError("Select at least one finding to use in Knowledge Studio."); return; }
    setRunningAllReviews(true); setReviewError(null);
    try {
      const response = await fetch("/api/solution-review-handoffs", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ selections }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Unable to open Knowledge Studio");
      router.push(`/?reviewHandoff=${encodeURIComponent(data.handoff.id)}`);
    } catch (error) { setReviewError(error instanceof Error ? error.message : "Unable to open Knowledge Studio"); }
    finally { setRunningAllReviews(false); }
  }
  function renderConfiguredReviews() {
    const completedReviews = Object.values(reviewResults).filter(review => !!review.result);
    const selectedCount = completedReviews.reduce((count, review) => count + (selectedReviewFindings[review.definition.id] ?? []).length, 0);
    const totalCount = completedReviews.reduce((count, review) => count + (review.result?.findings.length ?? 0), 0);
    return <>
      {reviewError && <div className={styles.note} role="alert"><Icon name="error" /><p>{reviewError}</p></div>}
      <div className={styles.reviewDefinitions}>
        <div className={styles.reviewDefinitionHeading}><strong>Customer reviews</strong><span className={styles.reviewActions}>{loadingReviews && <Icon name="progress_activity" />}<button type="button" className={styles.secondary} disabled={loadingReviews || runningAllReviews || runningReviewId !== null || reviewDefinitions.length === 0} onClick={runAllReviews}><Icon name="fact_check" />{runningAllReviews ? "Running all…" : "Run all reviews"}</button></span></div>
        {reviewDefinitions.length === 0 && !loadingReviews && <p className={styles.emptyReview}>No customer review is configured for this connection yet.</p>}
        {reviewDefinitions.map(definition => {
          const result = reviewResults[definition.id];
          return (
            <section className={styles.reviewDefinition} key={definition.id}>
              <div><strong>{definition.name}</strong><p>{definition.objective}</p></div>
              <button type="button" className={styles.secondary} disabled={runningAllReviews || runningReviewId === definition.id} onClick={() => runReview(definition)}><Icon name="fact_check" />{runningReviewId === definition.id ? "Reviewing…" : result ? "Run again" : "Run review"}</button>
              {result?.result && <div className={styles.reviewResult}>
                <p><strong>{result.result.summary}</strong></p>
                {result.result.findings.map((finding, index) => <article key={`${result.id}-${index}`} className={styles.reviewCard}>
                  <div className={styles.findingHeading}><Icon name="fact_check" /><h4>{finding.title}</h4></div><span className={styles.findingBadge}>{finding.severity}</span>
                  <label className={styles.findingSelect}><input type="checkbox" checked={(selectedReviewFindings[definition.id] ?? []).includes(index)} onChange={() => toggleReviewFinding(definition.id, index)} />Use this finding in Knowledge Studio</label>
                  <p>{finding.summary}</p><p><strong>Recommendation:</strong> {finding.recommendation}</p>
                  {finding.evidence.map((evidence, evidenceIndex) => <p className={styles.evidence} key={evidenceIndex}><strong>{evidence.fieldName}:</strong> “{evidence.quote}”</p>)}
                </article>)}
                {result.result.limitations.length > 0 && <p className={styles.limitations}><strong>Limitations:</strong> {result.result.limitations.join(" ")}</p>}
              </div>}
            </section>
          );
        })}
      </div>
      <form className={styles.reviewForm} onSubmit={createReviewDefinition}>
        <strong>Add customer review</strong><p>Define the desired analysis. It can shape review scope, but it cannot add tools or writing permissions.</p>
        <label htmlFor="review-name">Name</label><input id="review-name" required maxLength={120} value={reviewName} onChange={event => setReviewName(event.target.value)} placeholder="For example, British Gas content standards" />
        <label htmlFor="review-objective">Review objective</label><textarea id="review-objective" required minLength={10} maxLength={4000} rows={4} value={reviewObjective} onChange={event => setReviewObjective(event.target.value)} placeholder="Describe what the review should evaluate and report." />
        <button type="submit" className={styles.secondary} disabled={creatingReview}><Icon name="add" />{creatingReview ? "Saving…" : "Save customer review"}</button>
      </form>
      {completedReviews.length > 0 && <div className={styles.reviewHandoffActions}>
        <div><strong>{selectedCount} of {totalCount} findings selected</strong><p>Select findings across every completed review, then create one governed pipeline handoff.</p></div>
        <div><button type="button" className={styles.secondary} disabled={runningAllReviews || selectedCount === totalCount} onClick={selectAllReviewFindings}><Icon name="select_all" />Select all findings</button><button type="button" className={styles.primary} disabled={runningAllReviews || selectedCount === 0} onClick={openSelectedReviewHandoff}><Icon name="account_tree" />Use {selectedCount} selected finding{selectedCount === 1 ? "" : "s"} in Knowledge Studio</button></div>
      </div>}
    </>;
  }
  const suggestion = suggestions[activeSuggestion];
  const activeDuplicateIds = selectedDuplicateIds.filter((id) => !ignoredDuplicateIds.includes(id));
  const targetedDuplicateSetCount = source ? activeDuplicateIds.length + 1 : 0;

  function applySuggestion() {
    if (activeSuggestion === "fields") {
      setArticle(current => ({ ...current, fields: current.fields.map(field => field.name === "Troubleshooting" ? { ...field, value: suggestion.value } : field) }));
    } else {
      setArticle(current => ({ ...current, [activeSuggestion]: suggestion.value }));
    }
    setApplied(current => [...new Set([...current, activeSuggestion])]);
    setNotice(suggestion.label + " suggestion applied to this preview.");
  }

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <span className={styles.sectionTitle}>AI Solution View</span>
        <span className={styles.prototype}>{source ? "Saved RightAnswers solution" : "Start from a solution or a new content task"}</span>
        <span className={styles.avatar} aria-label="Demo author">JD</span>
      </header>
      <main className={styles.main}>
        <nav aria-label="Breadcrumb" className={styles.breadcrumb}><Link href="/">Knowledge Studio</Link><Icon name="chevron_right" /><span>AI Solution View</span></nav>
        <div className={styles.heading}>
          <div><div className={styles.eyebrow}>SOLUTION WORKSPACE</div><h1>AI Solution View</h1><p>{source ? "Review the saved solution, then open a governed Knowledge Studio workflow." : "Shape better answers with AI, one solution at a time."}</p></div>
          <div className={styles.actions}>
            <button type="button" className={styles.secondary} onClick={() => setGroundPickerOpen(true)} aria-haspopup="dialog"><Icon name="library_books" />Ground Context{groundContext.enabled && groundContext.referenceIds.length > 0 ? " (" + groundContext.referenceIds.length + ")" : ""}</button>
            <button type="button" className={styles.secondary} aria-haspopup="dialog" onClick={() => { setPanel("assist"); setReviewModalOpen(true); }}><Icon name="fact_check" />AI Solution Review</button>
            <button type="button" className={styles.secondary} disabled={!source || duplicateLoading} aria-haspopup="dialog" onClick={openDuplicateModal}><Icon name="difference" />Duplicate detection</button>
            <button type="button" className={styles.secondary} disabled={!source || duplicateLaunching} onClick={() => void openDuplicateStudio()}><Icon name="account_tree" />{duplicateLaunching ? "Opening…" : "Deduplicate solution"}</button>
            <button type="button" className={styles.primary} disabled={launching} onClick={openKnowledgeCreation}><Icon name="auto_awesome" />{launching ? "Opening…" : "AI Knowledge Creation"}</button>
          </div>
        </div>
        {loadingSource && <div className={styles.note}><Icon name="progress_activity" /><p>Loading the saved RightAnswers solution…</p></div>}
        {sourceError && <div className={styles.note} role="alert"><Icon name="error" /><p>{sourceError}</p></div>}
        {source && <div className={styles.note}><Icon name="verified" /><p>Saved source: {source.id} · version {sourceVersion?.slice(0, 12)}. Local edits in this view are previews until a reviewed draft is prepared.</p></div>}
        {!solutionId && <section className={styles.sourceLookup} aria-label="Search saved RightAnswers solutions">
          <label htmlFor="saved-solution-search">Search saved RightAnswers solutions</label>
          <div className={styles.searchInput}><Icon name="search" /><input id="saved-solution-search" type="search" maxLength={500} placeholder="Search by title, keyword, or 15-digit ID" value={solutionQuery} onChange={event => { setSolutionQuery(event.target.value); setSolutionRows([]); setSolutionSearchError(""); }} />{searchingSolutions && <Icon name="progress_activity" />}</div>
          <p>Results are searched in the selected customer connection.</p>
          {solutionSearchError && <p className={styles.searchError} role="alert">{solutionSearchError}</p>}
          {solutionQuery.trim() && !searchingSolutions && !solutionSearchError && !solutionRows.length && <p>No matching solutions. Try a different title, keyword, or ID.</p>}
          {solutionRows.length > 0 && <div className={styles.searchResults}>{solutionRows.map(row => <button type="button" key={row.id} className={styles.searchResult} onClick={() => openSolution(row.id)}><span className={styles.documentIcon}><Icon name="description" /></span><span><strong>{row.title}</strong><small>{row.id} · {row.meta}</small></span><Icon name="chevron_right" /></button>)}</div>}
        </section>}
        <GroundContextCard value={groundContext} onChange={changeGroundContext} onOpen={() => setGroundPickerOpen(true)} />
        <div className={styles.layout}>
          <section className={styles.article} aria-label="Solution editor">
            <div className={styles.articleHeader}>
              <div className={styles.identity}><span className={styles.documentIcon}><Icon name="description" /></span><div><strong>Solution details</strong><div className={styles.meta}>{source?.id ?? "New content"} <span>·</span> {source?.templateName ?? "How-to article"} <span>·</span> {source?.language ?? "English"}</div></div><span className={styles.draft}>{source?.status ?? "Preview"}</span></div>
              <div className={styles.switcher} aria-label="Article display"><button type="button" aria-pressed={!preview} onClick={() => setPreview(false)}>Edit</button><button type="button" aria-pressed={preview} onClick={() => setPreview(true)}>Preview</button></div>
            </div>
            <div className={styles.content}>
              <div className={styles.field}>
                <div className={styles.labelRow}><label htmlFor="solution-title">Title</label><button type="button" className={styles.aiLink} onClick={() => { setPanel("assist"); setActiveSuggestion("title"); }}><Icon name="auto_awesome" />Improve title</button></div>
                {preview ? <h2 className={styles.previewTitle}>{article.title}</h2> : <input id="solution-title" value={article.title} onChange={event => setArticle({ ...article, title: event.target.value })} />}
              </div>
              <div className={styles.field}>
                <div className={styles.labelRow}><label htmlFor="solution-summary">Summary</label><button type="button" className={styles.aiLink} onClick={() => { setPanel("assist"); setActiveSuggestion("summary"); }}><Icon name="auto_awesome" />Refine summary</button></div>
                {preview ? <p>{article.summary}</p> : <textarea id="solution-summary" rows={3} value={article.summary} onChange={event => setArticle({ ...article, summary: event.target.value })} />}
              </div>
              <div className={styles.field}>
                <div className={styles.labelRow}><label htmlFor="solution-keywords">Keywords</label><button type="button" className={styles.aiLink} onClick={() => { setPanel("assist"); setActiveSuggestion("keywords"); }}><Icon name="auto_awesome" />Suggest keywords</button></div>
                {preview ? <div className={styles.chips}>{article.keywords.split(",").filter(word => word.trim()).map((word, index) => <span key={index}>{word.trim()}</span>)}</div> : <><input id="solution-keywords" value={article.keywords} onChange={event => setArticle({ ...article, keywords: event.target.value })} /><small>Separate keywords with commas.</small></>}
              </div>
              <div className={styles.fieldsHeading}><div><h2>Fields</h2><p>Give your solution a clear, useful structure.</p></div><span className={styles.template}><Icon name="view_quilt" />{source?.templateName ?? "How-to template"}</span></div>
              {article.fields.map((field, index) => <div className={styles.field} key={field.name}>
                <div className={styles.labelRow}><label htmlFor={"solution-field-" + index}><span className={styles.number}>{String(index + 1).padStart(2, "0")}</span>{field.name}</label>{field.name === "Troubleshooting" && <button type="button" className={styles.aiLink} onClick={() => { setPanel("assist"); setActiveSuggestion("fields"); }}><Icon name="auto_awesome" />Improve field</button>}</div>
                {preview ? <p className={styles.fieldPreview}>{field.value}</p> : <textarea id={"solution-field-" + index} rows={index === 2 ? 6 : 3} value={field.value} onChange={event => setArticle({ ...article, fields: article.fields.map((item, i) => i === index ? { ...item, value: event.target.value } : item) })} />}
              </div>)}
            </div>
            <footer className={styles.articleFooter}><Icon name="info" /><span>{source ? "Preview changes are kept only while this page is open. Use AI Knowledge Creation to prepare a governed draft." : "Sample content · Changes are kept only while this page is open."}</span><button type="button" className={styles.reset} onClick={() => { setArticle(source ? articleFromSolution(source) : initial); setApplied([]); setGenerated(false); setReviewPlan([]); setGroundContext(emptyGroundContext); setNotice(source ? "Saved source restored in the preview." : "Sample content restored."); }}>{source ? "Restore saved source" : "Reset sample"}</button></footer>
          </section>
          <aside className={styles.sidebar} aria-label="AI assistance">
            <section className={styles.assistant}>
              <div className={styles.assistantHeading}><span className={styles.spark}><Icon name="auto_awesome" /></span><div><h2>Your AI copilot</h2><p>A little help. A better solution.</p></div><span className={styles.demo}>{source ? "PREVIEW" : "SAMPLE"}</span></div>
              <div className={styles.tabs} aria-label="AI tools">{(["assist", "review", "create"] as const).map(tab => <button type="button" key={tab} aria-pressed={panel === tab} onClick={() => setPanel(tab)}>{tab === "assist" ? "Assist" : tab === "review" ? "Review" : "Create"}</button>)}</div>
              <div className={styles.panel}>
                <GroundContextEvidence key={JSON.stringify([groundContext, panel])} value={groundContext} mode={panel} />
                {panel === "assist" && <>
                  <h3>Make every word work harder</h3><p>Explore suggestions to make this solution easier to find and follow.</p>
                  <div className={styles.tools}>{(Object.keys(suggestions) as Suggestion[]).map(key => <button type="button" key={key} aria-pressed={activeSuggestion === key} onClick={() => setActiveSuggestion(key)}><Icon name={key === "title" ? "title" : key === "summary" ? "short_text" : key === "keywords" ? "sell" : "article"} />{suggestions[key].label}{applied.includes(key) && <Icon name="check" />}</button>)}</div>
                  <div className={styles.suggestion}><span className={styles.eyebrow}>SUGGESTED {suggestion.label.toUpperCase()}</span><p className={styles.suggestionText}>{suggestion.value}</p><p>{suggestion.reason}</p><button type="button" className={styles.primary} onClick={applySuggestion}><Icon name="check" />Apply suggestion</button></div>
                  <div className={styles.note}><Icon name="lightbulb" /><p>You stay in control. Review each suggestion before adding it to your solution.</p></div>
                </>}
                {panel === "review" && <>
                  <h3>AI Solution Review</h3>
                  <p>{source ? "Run customer-defined, evidence-backed reviews. Results remain read-only until you deliberately open a governed Knowledge Studio workflow." : "Find missing knowledge and overlapping solutions, then review a proposed fix for each issue."}</p>
                  {source && renderConfiguredReviews()}
                  {!source && <>
                  <div className={styles.reviewSummary}><Icon name="rule" /><div><strong>2 opportunities to improve this solution</strong><p>Sample findings across your knowledge base.</p></div></div>
                  <div className={styles.reviewFindings}>
                    {reviewFindings.map(finding => (
                      <section className={styles.reviewCard} key={finding.id} aria-label={finding.title}>
                        <div className={styles.findingHeading}><Icon name={finding.icon} /><h4>{finding.title}</h4></div>
                        <span className={styles.findingBadge}>{finding.badge}</span>
                        <p>{finding.description}</p>
                        <details className={styles.fixDetails}>
                          <summary>{finding.action}<Icon name="expand_more" /></summary>
                          <div className={styles.fixProposal}>
                            <span className={styles.eyebrow}>PROPOSED FIX</span>
                            <h4>{finding.proposal}</h4>
                            <p>{finding.detail}</p>
                            <div className={styles.fixDestination}><Icon name="description" />{finding.destination}</div>
                            <button type="button" className={styles.primary} disabled={reviewPlan.includes(finding.id)} onClick={() => {
                              setReviewPlan(current => [...new Set([...current, finding.id])]);
                              setNotice("Fix added to the demo review plan.");
                            }}><Icon name={reviewPlan.includes(finding.id) ? "check" : "add"} />{reviewPlan.includes(finding.id) ? "Added to review plan" : "Add fix to review plan"}</button>
                          </div>
                        </details>
                      </section>
                    ))}
                  </div>
                  <div className={styles.reviewPlan} role="status"><Icon name="checklist" /><span>{reviewPlan.length} of 2 fixes in your review plan</span></div>
                  <div className={styles.note}><Icon name="info" /><p>Findings and proposed fixes are previews. They never update or merge knowledge articles directly.</p></div>
                  </>}
                </>}
                {panel === "create" && <>
                  <h3>AI Knowledge Creation</h3><p>Turn this solution into another useful piece of knowledge.</p>
                  <label className={styles.selectLabel} htmlFor="creation-format">What would you like to create?</label>
                  <select id="creation-format" value={format} onChange={event => { setFormat(event.target.value); setGenerated(false); }}><option>FAQ</option><option>Quick reference</option><option>Troubleshooting guide</option></select>
                  <div className={styles.source}><Icon name="description" /><div><small>SOURCE SOLUTION</small><strong>{article.title}</strong></div></div>
                  <button type="button" className={styles.primary} onClick={openKnowledgeCreation}><Icon name="auto_awesome" />Open in Knowledge Studio</button>
                  {generated && <div className={styles.suggestion} aria-live="polite"><span className={styles.eyebrow}>EXAMPLE {format.toUpperCase()}</span><h3>{format === "FAQ" ? "How do I access work applications remotely?" : format === "Quick reference" ? "VPN connection checklist" : "Unable to connect to the VPN"}</h3><p>{format === "FAQ" ? "Open the corporate VPN client, select your network profile, sign in, and approve the authentication request. Wait for the Connected status before accessing internal applications." : format === "Quick reference" ? "Open VPN client → Select Corporate network → Sign in → Approve authentication → Confirm Connected." : "Check your internet connection, retry the VPN connection, and complete authentication. Contact the IT service desk if the problem continues."}</p><small>Example output for the demo source.</small></div>}
                </>}
              </div>
              <div className={styles.panelFooter}><Icon name="auto_awesome" />{source ? "Suggestions become reviewed pipeline work" : "Illustrative AI suggestions"}</div>
            </section>
            <section className={styles.details}><h3>Solution information</h3><dl><div><dt>Collection</dt><dd>IT Support</dd></div><div><dt>Owner</dt><dd>Jamie Davis</dd></div><div><dt>Audience</dt><dd>All employees</dd></div><div><dt>Status</dt><dd><span className={styles.draft}>Draft</span></dd></div></dl></section>
          </aside>
        </div>
      </main>
      {groundPickerOpen && <GroundContextPicker value={groundContext} onCancel={() => setGroundPickerOpen(false)} onSave={value => { changeGroundContext(value); setGroundPickerOpen(false); setNotice(value.referenceIds.length ? "Ground Context references updated for this demo." : "Ground Context references cleared."); }} />}
      {reviewModalOpen && <div className={styles.modalBackdrop} role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setReviewModalOpen(false); }}><section className={styles.reviewModal} role="dialog" aria-modal="true" aria-labelledby="solution-review-title"><header><div><span className={styles.eyebrow}>GOVERNED REVIEW</span><h2 id="solution-review-title">AI Solution Review</h2><p>{source ? `Review ${source.title} with customer-defined checks, then select only the findings you want to take into Knowledge Studio.` : "Search for and open a saved RightAnswers solution before running a review."}</p></div><button type="button" className={styles.modalClose} aria-label="Close AI Solution Review" onClick={() => setReviewModalOpen(false)}><Icon name="close" /></button></header><div className={styles.modalBody}>{source ? renderConfiguredReviews() : <div className={styles.note}><Icon name="search" /><p>Use the solution search above to choose a saved source first.</p></div>}</div></section></div>}
      {duplicateModalOpen && <div className={styles.modalBackdrop} role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setDuplicateModalOpen(false); }}><section className={styles.duplicateModal} role="dialog" aria-modal="true" aria-labelledby="duplicate-detection-title"><header><div><span className={styles.eyebrow}>SOLUTION MANAGER</span><h2 id="duplicate-detection-title">Duplicate Detection</h2><p>{duplicateScope === "selected" ? `Previewing “${source?.title ?? "this solution"}” against the selected rows. Opening Knowledge Studio compares the full ${targetedDuplicateSetCount}-solution set pairwise, without searching the rest of the knowledge base.` : "Potentially overlapping solutions found across the knowledge base. Select rows to define a targeted comparison set."}</p></div><button type="button" className={styles.modalClose} aria-label="Close Duplicate Detection" onClick={() => setDuplicateModalOpen(false)}><Icon name="close" /></button></header><div className={styles.duplicateTabs} role="tablist" aria-label="Duplicate detection results"><button type="button" role="tab" aria-selected={duplicateTab === "duplicates"} onClick={() => setDuplicateTab("duplicates")}>Duplicates <span>{duplicateResults.filter(row => !ignoredDuplicateIds.includes(row.solutionId)).length}</span></button><button type="button" role="tab" aria-selected={duplicateTab === "ignored"} onClick={() => setDuplicateTab("ignored")}>Ignored <span>{ignoredDuplicateIds.length}</span></button></div><div className={styles.duplicateBody}>{duplicateError && <div className={styles.note} role="alert"><Icon name="error" /><p>{duplicateError}</p></div>}{duplicateLoading ? <div className={styles.duplicateLoading}><Icon name="progress_activity" /><p>Comparing solution content…</p></div> : duplicateTab === "ignored" ? <div className={styles.duplicateEmpty}><Icon name="visibility_off" /><p>{ignoredDuplicateIds.length ? "Ignored rows stay out of this targeted comparison for this session." : "No duplicate suggestions have been ignored."}</p></div> : duplicateResults.length ? <div className={styles.duplicateTableWrap}><table className={styles.duplicateTable}><thead><tr><th scope="col"><span className={styles.srOnly}>Select</span></th><th scope="col">% Similarity</th><th scope="col">Title</th><th scope="col">Author</th><th scope="col">Status</th><th scope="col">Collection</th><th scope="col">Similarity summary</th><th scope="col">Actions</th></tr></thead><tbody>{duplicateResults.filter(row => !ignoredDuplicateIds.includes(row.solutionId)).map(row => <tr key={row.solutionId}><td><input type="checkbox" aria-label={`Select ${row.title}`} checked={selectedDuplicateIds.includes(row.solutionId)} onChange={() => toggleDuplicateSelection(row.solutionId)} /></td><td><strong>{Math.round(row.similarity)}%</strong><small className={row.verdict === "distinct" ? styles.distinct : styles.match}>{row.verdict}</small></td><td><strong>{row.title}</strong><p>{row.summary || "No summary available."}</p></td><td>{row.author}</td><td>{row.status}</td><td>{row.collections.join(", ") || "—"}</td><td><p>{row.rationale}</p>{row.sharedTopics.length > 0 && <small>{row.sharedTopics.join(" · ")}</small>}</td><td><div className={styles.duplicateRowActions}><button type="button" className={styles.iconButton} title="Open solution" onClick={() => openSolution(row.solutionId)}><Icon name="open_in_new" /></button><button type="button" className={styles.ignoreButton} onClick={() => { setIgnoredDuplicateIds(current => [...new Set([...current, row.solutionId])]); setSelectedDuplicateIds(current => current.filter(id => id !== row.solutionId)); }}>Ignore</button></div></td></tr>)}</tbody></table></div> : <div className={styles.duplicateEmpty}><Icon name="check_circle" /><p>{duplicateScope === "selected" ? "No selected solutions were available to compare." : "No potential duplicates were found. You can still open the full knowledge-base duplicate workflow."}</p></div>}</div><footer className={styles.duplicateFooter}><div><strong>{activeDuplicateIds.length ? `${targetedDuplicateSetCount} in targeted set` : "No targeted set selected"}</strong><span>{duplicateScope === "selected" ? "The preview checks the source against each selected row; Studio compares every pair in the full set." : "The current source is included with every selected row when you open the targeted workflow."}</span></div><div><button type="button" className={styles.secondary} disabled={duplicateLoading || activeDuplicateIds.length === 0} onClick={() => void runDuplicateDetection(activeDuplicateIds)}><Icon name="filter_alt" />Preview against source</button><button type="button" className={styles.primary} disabled={duplicateLoading || duplicateLaunching || activeDuplicateIds.length === 0} onClick={() => void openDuplicateStudio(true)}><Icon name="account_tree" />{duplicateLaunching ? "Opening…" : "Compare selected set in Studio"}</button></div></footer></section></div>}
      {notice && <div className={styles.toast} role="status"><Icon name="check_circle" />{notice}<button type="button" aria-label="Dismiss notification" onClick={() => setNotice("")}><Icon name="close" /></button></div>}
    </div>
  );
}

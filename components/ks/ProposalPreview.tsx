import type { ViewCandidate, ViewDupeGroup } from "@/lib/ks/model";
import type { DupeResolution } from "@/lib/ks/helpers";

export function ProposalPreview({ candidate: c, group, resolution, duplicatesChecked, operations = [] }: {
  candidate: ViewCandidate; group?: ViewDupeGroup; resolution?: DupeResolution; duplicatesChecked: boolean; operations?: string[];
}) {
  const survivor = group?.members.find((m) => m.retained);
  const standardsEnabled = operations.includes("Apply content standards");
  const restructureEnabled = operations.includes("Restructure content");
  const action = c.researchOnly ? "Research a supported answer before creating an article."
    : resolution === "merged" ? `Combine selected sources into “${survivor?.title}” after submission.`
    : group && !resolution ? "Review the suggested merge. Choose whether to combine these sources or keep them separate."
    : c.targetSolutionId ? standardsEnabled ? `Prepare a standards-reviewed update to ${c.targetSolutionId}.` : `Prepare an update to ${c.targetSolutionId}.` : "Prepare a new article for review.";
  const summary = [
    c.targetSolutionId ? `Prepare a review draft for the existing solution ${c.targetSolutionId}; the published article stays unchanged.` : "Prepare a new article draft for review; no RightAnswers write occurs at this stage.",
    standardsEnabled ? "Review the final fields against the selected content standards and apply compatible wording and formatting changes only." : undefined,
    restructureEnabled && !c.targetSolutionId ? "Map the approved source material into the chosen template and preserve supported technical facts." : undefined,
    !duplicatesChecked ? "No duplicate comparison was run for this proposal." : undefined,
    "Pause for your review before any draft or revision is sent to RightAnswers.",
  ].filter((item): item is string => !!item);
  return <div className="ks-proposal">
    <p>This is a plan. Confirm the scope and metadata before Knowledge Studio prepares the draft.</p>
    <h3>Proposed action</h3><p>{action}</p>
    <h3>Plan at a glance</h3><ul>{summary.map((step, index) => <li key={index}>{step}</li>)}</ul>
    {standardsEnabled && <p className="ks-card" style={{ padding: 12 }}>After preparation, the draft’s result panel will show the exact standards instructions used and a rule-by-rule explanation of what changed.</p>}
    <details style={{ marginTop: 18 }}>
      <summary>View detailed planning evidence</summary>
      <div style={{ marginTop: 14 }}>
        <h3>Why</h3><p>{c.why}</p>
        {c.proposal ? <>
          <h3>Purpose</h3><p>{c.proposal.purpose}</p>
          <h3>What it should cover</h3><ul>{c.proposal.coverage.map((v, i) => <li key={i}>{v}</li>)}</ul>
          <h3>Questions to verify</h3>
          {c.proposal.openQuestions.length ? <ul>{c.proposal.openQuestions.map((v, i) => <li key={i}>{v}</li>)}</ul> : <p>No open questions were identified by the planner. Review the scope against your source material.</p>}
        </> : <p>This saved run predates detailed planning. Return to Content and analyze again to generate an outline and verification questions.</p>}
        {c.edited && <p>The source was edited after analysis. The outline above describes the original analysis; authoring uses your edited source.</p>}
        <h3>Source material</h3><ul>{(c.sourceLabels?.length ? c.sourceLabels : [c.source]).map((v, i) => <li key={i}>{v}</li>)}</ul>
        <h3>Duplicate evidence</h3>
        {!duplicatesChecked || c.researchOnly ? <p>Not checked for this proposal.</p> : <>
          <p>{c.duplicates.length || group ? "Matches are suggestions based on compared coverage; you decide what to do." : "No matches were found in this run’s retrieval and comparison. This does not establish that the entire knowledge base has no duplicates."}</p>
          {c.duplicates.map((d) => <p key={d.solutionId}><strong>{d.title} ({d.solutionId}) · {d.similarity}%</strong><br />{d.rationale}</p>)}
          {group && <><p>{group.reason}</p><ul>{group.members.map((m) => <li key={m.id}>{m.title}{m.retained ? " · proposed survivor" : ""}</li>)}</ul></>}
        </>}
        <h3>Template and next stage</h3>
        <p>{c.targetSolutionId ? `Existing template: ${c.templateName}.` : `Suggested template: ${c.templateName}. You can change it in Metadata.`} The outline describes scope, independently of template fields.</p>
        <p>After your confirmation, submission prepares content from the sources using your final options. Conflicts or missing required fields pause that article for review before writing.</p>
      </div>
    </details>
  </div>;
}

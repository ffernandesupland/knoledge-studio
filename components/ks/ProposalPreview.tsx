import type { ViewCandidate, ViewDupeGroup } from "@/lib/ks/model";
import type { DupeResolution } from "@/lib/ks/helpers";

export function ProposalPreview({ candidate: c, group, resolution, duplicatesChecked }: {
  candidate: ViewCandidate; group?: ViewDupeGroup; resolution?: DupeResolution; duplicatesChecked: boolean;
}) {
  const survivor = group?.members.find((m) => m.retained);
  const action = c.researchOnly ? "Research a supported answer before creating an article."
    : resolution === "merged" ? `Combine selected sources into “${survivor?.title}” after submission.`
    : group && !resolution ? "Review the suggested merge. Choose whether to combine these sources or keep them separate."
    : c.targetSolutionId ? `Prepare an update to ${c.targetSolutionId}.` : "Prepare a new article for review.";
  return <div className="ks-proposal">
    <p>This is a plan. Article content is prepared after you confirm the scope, duplicate decisions and metadata.</p>
    <h3>Proposed action</h3><p>{action}</p>
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
  </div>;
}

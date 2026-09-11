import type { AutonomousOutcome as Outcome } from "@/lib/autonomous/outcome";

const statusLabels = { completed: "Completed", active: "In progress", stopped: "Stopped", pending: "Not reached" };
export function AutonomousOutcome({ outcome, error, showProposals = false }: { outcome: Outcome; error?: string; showProposals?: boolean }) {
  return <section className="auto-outcome" aria-label="Execution result">
    <h2>Execution result</h2>
    <p>{outcome.proposals.length} proposals saved · {outcome.prepared} articles prepared · <strong>{outcome.submitted} articles submitted</strong></p>
    {outcome.failedStage && <div role="alert"><strong>Stopped at: {outcome.failedStage}</strong>{error && <p>{error}</p>}
      {outcome.submitted === 0 && <p>No articles were submitted to RightAnswers in this run.</p>}
    </div>}
    <ol className="auto-stage-diagram" aria-label="Recorded execution stages">{outcome.stages.map(stage => <li key={stage.key} data-status={stage.status}>
      <strong>{stage.label}</strong><span>{statusLabels[stage.status]}</span>
    </li>)}</ol>
    {showProposals && <><h3>Saved proposals</h3><p>These are planning ideas. Final actions, templates and merge destinations have not been selected.</p>
      {outcome.proposals.length ? <ul className="auto-saved-proposals">{outcome.proposals.map(p => <li key={p.key}><strong>{p.title}</strong>{p.reason && <p>{p.reason}</p>}</li>)}</ul> : <p>No proposals were saved before the interruption.</p>}
    </>}
  </section>;
}

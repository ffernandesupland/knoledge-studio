"use client";

import { useState } from "react";
import { IdChip } from "@/components/ds";
import { T } from "@/lib/ks/theme";
import { isSolutionId } from "@/lib/pipeline/submit";
import type { ViewDupeGroup } from "@/lib/ks/model";

/**
 * Suggested merges arrive approved. This workspace is only needed when someone wants to
 * inspect the group, retain a different destination, or keep the items separate.
 */
export function MergeWorkspaceModal({
  group,
  onCancel,
  onKeepSeparate,
  onContinue,
}: {
  group: ViewDupeGroup;
  onCancel: () => void;
  onKeepSeparate: () => void;
  onContinue: (survivorId: string) => void;
}) {
  const [survivorId, setSurvivorId] = useState(group.survivorId);

  const allNew = group.members.every((m) => !isSolutionId(m.id));

  return (
    <div className="entity-modal-scrim" onClick={(e) => e.target === e.currentTarget && onCancel()}>
      <div
        className="entity-modal"
        role="dialog"
        aria-modal="true"
        style={{ width: 1080, maxWidth: "94%", maxHeight: "88vh", display: "flex", flexDirection: "column" }}
      >
        <div className="entity-modal-hdr">
          <div className="entity-modal-title">
            <span className="ms" style={{ verticalAlign: "middle", marginRight: 8, color: T.accent }}>
              merge
            </span>
            {allNew ? `Combined article destination` : `Merge destination`}
          </div>
        </div>

        <div className="entity-modal-body" style={{ overflowY: "auto", flex: 1, minHeight: 0 }}>
          <div className="ks-survivor">
            <div
              className="section-lbl"
              style={{ fontSize: 12, fontWeight: 500, textTransform: "uppercase", color: T.textSecondary }}
            >
              {allNew ? "Which proposal should lead the combined article?" : "Which item should be retained?"}
            </div>
            <div style={{ fontSize: 12, color: T.textSecondary, marginTop: 4 }}>
              {allNew
                ? "These are proposed topics, not existing solutions. Combining them plans one new article from their sources. No URL, history or view counts exist yet. Keep them separate if they serve different reader needs."
                : "An existing retained solution keeps its URL, ID and history; a new retained proposal becomes a new article. Other existing members receive a merge comment only after the retained article is written. New proposals are combined without creating separate records."}
              <p><strong>Why this group was suggested:</strong> {group.reason}</p>
            </div>
            <div className="ks-sv-opts">
              {group.members.map((m) => (
                <div
                  key={m.id}
                  className={"ks-sv" + (survivorId === m.id ? " on" : "")}
                  onClick={() => setSurvivorId(m.id)}
                >
                  <div className="ks-sv-top">
                    <span className="ks-radio" />
                    {m.id === group.survivorId && (
                      <span className="ks-airec">
                        <span className="ms">auto_awesome</span>Suggested starting point
                      </span>
                    )}
                  </div>
                  <div className="nm">{m.title}</div>
                  {isSolutionId(m.id) ? <IdChip id={m.id} copyable /> : <span className="stat">Proposed topic</span>}
                  <div className="stat">{m.stat}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="entity-modal-footer" style={{ justifyContent: "space-between" }}>
          <button type="button" className="ds-btn ds-btn-secondary" onClick={onKeepSeparate}>
            Keep separate
          </button>
          <button
            type="button"
            className="ds-btn ds-btn-primary"
            onClick={() => onContinue(survivorId)}
          >
            Save destination
            <span className="ms" style={{ fontSize: 18 }}>
              check
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}

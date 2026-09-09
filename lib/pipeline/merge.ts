import type { ContentProposal } from "../llm/planning";
import { solutionVersion } from "./version";
import { isSolutionId } from "./submit";
import { mergeSections, type MergeWorkspaceResult } from "../llm/operations";
import { ra } from "../ra/client";
import type { WSTemplate } from "../ra/types";
import type { MergeSource } from "./submit";
import { solutionToText } from "./dedupe";

export interface MergeGroupArgs {
  survivorId: string;
  user?: string;
  survivorEdited?: boolean;
  sourceVersion?: string;
  survivorTitle: string;
  survivorRawContent?: string;
  proposal?: ContentProposal;
  /**
   * Unset when this run never analyzed the survivor itself — it was only ever seen as a
   * duplicate match. Its real template and current content are fetched live in that case,
   * the same way an unauthored source's content is.
   */
  survivorTemplateName?: string;
  survivorFields?: { fieldName: string; fieldValue: string }[];
  /** The group's other members; their real content is retrieved and folded in. */
  sources: MergeSource[];
}

export interface MergeGroupResult {
  title?: string; summary?: string; keywords?: string[];
  fields: { fieldName: string; fieldValue: string }[];
  /** Set when sources use different templates, so some fields will not line up. */
  templateWarning: string | null;
  costUsd: number;
  sourceVersions?: Record<string, string>;
  sections?: MergeWorkspaceResult["sections"];
  templateName?: string;
}

/**
 * Retrieves every group member's real content and combines it into the survivor's own
 * template, field by field. Runs at submit time so the merge always reflects live content,
 * not whatever was on screen when the author reviewed the duplicates.
 */
export async function mergeGroupFields(args: MergeGroupArgs): Promise<MergeGroupResult> {
  const { survivorId, survivorTitle, sources } = args;
  const ctx = { impUser: args.user };
  const sourceVersions: Record<string, string> = {};

  let survivorTemplateName = args.survivorTemplateName;
  let survivorFields = args.survivorFields;
  if (survivorTemplateName == null || survivorFields == null || (isSolutionId(survivorId) && !args.survivorEdited)) {
    const solution = await ra.getSolution(survivorId, ctx);
    sourceVersions[survivorId] = solutionVersion(solution);
    survivorTemplateName = solution.templateName ?? "unknown";
    survivorFields = (solution.fields ?? [])
      .filter((f) => f.content?.trim())
      .map((f) => ({ fieldName: f.name, fieldValue: f.content }));
  }

  if (args.survivorEdited && args.sourceVersion) sourceVersions[survivorId] = args.sourceVersion;

  if (!sources.length) {
    return { fields: survivorFields, templateWarning: null, costUsd: 0 };
  }

  const templates = await ra.getTemplates(ctx);
  const target: WSTemplate =
    templates.find((t) => t.templateName === survivorTemplateName)!;
  if (!target) throw new Error(`Merge target template ${survivorTemplateName} is unavailable`);

  const blocks = [
    {
      label: `${survivorTitle} (${survivorId})`,
      templateName: survivorTemplateName,
      body: !isSolutionId(survivorId) && args.survivorRawContent ? args.survivorRawContent : survivorFields.map((f) => `## ${f.fieldName}\n${f.fieldValue}`).join("\n\n"),
    },
  ];
  for (const s of sources) {
    if (s.fields && (!isSolutionId(s.id) || s.edited)) {
      if (s.sourceVersion) sourceVersions[s.id] = s.sourceVersion;
      blocks.push({
        label: `${s.title} (new draft)`,
        templateName: s.templateName ?? survivorTemplateName,
        body: s.rawContent || s.fields.map((f) => `## ${f.fieldName}\n${f.fieldValue}`).join("\n\n"),
      });
    } else {
      const solution = await ra.getSolution(s.id, ctx);
      sourceVersions[s.id] = solutionVersion(solution);
      blocks.push({
        label: `${solution.title} (${s.id})`,
        templateName: solution.templateName ?? "unknown",
        body: solutionToText(solution),
      });
    }
  }

  const distinctTemplates = [...new Set(blocks.map((b) => b.templateName))];
  const templateWarning =
    distinctTemplates.length > 1
      ? `These solutions used different templates (${distinctTemplates.join(", ")}); some content may not have lined up field by field.`
      : null;

  const result = await mergeSections(blocks, target, [args.proposal, ...sources.map((s) => s.proposal)].filter((p): p is ContentProposal => !!p));

  const fields = result.data.sections
    .map((s) => ({ fieldName: s.fieldName, fieldValue: s.combined }));

  return { title: result.data.title, summary: result.data.summary, keywords: result.data.keywords, sourceVersions, fields, templateWarning, costUsd: result.costUsd, sections: result.data.sections, templateName: target.templateName };
}

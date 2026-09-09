/**
 * Knowledge Studio domain types and fixture data, ported from the design prototype.
 *
 * The fixtures below stand in for pipeline output until Phases 5–6 land. Template,
 * collection, taxonomy and language options are NOT fixtures — they come from the RA API
 * (see lib/ra/client.ts), because the prototype's values are fictional: there is no
 * "KCS Solution" template in the real tenant (finding V3).
 */

export type PathKey = "create" | "improve" | "gap";
export type StepId = "input" | "check" | "metadata" | "submit";
export type SubmitStatus = "new" | "updated" | "merged" | "flagged";

export interface Step {
  id: StepId;
  name: string;
  helper: string;
  icon: string;
}

export interface PathDef {
  key: PathKey;
  label: string;
  icon: string;
  desc: string;
  ops: string;
  on: string[];
}

export interface Operation {
  name: string;
  desc: string;
  icon: string;
  on: boolean;
}

export const KS_STEPS: Step[] = [
  { id: "input", name: "Content", helper: "Your material", icon: "edit_note" },
  { id: "check", name: "Check", helper: "5 solutions", icon: "fact_check" },
  { id: "metadata", name: "Metadata", helper: "Set fields", icon: "sell" },
  { id: "submit", name: "Submit", helper: "For review", icon: "send" },
];

export const KS_PATHS: Record<PathKey, PathDef> = {
  create: {
    key: "create",
    label: "Create from new content",
    icon: "note_add",
    desc: "Type, paste a link or drop documents. They get split, structured and tagged for you.",
    ops: "Splits topics, applies standards, checks for duplicates",
    on: ["Split topics", "Restructure content", "Apply content standards", "Find duplicates"],
  },
  improve: {
    key: "improve",
    label: "Improve existing solutions",
    icon: "auto_fix_high",
    desc: "Pick solutions from your knowledge base to reformat, split, merge or bring up to standard.",
    ops: "Runs every option, takes longest",
    on: [
      "Split topics",
      "Restructure content",
      "Apply content standards",
      "Find duplicates",
      "Optimize for search",
      "Find gaps",
    ],
  },
  gap: {
    key: "gap",
    label: "Close a knowledge gap",
    icon: "troubleshoot",
    desc: "Start from a question Gen Answers couldn't answer and create what's missing.",
    ops: "Finds gaps and tunes for search, no splitting",
    on: [
      "Restructure content",
      "Apply content standards",
      "Find duplicates",
      "Optimize for search",
      "Find gaps",
    ],
  },
};

export const KS_OPS_DEFAULT: Operation[] = [
  {
    name: "Split topics",
    desc: "Split content that covers several topics into separate solutions",
    icon: "call_split",
    on: true,
  },
  {
    name: "Restructure content",
    desc: "Rewrite for clarity within the selected template. New articles always receive template fields and HTML formatting.",
    icon: "article",
    on: true,
  },
  {
    name: "Apply content standards",
    desc: "Use your organization's formatting and tone rules",
    icon: "rule",
    on: true,
  },
  {
    name: "Find duplicates",
    desc: "Check whether solutions already cover this topic",
    icon: "search",
    on: true,
  },
  {
    name: "Optimize for search",
    desc: "Improve titles and keywords so search can find it",
    icon: "bolt",
    on: false,
  },
  {
    name: "Find gaps",
    desc: "Spot topics your knowledge base is missing",
    icon: "troubleshoot",
    on: true,
  },
];

export const KS_CS_ALL_RULES = [
  "Sentence-case headings",
  "Second person",
  "Numbered steps",
  "Active voice",
  "Metric units",
];

export const KS_CS_PRESETS: Record<string, string[]> = {
  "Default company standard": ["Sentence-case headings", "Second person", "Numbered steps"],
  "Support content (external)": [
    "Sentence-case headings",
    "Second person",
    "Numbered steps",
    "Active voice",
  ],
  "Internal only": ["Sentence-case headings"],
};

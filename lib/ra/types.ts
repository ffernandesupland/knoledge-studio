/** RightAnswers wire types. Only the fields Knowledge Studio actually consumes. */

export interface WSTemplateField {
  fieldName: string;
  description: string;
  required: boolean;
  searchable: boolean;
}

export interface WSTemplate {
  templateName: string;
  templateType: string;
  kbPrefix: string;
  fields: WSTemplateField[];
}

export interface WSSolutionField {
  name: string;
  content: string;
}

export interface WSAttribute {
  name: string;
  values: string[];
}

/**
 * `status` here is the READ vocabulary ("Published" | "Draft" | ...), which differs
 * from the write vocabulary accepted by manageSolution. See lib/ra/status.ts.
 */
export interface WSSolution {
  id: string;
  title: string;
  status: string;
  templateName?: string | null;
  templateSolutionID?: string;
  language?: string;
  summary?: string;
  keywords?: string;
  author?: string;
  approver?: string;
  categoryCode?: string;
  createDate?: string;
  lastModifiedDate?: string;
  /** Epoch millis. */
  renewDate?: number | null;
  revisionID?: string | null;
  viewCount?: number;
  solvedCount?: number;
  unsolvedCount?: number;
  collections?: string[];
  /** Hierarchy segments are joined with "//". */
  taxonomy?: string[];
  attributes?: WSAttribute[];
  attributeSetName?: string;
  fields?: WSSolutionField[];
}

export interface WSSolutionResult {
  id: string;
  title: string;
  score: number;
  summary?: string;
  keywords?: string;
  matchSummary?: string | null;
  categoryCode?: string;
  templateSolutionID?: string;
  solutionType?: string;
  collections?: string[];
  verboseSolutionResult?: WSSolution | null;
}

export interface WSSearchResult {
  totalHits: number;
  didYouMean?: string;
  searchType?: string;
  solutions: WSSolutionResult[];
  languages?: string[];
  templates?: string[];
  collections?: { code: string; displayName: string }[];
  browsePaths?: { value: string; hitCount: number; levelValue?: string }[];
}

export interface WSCollection {
  code: string;
  displayName: string;
}

export interface WSDisplayField {
  fieldName: string;
  fieldValue: string;
}

export type SearchType = "Keyword" | "Hybrid" | "Neural";

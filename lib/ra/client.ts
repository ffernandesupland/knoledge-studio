import { AsyncLocalStorage } from "node:async_hooks";
const actor = new AsyncLocalStorage<string>();
export const withRaActor = <T>(user: string, fn: () => Promise<T>) => actor.run(user, fn);
import { config } from "../config";
import { getToken } from "./auth";
import { parseJson, raFetch, RaError, type RaRequestOptions } from "./http";
import { assertWriteSucceeded, parseSolutionId } from "./parse";
import { isLive } from "./status";
import type {
  SearchType,
  WSCollection,
  WSDisplayField,
  WSSearchResult,
  WSSolution,
  WSTemplate,
} from "./types";

export interface RaContext {
  /** Username to impersonate; writes are attributed to this user. */
  impUser?: string;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export { parseSolutionId };

async function call<T>(
  ctx: RaContext,
  opts: Omit<RaRequestOptions, "headers">,
  raw = false,
): Promise<T> {
  const impUser = ctx.impUser ?? actor.getStore();
  const token = await getToken(impUser);
  const { text } = await raFetch(config.ra.baseUrl, {
    ...opts,
    timeoutMs: opts.timeoutMs ?? config.ra.timeoutMs,
    headers: { Authorization: `Bearer ${token}` },
    query: {
      companyCode: config.ra.companyCode,
      appInterface: config.ra.appInterface,
      imp_user: impUser,
      ...opts.query,
    },
  });
  return (raw ? (text as unknown as T) : parseJson<T>(text, opts.path));
}

export interface SearchParams {
  queryText?: string;
  searchType?: SearchType;
  page?: number;
  language?: string;
  collections?: string;
  taxonomyPath?: string;
  templates?: string;
  statuses?: string;
  returnTypes?: string;
  verboseResult?: boolean;
  verboseResultFields?: string;
  loggingEnabled?: boolean;
}

export const ra = {
  async getTemplates(ctx: RaContext = {}): Promise<WSTemplate[]> {
    const res = await call<{ templates: WSTemplate[] }>(ctx, {
      path: "/api/rest/templates",
      // This endpoint takes companyCode only; appInterface/imp_user are rejected noise.
      query: { appInterface: undefined, imp_user: undefined },
    });
    return res.templates ?? [];
  },

  getCollections(ctx: RaContext = {}): Promise<WSCollection[]> {
    return call<WSCollection[]>(ctx, { path: "/api/rest/collections" });
  },

  /** Real user queries, used for search optimization and as gap-analysis seeds. */
  getCompanyTopSearches(
    timerange: "today" | "lastweek" | "lastmonth" | "alltime" = "lastmonth",
    ctx: RaContext = {},
  ): Promise<{ description: string; count: number }[]> {
    return call(ctx, { path: "/api/rest/topsearches/company", query: { timerange } });
  },

  getKeywords(languageCode = "en", ctx: RaContext = {}): Promise<{ keywords: { keyword: string; count: number }[] }> {
    return call(ctx, { path: "/api/rest/keywords", query: { languageCode, pageSize: 100 } });
  },

  search(params: SearchParams, ctx: RaContext = {}): Promise<WSSearchResult> {
    return call<WSSearchResult>(ctx, {
      path: "/api/rest/search",
      query: {
        queryText: params.queryText,
        searchType: params.searchType,
        page: params.page ?? 1,
        language: params.language,
        collections: params.collections,
        taxonomyPath: params.taxonomyPath,
        templates: params.templates,
        statuses: params.statuses,
        returnTypes: params.returnTypes,
        verboseResult: params.verboseResult ?? false,
        verboseResultFields: params.verboseResultFields,
        loggingEnabled: params.loggingEnabled ?? false,
      },
    });
  },

  getSolution(solutionID: string, ctx: RaContext = {}): Promise<WSSolution> {
    return call<WSSolution>(ctx, {
      path: `/api/rest/solution/${solutionID}`,
      query: { fieldContentMarkdown: true, loggingEnabled: false },
    });
  },

  getSolutionHtml(solutionID: string, ctx: RaContext = {}): Promise<WSSolution> {
    return call(ctx, { path: `/api/rest/solution/${solutionID}`, query: { fieldContentMarkdown: false, loggingEnabled: false } });
  },

  /**
   * Writes are eventually consistent: a fresh solution 404s for a few seconds and an
   * updated one can read back stale. Poll until the record exists and, optionally, until
   * a predicate holds. Never assert on a solution without going through this.
   */
  async waitForSolution(
    solutionID: string,
    predicate: (s: WSSolution) => boolean = () => true,
    { tries = 15, delayMs = 1000, ctx = {} as RaContext } = {},
  ): Promise<WSSolution> {
    let last: WSSolution | null = null;
    for (let i = 0; i < tries; i++) {
      try {
        last = await this.getSolution(solutionID, ctx);
        if (predicate(last)) return last;
      } catch {
        // not readable yet
      }
      await sleep(delayMs);
    }
    if (last) return last;
    throw new Error(`solution ${solutionID} never became readable`);
  },

  solutionExists(solutionID: string, ctx: RaContext = {}): Promise<boolean> {
    return call<boolean>(ctx, { path: `/api/rest/solution/${solutionID}/exists` });
  },

  /**
   * Create when solutionID is omitted; update in place when it is set; create a revision
   * that leaves the live article untouched when revisionParentID is set.
   */
  async manageSolution(
    args: {
      title?: string;
      summary?: string;
      language?: string;
      templateName?: string;
      solutionID?: string;
      revisionParentID?: string;
      status?: string;
      keywords?: string;
      collections?: string;
      taxonomies?: string;
      minorSave?: boolean;
      attributeSetName?: string;
      attributes?: string;
      fields?: WSDisplayField[];
    },
    ctx: RaContext = {},
  ): Promise<string> {
    const { fields, ...query } = args;
    const raw = await call<string>(
      ctx,
      { method: "POST", path: "/api/rest/manageSolution", query, body: fields ?? [] },
      true,
    );
    return assertWriteSucceeded(raw);
  },

  addComment(
    solutionID: string,
    body: { comments: string; commentTitle?: string; parentID?: number; hiddenFromSS?: boolean },
    ctx: RaContext = {},
  ): Promise<string> {
    return call<string>(
      ctx,
      {
        method: "POST",
        path: `/api/rest/comments/${solutionID}`,
        body: { parentID: 0, ...body },
        bodyKind: "form",
      },
      true,
    );
  },

  /**
   * Guarded update. RA will happily overwrite a live article in place, so this guard is
   * the only thing routing published content down the revision path (verified V10).
   * The status check uses the READ vocabulary — see lib/ra/status.ts.
   */
  async updateSolution(
    solution: WSSolution,
    changes: { title?: string; summary?: string; keywords?: string; fields?: WSDisplayField[] },
    ctx: RaContext = {},
  ): Promise<{ mode: "revision" | "direct"; solutionId: string; request: { title?: string; summary?: string; keywords?: string; fields?: WSDisplayField[]; templateName?: string; revisionParentID?: string; solutionID?: string; collections?: string; taxonomies?: string; language?: string; minorSave?: boolean } }> {
    const live = isLive(solution.status);
    const request = {
        ...changes,
        templateName: solution.templateName ?? undefined,
        // A revision is a new record, so it must carry collections/taxonomy forward.
        // A direct update must NOT send collections: combined with minorSave it makes RA
        // fork a new record instead of editing in place (verified V12).
        ...(live
          ? {
              revisionParentID: solution.id,
              collections: (solution.collections ?? []).join(","),
              taxonomies: (solution.taxonomy ?? []).join(","),
              language: solution.language,
            }
          : { solutionID: solution.id }),
        minorSave: !live,
      };
    const raw = await this.manageSolution(request, ctx);
    const solutionId = parseSolutionId(raw);
    if (!live && solutionId !== solution.id) {
      throw new RaError(
        `Direct update forked a new record: expected ${solution.id}, got ${solutionId}`,
        200,
        "/api/rest/manageSolution",
        raw,
      );
    }
    return { mode: live ? "revision" : "direct", solutionId, request };
  },

  /**
   * Archive requires the title to be resent — a status-only payload is rejected with
   * "Solution title must not be blank" (V12). Requires a permission the pilot service
   * account does not have (V13), so the merge flow uses flagMergedInto instead.
   */
  async archiveSolution(solutionID: string, ctx: RaContext = {}): Promise<string> {
    const current = await this.getSolution(solutionID, ctx);
    return this.manageSolution(
      {
        solutionID,
        title: current.title,
        templateName: current.templateName ?? undefined,
        status: "archived",
      },
      ctx,
    );
  },

  /**
   * Merge outcome for a non-surviving solution: leave the record alone and attach a
   * tracking comment pointing at the survivor. Replaces archiving, which is permission
   * blocked (V13). Internal-only so portal users never see the trail.
   */
  flagMergedInto(
    loserID: string,
    survivor: { id: string; title: string },
    ctx: RaContext = {},
  ): Promise<string> {
    return this.addComment(
      loserID,
      {
        commentTitle: "Merged by Knowledge Studio",
        comments:
          `This solution's content was merged into "${survivor.title}" (${survivor.id}). ` +
          `Kept for tracking; review before reuse.`,
        hiddenFromSS: true,
      },
      ctx,
    );
  },
};

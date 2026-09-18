import { requireActor, apiError } from "@/lib/api/auth";
import { NextResponse } from "next/server";
import { ra } from "@/lib/ra/client";
import { resolveConnection } from "@/lib/ra/connections";

export const dynamic = "force-dynamic";

export interface MetadataOptions {
  author?: string;
  templates: { name: string; fields: string[]; requiredFields: string[] }[];
  collections: { code: string; label: string }[];
  taxonomies: string[];
  languages: string[];
}

/** Dropdown options for the Metadata step, sourced from RA rather than hardcoded (V3). */
export async function GET(request: Request) {
  try {
    const author = await requireActor(request);
    const connectionId = new URL(request.url).searchParams.get("connectionId");
    const ctx = { impUser: author, connection: await resolveConnection(author, connectionId) };
    const [templates, collections, facets] = await Promise.all([
      ra.getTemplates(ctx),
      ra.getCollections(ctx),
      ra.search({ returnTypes: "taxonomies,languages", page: 1 }, ctx),
    ]);

    const payload: MetadataOptions = {
      author,
      templates: templates.map((t) => ({
        name: t.templateName,
        fields: t.fields.map((f) => f.fieldName),
        requiredFields: t.fields.filter((f) => f.required).map((f) => f.fieldName),
      })),
      collections: collections.map((c) => ({ code: c.code, label: c.displayName || c.code })),
      taxonomies: (facets.browsePaths ?? []).map((b) => b.value).filter(Boolean).slice(0, 200),
      languages: facets.languages ?? [],
    };
    return NextResponse.json(payload);
  } catch (err) {
    return apiError(err);
  }
}

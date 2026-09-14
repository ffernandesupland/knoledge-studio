import { FlowExplorer } from "@/components/flow/FlowExplorer";
import { promptCatalog } from "@/lib/flow/catalog";
import { DEFAULT_FLOW, type FlowOptions } from "@/lib/flow/model";
import "./flow.css";

export default async function FlowPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const query = await searchParams;
  const initial: FlowOptions = { ...DEFAULT_FLOW };
  if (typeof query.options === "string") {
    const enabled = new Set(query.options.split(","));
    for (const key of ["split", "restructure", "standards", "optimize", "dedupe", "gaps", "metadataSuggest"] as const) initial[key] = enabled.has(key);
  }
  if (typeof query.sources === "string") {
    const sources = new Set(query.sources.split(","));
    for (const key of ["text", "file", "url", "existing"] as const) initial[key] = sources.has(key);
  }
  return <FlowExplorer executed={query.view === "executed"} catalog={await promptCatalog()} initial={initial} runId={typeof query.runId === "string" ? query.runId : undefined} />;
}

import SolutionView from "@/components/ks/SolutionView";

export default async function Page({ params, searchParams }: PageProps<"/ai-solution-view/[solutionId]">) {
  const { solutionId } = await params;
  const { connectionId } = await searchParams;
  return <SolutionView solutionId={solutionId} connectionId={typeof connectionId === "string" ? connectionId : undefined} />;
}

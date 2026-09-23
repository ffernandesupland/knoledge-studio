import KnowledgeStudio from "@/components/ks/KnowledgeStudio";

export default async function Page({ searchParams }: { searchParams: Promise<{ autonomousRun?: string | string[]; launch?: string | string[]; reviewHandoff?: string | string[]; sourceSolutionId?: string | string[]; connectionId?: string | string[] }> }) {
  const { autonomousRun, launch, reviewHandoff, sourceSolutionId, connectionId } = await searchParams;
  const initialSource = typeof sourceSolutionId === "string" && /^\d{15}$/.test(sourceSolutionId)
    ? { id: sourceSolutionId, connectionId: typeof connectionId === "string" ? connectionId : undefined }
    : undefined;
  return <KnowledgeStudio initialAutonomousRun={typeof autonomousRun === "string" ? autonomousRun : undefined} initialLaunchId={typeof launch === "string" ? launch : undefined} initialReviewHandoffId={typeof reviewHandoff === "string" ? reviewHandoff : undefined} initialSource={initialSource} />;
}

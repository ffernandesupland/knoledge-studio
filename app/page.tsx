import KnowledgeStudio from "@/components/ks/KnowledgeStudio";

export default async function Page({ searchParams }: { searchParams: Promise<{ autonomousRun?: string | string[] }> }) {
  const { autonomousRun } = await searchParams;
  return <KnowledgeStudio initialAutonomousRun={typeof autonomousRun === "string" ? autonomousRun : undefined} />;
}

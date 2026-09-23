import { ConfigurationProfileManager } from "@/components/settings/ConfigurationProfileManager";

export default function Page() {
  return <ConfigurationProfileManager kind="ground_truth" icon="library_books" title="Ground Truth Management" description="Manage reusable reference context for Knowledge Studio pipelines. Bundles can be selected directly or resolved automatically from a collection and taxonomy scope." />;
}

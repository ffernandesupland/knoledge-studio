import { ConfigurationProfileManager } from "@/components/settings/ConfigurationProfileManager";

export default function Page() {
  return <ConfigurationProfileManager kind="content_standard" icon="rule" title="Solution Standards Management" description="Manage company-wide and scoped content standards. A specific collection or taxonomy profile replaces the company default for matching final articles." />;
}

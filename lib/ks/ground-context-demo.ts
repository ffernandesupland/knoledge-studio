/** Fictional KB records used only by the AI Solution View mockup. */
export const groundContextReferences = [
  {
    id: "SOL-2101",
    title: "Remote access security policy",
    collection: "Information Security",
    status: "Published",
    updated: "Sep 10, 2026",
    summary: "Device and connection requirements for employees accessing internal applications remotely.",
    body: "Employees must use a company-managed device with the approved VPN client to access internal applications remotely. Disconnect the VPN when the work session ends. This policy applies to employee remote access.",
    excerpt: "Employees must use a company-managed device with the approved VPN client to access internal applications remotely.",
    addition: "Before connecting, confirm that you are using a company-managed device with the approved VPN client.",
    field: "Before you begin",
    applicable: true,
  },
  {
    id: "SOL-2102",
    title: "Multi-factor authentication: missing approval requests",
    collection: "IT Support",
    status: "Published",
    updated: "Sep 12, 2026",
    summary: "Recovery guidance when an employee does not receive a sign-in approval request.",
    body: "If an authentication approval request does not arrive, check that the registered device is online and reopen the approved authenticator application. Retry sign-in once. If the request still does not arrive, contact the IT service desk for assistance. Do not approve requests you did not initiate.",
    excerpt: "If an authentication approval request does not arrive, check that the registered device is online and reopen the approved authenticator application. Retry sign-in once.",
    addition: "If the authentication request does not arrive, check that your registered device is online, reopen the authenticator application, and retry sign-in once.",
    field: "Troubleshooting",
    applicable: true,
  },
  {
    id: "SOL-2103",
    title: "Third-party access approval policy",
    collection: "Information Security",
    status: "Published",
    updated: "Sep 8, 2026",
    summary: "Approval and sponsorship requirements for external vendors.",
    body: "External vendors need a named internal sponsor and an approved access request before receiving temporary access. This policy applies to third-party vendor accounts; employee access is covered separately.",
    excerpt: "",
    addition: "",
    field: "",
    applicable: false,
  },
  {
    id: "SOL-1904",
    title: "Remote access security policy — legacy",
    collection: "Information Security",
    status: "Archived",
    updated: "Jan 15, 2025",
    summary: "An older policy retained for historical reference.",
    body: "This policy has been superseded by SOL-2101. Use the published Remote access security policy for current guidance.",
    excerpt: "",
    addition: "",
    field: "",
    applicable: false,
  },
] as const;

export type GroundContextReference = typeof groundContextReferences[number];
export interface GroundContextSelection {
  enabled: boolean;
  referenceIds: string[];
  guidance: string;
}
export const emptyGroundContext: GroundContextSelection = {
  enabled: false,
  referenceIds: [],
  guidance: "",
};
export function selectedGroundReferences(selection: GroundContextSelection) {
  return groundContextReferences.filter(reference => selection.referenceIds.includes(reference.id));
}
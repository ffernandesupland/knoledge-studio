export type AgentMessageRole = "user" | "assistant";
export type AgentContextRole = "reference" | "target" | "standard";

export interface AgentThread {
  id: string;
  owner: string;
  title: string;
  connectionId: string;
  createdAt: string;
  updatedAt: string;
}

export interface AgentMessage {
  id: string;
  threadId: string;
  role: AgentMessageRole;
  content: string;
  html?: string;
  attachments: AgentAttachment[];
  createdAt: string;
}

export interface AgentAttachment {
  id: string;
  label: string;
  text: string;
  kind: "pdf" | "docx" | "text" | "image";
  imageId?: string;
  fileId?: string;
  meta: string;
}

export interface AgentContextItem {
  id: string;
  threadId: string;
  solutionId: string;
  title: string;
  role: AgentContextRole;
  snapshot: SolutionSnapshot;
  createdAt: string;
}

export interface SolutionSnapshot {
  id: string;
  title: string;
  status: string;
  summary?: string;
  templateName?: string | null;
  language?: string;
  collections?: string[];
  taxonomy?: string[];
  fields: { name: string; content: string }[];
}

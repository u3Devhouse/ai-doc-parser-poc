export type FieldType =
  | "string"
  | "date"
  | "number"
  | "boolean"
  | "string[]"
  | "text";

export type FlowType = "extraction" | "discovery";

export interface TemplateField {
  name: string;
  type: FieldType;
  required: boolean;
  description?: string;
}

export interface TemplateSide {
  fields: TemplateField[];
}

export interface Template {
  templateKey: string;
  category: "identity" | "contract" | "legal";
  version: number;
  paired: boolean;
  description?: string;
  fields?: TemplateField[];
  sides?: {
    front?: TemplateSide;
    back?: TemplateSide;
  };
}

export interface ExtractSuccessResponse {
  flow: FlowType;
  templateKey: string;
  schema: Template;
  data: Record<string, unknown>;
}

export interface ApiErrorResponse {
  error: string;
  message: string;
  expectedTemplateKey?: string;
  detectedTemplateKey?: string;
}

export interface DiscoverProposal {
  proposalId: string;
  proposedTemplateKey: string;
  category: Template["category"];
  paired: boolean;
  fields?: TemplateField[];
  sides?: Template["sides"];
}

export interface ProposalSummary extends DiscoverProposal {
  createdAt: string;
  source: "admin" | "extract";
}

export type SessionMessage = {
  role: "user" | "assistant";
  content: string;
};

export interface DiscoverySession extends DiscoverProposal {
  documentSummary: string;
  messages: SessionMessage[];
  revisionCount: number;
}

export interface DiscoverCreateResponse extends DiscoverProposal {
  documentSummary: string;
}

export interface ClassificationResult {
  templateKey: string;
  category: Template["category"];
  match: boolean;
}

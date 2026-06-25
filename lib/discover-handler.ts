import { convertToModelMessages, streamText, type UIMessage } from "ai";
import { GatewayAuthenticationError, GatewayError } from "@ai-sdk/gateway";
import { gateway } from "@ai-sdk/gateway";
import { saveTemplate } from "./template-store";
import { extractionFailureMessage, isExtractionFailure, SchemaDefinitionResponseError } from "./extraction-errors";
import {
  countUploadSides,
  deleteProposal,
  extractStructured,
  getProposal,
  isReadableData,
  proposeSchema,
  reviseSchema,
  summarizeDocument,
  validatePairedUpload,
  type AiOverrides,
  type ExtractionInput,
} from "./extraction";
import { createDiscoverySchemaTools } from "./discovery-schema-tools";
import { listProposals, updateProposalSession, type ProposalSummary } from "./proposal-store";
import { parseUploadFormData, UploadError } from "./upload";
import type {
  ApiErrorResponse,
  DiscoverCreateResponse,
  DiscoverProposal,
  DiscoverySession,
  SessionMessage,
  Template,
} from "./types";
import { normalizeTemplateForExtraction } from "./schema";

export type DiscoverHandlerResult =
  | { status: 200; body: DiscoverCreateResponse }
  | { status: 400 | 401 | 404 | 422; body: ApiErrorResponse };

export type ListProposalsResult =
  | { status: 200; body: { proposals: ProposalSummary[] } }
  | { status: 401; body: ApiErrorResponse };

export type GetProposalResult =
  | { status: 200; body: DiscoverySession }
  | { status: 404; body: ApiErrorResponse };

export type ReviseHandlerResult =
  | { status: 200; body: DiscoverySession }
  | { status: 404; body: ApiErrorResponse };

export type UpdateDraftResult =
  | { status: 200; body: DiscoverySession }
  | { status: 404; body: ApiErrorResponse };

export type ApproveHandlerResult =
  | { status: 200; body: { templateKey: string; schema: Template; data: Record<string, unknown>; saved: boolean } }
  | { status: 400 | 404 | 422 | 502 | 503; body: ApiErrorResponse };

function toExtractionInput(files: Awaited<ReturnType<typeof parseUploadFormData>>): ExtractionInput {
  const input: ExtractionInput = {
    buffers: files.map((f) => f.buffer),
    mimeTypes: files.map((f) => f.mimeType),
    filenames: files.map((f) => f.filename),
  };
  if (files.some((f) => f.text !== undefined)) {
    input.texts = files.map((f) => f.text ?? "");
  }
  return input;
}

function storedToSession(stored: NonNullable<Awaited<ReturnType<typeof getProposal>>>): DiscoverySession {
  return {
    proposalId: stored.proposalId,
    proposedTemplateKey: stored.proposedTemplateKey,
    category: stored.category,
    paired: stored.paired,
    fields: stored.fields,
    sides: stored.sides,
    documentSummary: stored.documentSummary,
    messages: stored.messages,
    revisionCount: stored.revisionCount,
  };
}

function storedToInput(stored: NonNullable<Awaited<ReturnType<typeof getProposal>>>): ExtractionInput {
  return {
    buffers: stored.buffers,
    mimeTypes: stored.mimeTypes,
    filenames: stored.filenames,
  };
}

function getDiscoveryModelId(): string {
  return process.env.DISCOVERY_MODEL ?? "openai/gpt-4o";
}

function buildChatSystemPrompt(session: DiscoverySession): string {
  return [
    "You help a schema administrator refine an extraction schema for a source document.",
    "Be consultative: ask clarifying questions when the request is ambiguous, and discuss what should or should not exist before changing the schema.",
    "Do not call schema tools on every message. Only mutate the draft after the admin gives a clear instruction or explicitly confirms a change (e.g. \"yes\", \"go ahead\", \"apply that\").",
    "When you are about to apply agreed changes, briefly say you are applying them (e.g. \"OK, applying fixes\") and then use the schema tools.",
    "If the admin is exploring options, respond with questions and recommendations without using tools.",
    "Do not invent fields that are not supported by the document context.",
    `Document summary: ${session.documentSummary}`,
    `Current template key: ${session.proposedTemplateKey}`,
    `Category: ${session.category}`,
    `Paired: ${session.paired}`,
    `Current fields: ${JSON.stringify(session.fields ?? session.sides ?? [])}`,
  ].join("\n");
}

function normalizeApprovalTemplate(
  stored: NonNullable<Awaited<ReturnType<typeof getProposal>>>,
  bodyTemplate?: Template,
): Template {
  const source =
    bodyTemplate ??
    ({
      templateKey: stored.proposedTemplateKey,
      category: stored.category,
      version: 1,
      paired: stored.paired,
      fields: stored.fields,
      sides: stored.sides,
    } satisfies Template);

  if (source.paired) {
    return normalizeTemplateForExtraction({
      templateKey: source.templateKey || stored.proposedTemplateKey,
      category: source.category,
      version: source.version ?? 1,
      paired: true,
      sides: source.sides ?? stored.sides,
    });
  }

  const fields =
    source.fields && source.fields.length > 0 ? source.fields : (stored.fields ?? []);

  return normalizeTemplateForExtraction({
    templateKey: source.templateKey || stored.proposedTemplateKey,
    category: source.category,
    version: source.version ?? 1,
    paired: false,
    fields,
  });
}

function validateTemplateForApproval(template: Template): ApproveHandlerResult | null {
  if (template.paired) {
    const frontCount = template.sides?.front?.fields?.length ?? 0;
    const backCount = template.sides?.back?.fields?.length ?? 0;
    if (frontCount === 0 && backCount === 0) {
      return {
        status: 422,
        body: {
          error: "invalid_schema",
          message: "Paired template requires field definitions on the front or back side",
        },
      };
    }
    return null;
  }

  if ((template.fields?.length ?? 0) === 0) {
    return {
      status: 422,
      body: { error: "invalid_schema", message: "Template requires at least one field" },
    };
  }

  return null;
}

function mapExtractionError(error: unknown): ApproveHandlerResult | null {
  if (error instanceof SchemaDefinitionResponseError) {
    return {
      status: 422,
      body: {
        error: "schema_mismatch",
        message: error.message,
      },
    };
  }

  if (isExtractionFailure(error)) {
    return {
      status: 422,
      body: {
        error: "extraction_failed",
        message: extractionFailureMessage(error),
      },
    };
  }

  if (GatewayAuthenticationError.isInstance(error)) {
    return {
      status: 503,
      body: {
        error: "ai_not_configured",
        message:
          "Set AI_GATEWAY_API_KEY for real extraction, or AI_GATEWAY_MOCK=true for local mock responses.",
      },
    };
  }

  if (GatewayError.isInstance(error)) {
    const statusCode = error.statusCode >= 400 && error.statusCode < 600 ? error.statusCode : 502;
    return {
      status: statusCode === 503 ? 503 : 422,
      body: { error: "ai_gateway_error", message: error.message },
    };
  }

  if (error instanceof Error && error.name === "GatewayAuthenticationError") {
    return {
      status: 503,
      body: {
        error: "ai_not_configured",
        message:
          "Set AI_GATEWAY_API_KEY for real extraction, or AI_GATEWAY_MOCK=true for local mock responses.",
      },
    };
  }

  return null;
}

export async function handleListProposals(): Promise<ListProposalsResult> {
  const proposals = await listProposals();
  return { status: 200, body: { proposals } };
}

export async function handleGetProposal(proposalId: string): Promise<GetProposalResult> {
  const stored = await getProposal(proposalId);
  if (!stored) {
    return { status: 404, body: { error: "proposal_not_found", message: "Proposal not found or expired" } };
  }

  return { status: 200, body: storedToSession(stored) };
}

export async function handleDiscover(
  formData: FormData,
  overrides?: AiOverrides,
): Promise<DiscoverHandlerResult> {
  let files;
  try {
    files = await parseUploadFormData(formData);
  } catch (err) {
    if (err instanceof UploadError) {
      return { status: 400, body: { error: err.code, message: err.message } };
    }
    throw err;
  }

  const input = toExtractionInput(files);
  const documentSummary = await summarizeDocument(input, overrides);
  const proposal = await proposeSchema(input, overrides, "admin", documentSummary);

  return {
    status: 200,
    body: {
      ...proposal,
      documentSummary,
    },
  };
}

export async function handleUpdateDraft(
  proposalId: string,
  draft: Partial<DiscoverProposal>,
): Promise<UpdateDraftResult> {
  const stored = await getProposal(proposalId);
  if (!stored) {
    return { status: 404, body: { error: "proposal_not_found", message: "Proposal not found or expired" } };
  }

  const updated = await updateProposalSession(proposalId, {
    proposal: {
      proposedTemplateKey: draft.proposedTemplateKey ?? stored.proposedTemplateKey,
      category: draft.category ?? stored.category,
      paired: draft.paired ?? stored.paired,
      fields: draft.fields ?? stored.fields,
      sides: draft.sides ?? stored.sides,
    },
  });

  if (!updated) {
    return { status: 404, body: { error: "proposal_not_found", message: "Proposal not found or expired" } };
  }

  return { status: 200, body: storedToSession(updated) };
}

export async function handleRevise(proposalId: string, overrides?: AiOverrides): Promise<ReviseHandlerResult> {
  const stored = await getProposal(proposalId);
  if (!stored) {
    return { status: 404, body: { error: "proposal_not_found", message: "Proposal not found or expired" } };
  }

  const currentSession = storedToSession(stored);
  const revised = await reviseSchema(
    storedToInput(stored),
    {
      currentProposal: currentSession,
      documentSummary: stored.documentSummary,
      recentMessages: stored.messages,
    },
    overrides,
  );

  const mergedProposal: DiscoverProposal = {
    ...currentSession,
    ...revised,
    proposalId: stored.proposalId,
  };

  const documentSummary = await summarizeDocument(storedToInput(stored), overrides, {
    currentProposal: mergedProposal,
    recentMessages: stored.messages,
    revisionNote: "Document re-review: update the summary to match the cached upload and the refined draft schema.",
  });

  const updated = await updateProposalSession(proposalId, {
    proposal: mergedProposal,
    documentSummary,
    revisionCount: stored.revisionCount + 1,
  });

  if (!updated) {
    return { status: 404, body: { error: "proposal_not_found", message: "Proposal not found or expired" } };
  }

  return { status: 200, body: storedToSession(updated) };
}

export type ChatHandlerResult =
  | { kind: "stream"; response: Response }
  | { kind: "error"; status: 404; body: ApiErrorResponse };

export async function handleChat(
  proposalId: string,
  uiMessages: UIMessage[],
  overrides?: AiOverrides,
): Promise<ChatHandlerResult> {
  const stored = await getProposal(proposalId);
  if (!stored) {
    return { kind: "error", status: 404, body: { error: "proposal_not_found", message: "Proposal not found or expired" } };
  }

  let draft: DiscoverProposal = {
    proposalId: stored.proposalId,
    proposedTemplateKey: stored.proposedTemplateKey,
    category: stored.category,
    paired: stored.paired,
    fields: stored.fields,
    sides: stored.sides,
  };

  const session = storedToSession(stored);
  const tools = createDiscoverySchemaTools((mutator) => {
    draft = mutator(draft);
  });

  const lastUserMessage = [...uiMessages].reverse().find((message) => message.role === "user");
  const userText =
    lastUserMessage?.parts
      ?.filter((part) => part.type === "text")
      .map((part) => part.text)
      .join("\n") ?? "";

  const streamOptions = {
    model: gateway(getDiscoveryModelId()),
    system: buildChatSystemPrompt(session),
    messages: convertToModelMessages(uiMessages),
    tools,
    onFinish: async ({ text }: { text: string }) => {
      const nextMessages: SessionMessage[] = [
        ...stored.messages,
        ...(userText ? [{ role: "user" as const, content: userText }] : []),
        ...(text ? [{ role: "assistant" as const, content: text }] : []),
      ];
      await updateProposalSession(proposalId, {
        proposal: draft,
        messages: nextMessages,
      });
    },
  };

  if (overrides?.streamText) {
    const result = await overrides.streamText(streamOptions);
    if (result.toUIMessageStreamResponse) {
      return { kind: "stream", response: result.toUIMessageStreamResponse() };
    }
    return {
      kind: "stream",
      response: new Response(result.text, {
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      }),
    };
  }

  const result = streamText(streamOptions);
  return { kind: "stream", response: result.toUIMessageStreamResponse() };
}

export async function handleApprove(
  proposalId: string,
  body: { template?: Template; save?: boolean },
  overrides?: AiOverrides,
): Promise<ApproveHandlerResult> {
  const stored = await getProposal(proposalId);
  if (!stored) {
    return { status: 404, body: { error: "proposal_not_found", message: "Proposal not found or expired" } };
  }

  const template = normalizeApprovalTemplate(stored, body.template);

  const schemaValidation = validateTemplateForApproval(template);
  if (schemaValidation) {
    return schemaValidation;
  }

  const input: ExtractionInput = {
    buffers: stored.buffers,
    mimeTypes: stored.mimeTypes,
    filenames: stored.filenames,
  };

  const sideCount = await countUploadSides(input);
  const pairedValidation = validatePairedUpload(template, sideCount);
  if (!pairedValidation.ok) {
    return {
      status: 422,
      body: {
        error: pairedValidation.error ?? "incomplete",
        message: "Paired identity document requires front and back sides in the upload",
      },
    };
  }

  let data: Record<string, unknown>;
  try {
    data = await extractStructured(template, input, overrides);
  } catch (error) {
    const mapped = mapExtractionError(error);
    if (mapped) {
      return mapped;
    }
    throw error;
  }

  if (!isReadableData(data)) {
    return { status: 422, body: { error: "unreadable", message: "Required content is not readable" } };
  }

  let saved = false;
  if (body.save) {
    await saveTemplate(template);
    saved = true;
  }

  await deleteProposal(proposalId);

  return {
    status: 200,
    body: { templateKey: template.templateKey, schema: template, data, saved },
  };
}

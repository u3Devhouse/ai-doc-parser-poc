import { generateObject, generateText, NoObjectGeneratedError } from "ai";
import { gateway } from "@ai-sdk/gateway";
import { z } from "zod";
import {
  ExtractionFailedError,
  SchemaDefinitionResponseError,
  getExtractionModelIds,
  type ExtractionFailureContext,
} from "./extraction-errors";
import {
  buildProposalZodSchema,
  buildRelaxedExtractionSchema,
  coerceExtractionData,
  countTemplateFields,
  isProposalZodShape,
  looksLikeSchemaDefinitionResponse,
  normalizeTemplateForExtraction,
  stripProposalMetadata,
  tryRepairSchemaDefinitionResponse,
} from "./schema";
import {
  buildDiscoveryPrompt,
  buildExtractionPrompt,
  EXTRACTION_SYSTEM_MESSAGE,
} from "./extraction-prompt";
import { parsePdfToText, renderPdfPagesToImages, isPdf, isImage, getPdfPageCount } from "./pdf";
import { deleteProposal, getProposal, saveProposal, type ProposalSource } from "./proposal-store";
import { listTemplates } from "./template-store";
import type {
  ClassificationResult,
  DiscoverProposal,
  SessionMessage,
  Template,
  TemplateField,
} from "./types";

export { deleteProposal, getProposal } from "./proposal-store";

export type ExtractionInput = {
  buffers: Buffer[];
  mimeTypes: string[];
  filenames: string[];
  texts?: string[];
  pageCounts?: number[];
};

export type AiGenerateObject = (options: unknown) => Promise<{ object: unknown }>;
export type AiGenerateText = (options: unknown) => Promise<{ text: string }>;

export type AiStreamText = (options: unknown) => Promise<{
  text: string;
  toUIMessageStreamResponse?: () => Response;
}>;

export type AiOverrides = {
  generateObject?: AiGenerateObject;
  generateText?: AiGenerateText;
  streamText?: AiStreamText;
};

function getModelId(envKey: string, fallback: string): string {
  return process.env[envKey] ?? fallback;
}

function getTwoStageFieldThreshold(): number {
  const configured = Number(process.env.EXTRACTION_TWO_STAGE_FIELD_THRESHOLD ?? 15);
  return Number.isFinite(configured) && configured > 0 ? configured : 15;
}

function shouldForceTwoStage(template: Template): boolean {
  return template.category === "legal" || countTemplateFields(template) > getTwoStageFieldThreshold();
}

function resolveExtractionPipeline(template: Template): "single" | "two-stage" {
  const configured = process.env.EXTRACTION_PIPELINE ?? "auto";
  if (configured === "two-stage" || shouldForceTwoStage(template)) {
    return "two-stage";
  }
  if (configured === "single") {
    return "single";
  }
  return "single";
}

function tryRecoverFromModelText(
  text: string,
  template: Template,
): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }

    if (looksLikeSchemaDefinitionResponse(parsed)) {
      return tryRepairSchemaDefinitionResponse(parsed, template);
    }

    return coerceExtractionData(stripProposalMetadata(parsed), template);
  } catch {
    return null;
  }
}

type ContentMode = "vision" | "text";

type BuffersToContentOptions = {
  contentMode?: ContentMode;
  promptMode?: "extraction" | "discovery";
};

function contentHasImages(
  content: Array<{ type: "text"; text: string } | { type: "image"; image: Buffer }>,
): boolean {
  return content.some((part) => part.type === "image");
}

function assertExtractionGenerateObjectOptions(options: Record<string, unknown>): void {
  const schema = options.schema as { shape?: Record<string, unknown> } | undefined;
  if (isProposalZodShape(schema?.shape)) {
    throw new Error("Proposal schema passed to extraction generateObject");
  }
}

function finalizeStructuredExtractionResult(
  object: Record<string, unknown>,
  template: Template,
): Record<string, unknown> {
  if (looksLikeSchemaDefinitionResponse(object)) {
    const repaired = tryRepairSchemaDefinitionResponse(object, template);
    if (repaired) {
      return repaired;
    }
    throw new SchemaDefinitionResponseError(object, template.templateKey);
  }
  return coerceExtractionData(object, template);
}

function buildExtractionGenerateOptions(
  content: string | Array<{ type: "text"; text: string } | { type: "image"; image: Buffer }>,
  schema: ReturnType<typeof buildRelaxedExtractionSchema>,
): Record<string, unknown> {
  if (typeof content === "string") {
    return {
      schema,
      system: EXTRACTION_SYSTEM_MESSAGE,
      prompt: content,
    };
  }

  return {
    schema,
    system: EXTRACTION_SYSTEM_MESSAGE,
    messages: [{ role: "user", content }],
  };
}

async function generateStructuredObject(
  generateObjectFn: AiGenerateObject,
  primaryModelId: string,
  options: Record<string, unknown>,
  template?: Template,
): Promise<Record<string, unknown>> {
  assertExtractionGenerateObjectOptions(options);
  const modelIds = getExtractionModelIds(primaryModelId);

  let lastError: unknown;
  for (const modelId of modelIds) {
    try {
      const { object } = await generateObjectFn({
        ...options,
        model: gateway(modelId),
      });
      const record = object as Record<string, unknown>;
      if (template) {
        return finalizeStructuredExtractionResult(record, template);
      }
      return record;
    } catch (error) {
      lastError = error;
      if (error instanceof SchemaDefinitionResponseError) {
        throw error;
      }
      if (NoObjectGeneratedError.isInstance(error) && template && error.text) {
        const recovered = tryRecoverFromModelText(error.text, template);
        if (recovered && Object.keys(recovered).length > 0) {
          return recovered;
        }
      }
      if (!NoObjectGeneratedError.isInstance(error)) {
        throw error;
      }
    }
  }

  throw lastError;
}

async function buffersToContent(
  input: ExtractionInput,
  template?: Template,
  options?: BuffersToContentOptions,
): Promise<Array<{ type: "text"; text: string } | { type: "image"; image: Buffer }>> {
  const useVision = options?.contentMode !== "text" && Boolean(template);
  const promptMode = options?.promptMode ?? (template ? "extraction" : "discovery");
  const promptText =
    promptMode === "discovery"
      ? buildDiscoveryPrompt()
      : buildExtractionPrompt(
          template ?? {
            templateKey: "generic",
            category: "contract",
            version: 1,
            paired: false,
          },
        );

  const content: Array<{ type: "text"; text: string } | { type: "image"; image: Buffer }> = [
    { type: "text", text: promptText },
  ];

  for (let i = 0; i < input.buffers.length; i++) {
    const buffer = input.buffers[i];
    const mime = input.mimeTypes[i] ?? "application/octet-stream";
    const name = input.filenames[i] ?? "file";

    if (isPdf(mime, name)) {
      if (useVision) {
        const pageImages = await renderPdfPagesToImages(buffer);
        const sideLabels = template?.paired ? ["front", "back"] : [];

        for (let pageIndex = 0; pageIndex < pageImages.length; pageIndex++) {
          const side = sideLabels[pageIndex] ?? `page ${pageIndex + 1}`;
          content.push({
            type: "text",
            text: `Document ${side} (${name}, page ${pageIndex + 1} of ${pageImages.length}):`,
          });
          content.push({ type: "image", image: pageImages[pageIndex] });
        }

        continue;
      }

      const text = input.texts?.[i] ?? (await parsePdfToText(buffer));
      content.push({ type: "text", text: `PDF page content (${name}):\n${text}` });
    } else {
      content.push({ type: "image", image: buffer });
    }
  }

  return content;
}

async function runTwoStageExtraction(
  template: Template,
  input: ExtractionInput,
  generateObjectFn: AiGenerateObject,
  overrides?: AiOverrides,
): Promise<Record<string, unknown>> {
  const generateTextFn = overrides?.generateText ?? generateText;
  const visionModelId = getModelId("VISION_MODEL", "openai/gpt-4o");
  const structureModelId = getModelId("STRUCTURE_MODEL", "openai/gpt-4o-mini");
  const normalizedTemplate = normalizeTemplateForExtraction(template);
  const schema = buildRelaxedExtractionSchema(normalizedTemplate);
  const content = await buffersToContent(input, normalizedTemplate);

  const { text: visionOutput } = await generateTextFn({
    model: gateway(visionModelId),
    system: EXTRACTION_SYSTEM_MESSAGE,
    messages: [{ role: "user", content }],
  });

  return generateStructuredObject(
    generateObjectFn,
    structureModelId,
    buildExtractionGenerateOptions(
      "Map the following document content to extracted field values. " +
        "Return only populated field values (strings, numbers, booleans, dates), not schema definitions.\n\n" +
        visionOutput,
      schema,
    ),
    normalizedTemplate,
  );
}

async function runSingleStageExtraction(
  template: Template,
  input: ExtractionInput,
  generateObjectFn: AiGenerateObject,
  extractionModelId: string,
  contentMode: ContentMode,
): Promise<Record<string, unknown>> {
  const normalizedTemplate = normalizeTemplateForExtraction(template);
  const schema = buildRelaxedExtractionSchema(normalizedTemplate);
  const content = await buffersToContent(input, normalizedTemplate, { contentMode });

  return generateStructuredObject(
    generateObjectFn,
    extractionModelId,
    buildExtractionGenerateOptions(content, schema),
    normalizedTemplate,
  );
}

export async function extractStructured(
  template: Template,
  input: ExtractionInput,
  overrides?: AiOverrides,
): Promise<Record<string, unknown>> {
  const normalizedTemplate = normalizeTemplateForExtraction(template);
  const generateObjectFn = (overrides?.generateObject ?? generateObject) as AiGenerateObject;
  const pipeline = resolveExtractionPipeline(normalizedTemplate);
  const extractionModelId = getModelId("EXTRACTION_MODEL", "openai/gpt-4o");
  const modelsTried = getExtractionModelIds(extractionModelId);
  const strategiesTried: string[] = [];
  const failureContext = (): ExtractionFailureContext => ({ modelsTried, strategiesTried });

  if (pipeline === "two-stage") {
    strategiesTried.push("two-stage");
    return runTwoStageExtraction(normalizedTemplate, input, generateObjectFn, overrides);
  }

  let lastError: unknown;

  try {
    strategiesTried.push("single-stage-vision");
    const visionContent = await buffersToContent(input, normalizedTemplate);
    if (!contentHasImages(visionContent)) {
      strategiesTried[strategiesTried.length - 1] = "single-stage-text";
    }

    return await generateStructuredObject(
      generateObjectFn,
      extractionModelId,
      buildExtractionGenerateOptions(visionContent, buildRelaxedExtractionSchema(normalizedTemplate)),
      normalizedTemplate,
    );
  } catch (error) {
    lastError = error;
    if (error instanceof SchemaDefinitionResponseError) {
      throw error;
    }
    if (!NoObjectGeneratedError.isInstance(error)) {
      throw error;
    }
  }

  try {
    strategiesTried.push("two-stage-fallback");
    return await runTwoStageExtraction(normalizedTemplate, input, generateObjectFn, overrides);
  } catch (error) {
    lastError = error;
    if (error instanceof SchemaDefinitionResponseError) {
      throw error;
    }
    if (!NoObjectGeneratedError.isInstance(error)) {
      throw error;
    }
  }

  try {
    strategiesTried.push("single-stage-text");
    return await runSingleStageExtraction(
      normalizedTemplate,
      input,
      generateObjectFn,
      extractionModelId,
      "text",
    );
  } catch (error) {
    lastError = error;
    if (error instanceof SchemaDefinitionResponseError) {
      throw error;
    }
    if (!NoObjectGeneratedError.isInstance(error)) {
      throw error;
    }
  }

  throw new ExtractionFailedError(lastError, failureContext());
}

function classificationMatches(
  detected: { templateKey: string; category: Template["category"] },
  expectedTemplateKey: string | undefined,
  expectedTemplate: Template | undefined,
  libraryKeys: string[],
): boolean {
  if (!expectedTemplateKey || !expectedTemplate) {
    return libraryKeys.includes(detected.templateKey);
  }

  if (detected.templateKey === expectedTemplateKey) {
    return true;
  }

  // Model often invents keys (e.g. identity_document) outside the library.
  if (!libraryKeys.includes(detected.templateKey) && detected.category === expectedTemplate.category) {
    return true;
  }

  return false;
}

function buildClassificationPrompt(
  libraryKeys: string[],
  expectedTemplateKey?: string,
  expectedTemplate?: Template,
): string {
  const libraryList = libraryKeys.length > 0 ? libraryKeys.join(", ") : "none";

  if (expectedTemplateKey && expectedTemplate) {
    const description = expectedTemplate.description ? ` ${expectedTemplate.description}` : "";
    return `The sender specified templateKey "${expectedTemplateKey}" (${expectedTemplate.category} document).${description} Determine whether this upload matches that document type. If it matches, return templateKey exactly as "${expectedTemplateKey}". If it does not match, return the closest templateKey from this library: ${libraryList}.`;
  }

  return `Classify this document. Return templateKey as exactly one of these library keys: ${libraryList}.`;
}

export async function classifyDocument(
  input: ExtractionInput,
  expectedTemplateKey?: string,
  overrides?: AiOverrides,
): Promise<ClassificationResult> {
  const generateObjectFn = overrides?.generateObject ?? generateObject;
  const model = gateway(getModelId("CLASSIFICATION_MODEL", "openai/gpt-4o-mini"));
  const templates = await listTemplates();
  const libraryKeys = templates.map((template) => template.templateKey);
  const expectedTemplate = expectedTemplateKey
    ? templates.find((template) => template.templateKey === expectedTemplateKey)
    : undefined;
  const classificationPrompt = buildClassificationPrompt(libraryKeys, expectedTemplateKey, expectedTemplate);

  const classificationSchema = z.object({
    templateKey: z.string(),
    category: z.enum(["identity", "contract", "legal"]),
  });

  const content = await buffersToContent(input);

  const { object } = await generateObjectFn({
    model,
    schema: classificationSchema,
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: classificationPrompt },
          ...content.filter((c) => c.type === "text" || c.type === "image"),
        ],
      },
    ],
  });

  const detected = object as { templateKey: string; category: "identity" | "contract" | "legal" };

  const result = {
    templateKey: detected.templateKey,
    category: detected.category,
    match: classificationMatches(detected, expectedTemplateKey, expectedTemplate, libraryKeys),
  };

  return result;
}

export type DocumentSummaryContext = {
  currentProposal?: DiscoverProposal;
  recentMessages?: SessionMessage[];
  revisionNote?: string;
};

function buildSummaryPrompt(context?: DocumentSummaryContext): string {
  const base =
    "Summarize this source document for a schema administrator. Include document category, layout, sides (if identity), language, and notable visible labels. Keep the summary to 2-4 short sentences.";

  if (!context) {
    return base;
  }

  const parts = [
    context.revisionNote ??
      "Re-read the cached source document and write an updated summary that reflects the current draft schema context.",
    context.currentProposal
      ? `Current draft schema: ${JSON.stringify({
          proposedTemplateKey: context.currentProposal.proposedTemplateKey,
          category: context.currentProposal.category,
          paired: context.currentProposal.paired,
          fields: context.currentProposal.fields,
          sides: context.currentProposal.sides,
        })}`
      : "",
    context.recentMessages?.length
      ? `Recent refinement conversation:\n${context.recentMessages
          .slice(-6)
          .map((message) => `${message.role}: ${message.content}`)
          .join("\n")}`
      : "",
    base,
  ].filter(Boolean);

  return parts.join("\n\n");
}

export async function summarizeDocument(
  input: ExtractionInput,
  overrides?: AiOverrides,
  context?: DocumentSummaryContext,
): Promise<string> {
  const generateTextFn = overrides?.generateText ?? generateText;
  const model = gateway(getModelId("DISCOVERY_MODEL", "openai/gpt-4o"));
  const content = await buffersToContent(input);

  const { text } = await generateTextFn({
    model,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: buildSummaryPrompt(context),
          },
          ...content.filter((part) => part.type === "text" || part.type === "image"),
        ],
      },
    ],
  });

  return text.trim();
}

function buildProposalFromObject(
  object: z.infer<ReturnType<typeof buildProposalZodSchema>>,
  proposalId: string,
): DiscoverProposal {
  return {
    proposalId,
    proposedTemplateKey: object.proposedTemplateKey,
    category: object.category,
    paired: object.paired,
    fields: (object.fields as TemplateField[] | undefined)?.map((field) => ({ ...field, required: false })),
    sides: object.sides as DiscoverProposal["sides"],
  };
}

function buildRevisePrompt(
  documentSummary: string,
  currentProposal: DiscoverProposal,
  recentMessages: SessionMessage[],
): string {
  const conversation = recentMessages
    .slice(-6)
    .map((message) => `${message.role}: ${message.content}`)
    .join("\n");

  return [
    "Re-review the cached source document and refine the extraction schema proposal.",
    `Document summary: ${documentSummary}`,
    `Current draft schema: ${JSON.stringify({
      proposedTemplateKey: currentProposal.proposedTemplateKey,
      category: currentProposal.category,
      paired: currentProposal.paired,
      fields: currentProposal.fields,
      sides: currentProposal.sides,
    })}`,
    conversation ? `Recent refinement conversation:\n${conversation}` : "",
    "All fields must remain optional (required: false). Preserve proposal intent unless the document contradicts it.",
  ]
    .filter(Boolean)
    .join("\n\n");
}

export async function reviseSchema(
  input: ExtractionInput,
  context: {
    currentProposal: DiscoverProposal;
    documentSummary: string;
    recentMessages: SessionMessage[];
  },
  overrides?: AiOverrides,
): Promise<DiscoverProposal> {
  const generateObjectFn = overrides?.generateObject ?? generateObject;
  const model = gateway(getModelId("DISCOVERY_MODEL", "openai/gpt-4o"));
  const content = await buffersToContent(input, undefined, { promptMode: "discovery" });
  const prompt = buildRevisePrompt(
    context.documentSummary,
    context.currentProposal,
    context.recentMessages,
  );

  const { object: rawObject } = await generateObjectFn({
    model,
    schema: buildProposalZodSchema(),
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: prompt },
          ...content.filter((part) => part.type === "text" || part.type === "image"),
        ],
      },
    ],
  });

  const object = rawObject as z.infer<ReturnType<typeof buildProposalZodSchema>>;
  return buildProposalFromObject(object, context.currentProposal.proposalId);
}

export async function proposeSchema(
  input: ExtractionInput,
  overrides?: AiOverrides,
  source: ProposalSource = "admin",
  documentSummary = "",
): Promise<DiscoverProposal> {
  const generateObjectFn = overrides?.generateObject ?? generateObject;
  const model = gateway(getModelId("DISCOVERY_MODEL", "openai/gpt-4o"));

  const content = await buffersToContent(input, undefined, { promptMode: "discovery" });

  const { object: rawObject } = await generateObjectFn({
    model,
    schema: buildProposalZodSchema(),
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: "Propose an extraction schema for this document. All fields optional.",
          },
          ...content.filter((c) => c.type === "text" || c.type === "image"),
        ],
      },
    ],
  });

  const object = rawObject as z.infer<ReturnType<typeof buildProposalZodSchema>>;

  const proposalId = `prop_${Date.now()}`;
  const proposal = buildProposalFromObject(object, proposalId);

  await saveProposal(proposal, { ...input, documentSummary }, source);
  return proposal;
}

export function validatePairedUpload(template: Template, sideCount: number): { ok: boolean; error?: string } {
  if (!template.paired) {
    return { ok: true };
  }
  if (sideCount < 2) {
    return { ok: false, error: "incomplete" };
  }
  return { ok: true };
}

export async function countUploadSides(input: ExtractionInput): Promise<number> {
  let sideCount = 0;

  for (let i = 0; i < input.buffers.length; i++) {
    const mime = input.mimeTypes[i] ?? "application/octet-stream";
    const name = input.filenames[i] ?? "file";

    if (isPdf(mime, name)) {
      sideCount += input.pageCounts?.[i] ?? (await getPdfPageCount(input.buffers[i]));
      continue;
    }

    if (isImage(mime)) {
      sideCount += 1;
      continue;
    }

    sideCount += 1;
  }

  return sideCount;
}

export function isReadableData(data: Record<string, unknown>): boolean {
  const values = JSON.stringify(data);
  if (!values || values === "{}" || values === '{"sides":{}}') {
    return false;
  }
  return true;
}

import { NoObjectGeneratedError } from "ai";
import { looksLikeSchemaDefinitionResponse } from "./schema";

export type ExtractionFailureContext = {
  modelsTried: string[];
  strategiesTried: string[];
};

export class SchemaDefinitionResponseError extends Error {
  readonly templateKey: string;
  readonly responsePreview: string;

  constructor(value: unknown, templateKey: string) {
    const preview = JSON.stringify(value);
    const clipped = preview.length > 160 ? `${preview.slice(0, 160)}…` : preview;
    super(
      `Model returned a schema definition instead of extracted field values for template "${templateKey}". ` +
        `Response preview: ${clipped}`,
    );
    this.name = "SchemaDefinitionResponseError";
    this.templateKey = templateKey;
    this.responsePreview = clipped;
  }
}

export class ExtractionFailedError extends Error {
  readonly modelsTried: string[];
  readonly strategiesTried: string[];

  constructor(cause: unknown, context: ExtractionFailureContext) {
    super(formatExtractionFailureMessage(cause, context));
    this.name = "ExtractionFailedError";
    this.modelsTried = context.modelsTried;
    this.strategiesTried = context.strategiesTried;
  }
}

export function getExtractionModelIds(primaryModelId: string): string[] {
  const candidates = [
    primaryModelId,
    process.env.EXTRACTION_FALLBACK_MODEL,
    process.env.DISCOVERY_MODEL,
    "openai/gpt-4o-mini",
    "openai/gpt-4o",
  ].filter((modelId): modelId is string => Boolean(modelId));

  return [...new Set(candidates)];
}

function isProposalValidationMessage(message: string): boolean {
  return (
    message.includes("proposedTemplateKey") &&
    message.includes("category") &&
    message.includes("paired")
  );
}

function validationDetail(error: unknown): string {
  if (error instanceof SchemaDefinitionResponseError) {
    return ` ${error.message}`;
  }

  if (!NoObjectGeneratedError.isInstance(error)) {
    return "";
  }

  const cause = error.cause;
  if (cause instanceof Error && cause.message) {
    if (isProposalValidationMessage(cause.message)) {
      return (
        " The model returned a schema proposal shape during extraction. " +
        "This usually means discovery schema metadata leaked into the extraction step."
      );
    }
    if (looksLikeSchemaDefinitionResponse((error as { object?: unknown }).object)) {
      return " The model returned JSON Schema metadata instead of extracted values.";
    }
    return ` ${cause.message}`;
  }

  if (error.text) {
    const preview = error.text.length > 120 ? `${error.text.slice(0, 120)}…` : error.text;
    try {
      if (looksLikeSchemaDefinitionResponse(JSON.parse(error.text))) {
        return " The model returned JSON Schema metadata instead of extracted values.";
      }
    } catch {
      // ignore non-JSON preview text
    }
    return ` Model output preview: ${preview}`;
  }

  return "";
}

export function formatExtractionFailureMessage(
  error: unknown,
  context: ExtractionFailureContext,
): string {
  if (error instanceof SchemaDefinitionResponseError) {
    return error.message;
  }

  const models = context.modelsTried.join(", ") || "unknown";
  const strategies = context.strategiesTried.join(" → ") || "single-stage";
  const detail = validationDetail(error);

  if (detail.includes("schema proposal shape") || detail.includes("JSON Schema metadata")) {
    return `Extraction failed: model output did not match the extraction data schema.${detail}`;
  }

  return (
    `Extraction failed after trying models (${models}) using ${strategies}.${detail} ` +
    "Vision + structured output often fails on complex templates. " +
    "Try EXTRACTION_PIPELINE=two-stage, set EXTRACTION_MODEL=openai/gpt-4o-mini with " +
    "EXTRACTION_FALLBACK_MODEL=openai/gpt-4o, or reduce template field count."
  );
}

export function isExtractionFailure(
  error: unknown,
): error is ExtractionFailedError | NoObjectGeneratedError | SchemaDefinitionResponseError {
  return (
    error instanceof ExtractionFailedError ||
    error instanceof SchemaDefinitionResponseError ||
    NoObjectGeneratedError.isInstance(error)
  );
}

export function extractionFailureMessage(
  error: ExtractionFailedError | NoObjectGeneratedError | SchemaDefinitionResponseError,
): string {
  if (error instanceof SchemaDefinitionResponseError || error instanceof ExtractionFailedError) {
    return error.message;
  }

  return formatExtractionFailureMessage(error, {
    modelsTried: getExtractionModelIds(process.env.EXTRACTION_MODEL ?? "openai/gpt-4o"),
    strategiesTried: ["single-stage"],
  });
}

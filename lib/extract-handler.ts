import { getTemplate, listTemplates } from "./template-store";
import {
  classifyDocument,
  countUploadSides,
  extractStructured,
  isReadableData,
  proposeSchema,
  validatePairedUpload,
  type AiOverrides,
  type ExtractionInput,
} from "./extraction";
import { parseUploadFormData, UploadError } from "./upload";
import type { ApiErrorResponse, ExtractSuccessResponse, Template } from "./types";

export type ExtractHandlerResult =
  | { status: 200; body: ExtractSuccessResponse }
  | { status: 200; body: { flow: "discovery"; message: string; proposalId: string; proposal: unknown } }
  | { status: 400 | 404 | 422; body: ApiErrorResponse };

function toExtractionInput(files: Awaited<ReturnType<typeof parseUploadFormData>>): ExtractionInput {
  const input: ExtractionInput = {
    buffers: files.map((f) => f.buffer),
    mimeTypes: files.map((f) => f.mimeType),
    filenames: files.map((f) => f.filename),
  };
  if (files.some((f) => f.text !== undefined)) {
    input.texts = files.map((f) => f.text ?? "");
  }
  if (files.some((f) => f.pageCount !== undefined)) {
    input.pageCounts = files.map((f) => f.pageCount ?? 1);
  }
  return input;
}

function errorResponse(
  status: 400 | 404 | 422,
  error: string,
  message: string,
  extra?: Partial<ApiErrorResponse>,
): ExtractHandlerResult {
  return { status, body: { error, message, ...extra } };
}

async function runExtraction(
  template: Template,
  input: ExtractionInput,
  overrides?: AiOverrides,
): Promise<ExtractHandlerResult> {
  const sideCount = await countUploadSides(input);
  const pairedCheck = validatePairedUpload(template, sideCount);
  if (!pairedCheck.ok) {
    return errorResponse(422, pairedCheck.error ?? "incomplete", "Paired template requires all document sides");
  }

  const data = await extractStructured(template, input, overrides);
  if (!isReadableData(data)) {
    return errorResponse(422, "unreadable", "Required content is not readable");
  }

  return {
    status: 200,
    body: {
      flow: "extraction",
      templateKey: template.templateKey,
      schema: template,
      data,
    },
  };
}

export async function handleExtract(
  formData: FormData,
  overrides?: AiOverrides,
): Promise<ExtractHandlerResult> {
  let files;
  try {
    files = await parseUploadFormData(formData);
  } catch (err) {
    if (err instanceof UploadError) {
      return errorResponse(400, err.code, err.message);
    }
    throw err;
  }

  const input = toExtractionInput(files);
  const templateKey = formData.get("templateKey")?.toString().trim() || undefined;

  if (templateKey) {
    const template = await getTemplate(templateKey);
    if (!template) {
      return errorResponse(404, "template_not_found", `Template not found: ${templateKey}`);
    }

    const classification = await classifyDocument(input, templateKey, overrides);
    if (!classification.match) {
      return errorResponse(422, "type_mismatch", "Uploaded document does not match the specified template", {
        expectedTemplateKey: templateKey,
        detectedTemplateKey: classification.templateKey,
      });
    }

    return runExtraction(template, input, overrides);
  }

  const classification = await classifyDocument(input, undefined, overrides);
  const libraryTemplate = await getTemplate(classification.templateKey);

  if (libraryTemplate) {
    return runExtraction(libraryTemplate, input, overrides);
  }

  const templates = await listTemplates();
  if (templates.length === 0) {
    const proposal = await proposeSchema(input, overrides, "extract");
    return {
      status: 200,
      body: {
        flow: "discovery",
        message: "No library template found. Use POST /api/discover to review and approve a schema.",
        proposalId: proposal.proposalId,
        proposal,
      },
    };
  }

  const proposal = await proposeSchema(input, overrides, "extract");
  return {
    status: 200,
    body: {
      flow: "discovery",
      message: "No matching template in library. Schema proposal created for admin review.",
      proposalId: proposal.proposalId,
      proposal,
    },
  };
}

import { classifyDocument, type ExtractionInput } from "@/lib/extraction";

export async function validateMatch(templateKey: string, input: ExtractionInput) {
  const result = await classifyDocument(input, templateKey);
  return {
    match: result.match,
    detectedTemplateKey: result.templateKey,
    expectedTemplateKey: templateKey,
  };
}

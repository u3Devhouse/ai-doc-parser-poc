import { extractStructured, type ExtractionInput } from "@/lib/extraction";
import type { Template } from "@/lib/types";

export async function extractStructuredFromTemplate(template: Template, input: ExtractionInput) {
  return extractStructured(template, input);
}

import type { FieldType, Template } from "./types";

export type { FieldType, Template, TemplateField, FlowType } from "./types";
export { buildZodSchemaFromTemplate } from "./schema";
export { getTemplate, saveTemplate, listTemplates } from "./template-store";
export { extractStructured, classifyDocument, proposeSchema } from "./extraction";
export { parsePdfToText } from "./pdf";
export { isAdminAuthorized } from "./auth";

export function getTemplateStorePath(): string {
  return process.env.TEMPLATE_STORE_PATH ?? "data/templates";
}

export function validateTemplateShape(template: Template): void {
  if (!template.templateKey || !template.category) {
    throw new Error("Invalid template: missing templateKey or category");
  }
}

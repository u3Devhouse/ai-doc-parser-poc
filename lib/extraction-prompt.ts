import { listTemplateFieldNames } from "./schema";
import type { Template } from "./types";

const SPANISH_MONTHS =
  "ENE=01, FEB=02, MAR=03, ABR=04, MAY=05, JUN=06, JUL=07, AGO=08, SEP=09, OCT=10, NOV=11, DIC=12";

export const EXTRACTION_SYSTEM_MESSAGE =
  "You are EXTRACTING VALUES from a document. Output JSON with template field names as keys and " +
  "extracted values only (strings, numbers, booleans, ISO dates). NEVER output schema proposals, " +
  "JSON Schema, proposedTemplateKey, category, paired, or arrays of {name, type, description}.";

export function buildDiscoveryPrompt(): string {
  return (
    "Analyze this document and propose an extraction schema (field names, types, descriptions). " +
    "Return schema metadata only: proposedTemplateKey, category, paired, and field definitions. " +
    "Do not return extracted document values."
  );
}

function buildFieldNameList(template: Template): string {
  const names = listTemplateFieldNames(template);
  if (names.length === 0) {
    return "";
  }
  return `Extract values for these field keys only: ${names.join(", ")}. `;
}

export function buildExtractionPrompt(template: Template): string {
  const fieldList = buildFieldNameList(template);
  const base =
    "Extract document field VALUES from the attached images. " +
    fieldList +
    "Return a flat JSON object mapping each field name to its extracted value. " +
    "Return only populated data values (strings, numbers, booleans, ISO dates). " +
    "Do NOT return schema definitions, JSON Schema objects, proposedTemplateKey, category, paired, " +
    "or field metadata objects with name/type/description. " +
    "Copy values exactly as printed. Preserve Spanish text. " +
    `For date fields, output ISO YYYY-MM-DD. Guatemala DPI dates are often printed as DDMMMYYYY ` +
    `(day + 3-letter Spanish month + year, e.g. 15ENE1990 → 1990-01-15). Month map: ${SPANISH_MONTHS}.`;

  if (template.templateKey === "identity/GT/dpi") {
    return (
      `${base} Document: Guatemala DPI (Documento Personal de Identificación). ` +
      "The CUI is the 13-digit Código Único de Identificación on the front — copy every digit exactly. " +
      "Capture primer apellido, segundo apellido, and nombres separately as printed on the front; do not drop an apellido. " +
      "Page 1 / front: CUI, apellidos, nombres, fecha de nacimiento, nacionalidad, sexo, fecha de fotografía (when the photo was taken — not expiration). " +
      "Page 2 / back: lugar de nacimiento, domicilio, fecha de vencimiento. Do not extract blood type; it is not printed on this document."
    );
  }

  return base;
}

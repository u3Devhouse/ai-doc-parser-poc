import { z } from "zod";
import type { FieldType, Template, TemplateField } from "./types";

const fieldDefinitionSchema = z.object({
  name: z.string(),
  type: z.enum(["string", "date", "number", "boolean", "string[]", "text"]),
  required: z.boolean().default(false),
  description: z.string().optional(),
});

export const proposalObjectSchema = z.object({
  proposedTemplateKey: z.string(),
  category: z.enum(["identity", "contract", "legal"]),
  paired: z.boolean(),
  fields: z.array(fieldDefinitionSchema).optional(),
  sides: z
    .object({
      front: z.object({ fields: z.array(z.any()) }).optional(),
      back: z.object({ fields: z.array(z.any()) }).optional(),
    })
    .optional(),
});

export type ProposalObject = z.infer<typeof proposalObjectSchema>;

export function buildProposalZodSchema(): z.ZodObject<z.ZodRawShape> {
  return proposalObjectSchema;
}

export function isProposalZodShape(shape: Record<string, unknown> | undefined): boolean {
  if (!shape) {
    return false;
  }
  return "proposedTemplateKey" in shape && "category" in shape && "paired" in shape;
}

function isFieldDefinitionArray(value: unknown): value is TemplateField[] {
  if (!Array.isArray(value) || value.length === 0) {
    return false;
  }
  const first = value[0];
  return (
    typeof first === "object" &&
    first !== null &&
    "name" in first &&
    "type" in first &&
    !("properties" in first)
  );
}

function isFieldDefinitionSide(value: unknown): boolean {
  if (!value || typeof value !== "object" || !("fields" in value)) {
    return false;
  }
  return isFieldDefinitionArray((value as { fields?: unknown }).fields);
}

export function isJsonSchemaDefinition(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return record.type === "object" && typeof record.properties === "object" && record.properties !== null;
}

export function looksLikeSchemaDefinitionResponse(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const record = value as Record<string, unknown>;
  if (isJsonSchemaDefinition(record)) {
    return true;
  }

  if ("proposedTemplateKey" in record && ("fields" in record || "sides" in record)) {
    return true;
  }

  if (record.sides && typeof record.sides === "object") {
    for (const side of Object.values(record.sides as Record<string, unknown>)) {
      if (isFieldDefinitionSide(side)) {
        return true;
      }
    }
  }

  if (isFieldDefinitionArray(record.fields)) {
    return true;
  }

  return false;
}

function normalizeFieldList(fields: TemplateField[] | undefined): TemplateField[] | undefined {
  if (!fields?.length) {
    return fields;
  }
  return fields.map((field) => ({
    name: field.name,
    type: field.type,
    required: field.required ?? false,
    description: field.description,
  }));
}

export function normalizeTemplateForExtraction(template: Template): Template {
  if (template.paired) {
    return {
      templateKey: template.templateKey,
      category: template.category,
      version: template.version ?? 1,
      description: template.description,
      paired: true,
      sides: template.sides
        ? {
            front: template.sides.front
              ? { fields: normalizeFieldList(template.sides.front.fields) ?? [] }
              : undefined,
            back: template.sides.back
              ? { fields: normalizeFieldList(template.sides.back.fields) ?? [] }
              : undefined,
          }
        : undefined,
    };
  }

  return {
    templateKey: template.templateKey,
    category: template.category,
    version: template.version ?? 1,
    description: template.description,
    paired: false,
    fields: normalizeFieldList(template.fields) ?? [],
  };
}

export function assertExtractionZodSchema(schema: z.ZodObject<z.ZodRawShape>): void {
  if (isProposalZodShape(schema.shape as Record<string, unknown>)) {
    throw new Error("Proposal schema cannot be used for extraction");
  }
}

function fieldToZod(field: TemplateField): z.ZodTypeAny {
  let schema: z.ZodTypeAny;

  switch (field.type as FieldType) {
    case "string":
    case "text":
      schema = z.string();
      break;
    case "date":
      schema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
      break;
    case "number":
      schema = z.number();
      break;
    case "boolean":
      schema = z.boolean();
      break;
    case "string[]":
      schema = z.array(z.string());
      break;
    default:
      schema = z.string();
  }

  if (field.description) {
    schema = schema.describe(field.description);
  }

  if (!field.required) {
    schema = schema.optional();
  }

  return schema;
}

function fieldsToShape(fields: TemplateField[]): Record<string, z.ZodTypeAny> {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const field of fields) {
    shape[field.name] = fieldToZod(field);
  }
  return shape;
}

export function buildZodSchemaFromTemplate(template: Template): z.ZodObject<z.ZodRawShape> {
  const normalized = normalizeTemplateForExtraction(template);

  if (normalized.paired && normalized.sides) {
    const shape: Record<string, z.ZodTypeAny> = {};
    if (normalized.sides.front) {
      shape.front = z.object(fieldsToShape(normalized.sides.front.fields));
    }
    if (normalized.sides.back) {
      shape.back = z.object(fieldsToShape(normalized.sides.back.fields));
    }
    const schema = z.object({ sides: z.object(shape) });
    assertExtractionZodSchema(schema);
    return schema;
  }

  const schema = z.object(fieldsToShape(normalized.fields ?? []));
  assertExtractionZodSchema(schema);
  return schema;
}

const PROPOSAL_METADATA_KEYS = new Set([
  "proposedTemplateKey",
  "category",
  "paired",
  "type",
  "properties",
  "required",
  "$schema",
]);

export function countTemplateFields(template: Template): number {
  const normalized = normalizeTemplateForExtraction(template);
  if (normalized.paired && normalized.sides) {
    return (
      (normalized.sides.front?.fields?.length ?? 0) + (normalized.sides.back?.fields?.length ?? 0)
    );
  }
  return normalized.fields?.length ?? 0;
}

export function listTemplateFieldNames(template: Template): string[] {
  const normalized = normalizeTemplateForExtraction(template);
  if (normalized.paired && normalized.sides) {
    const names: string[] = [];
    for (const side of [normalized.sides.front, normalized.sides.back]) {
      for (const field of side?.fields ?? []) {
        names.push(field.name);
      }
    }
    return names;
  }
  return (normalized.fields ?? []).map((field) => field.name);
}

function relaxedFieldsToShape(fields: TemplateField[]): Record<string, z.ZodTypeAny> {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const field of fields) {
    shape[field.name] = z.unknown().optional();
  }
  return shape;
}

/** Loose schema for generateObject — avoids typed JSON Schema that models confuse with discovery proposals. */
export function buildRelaxedExtractionSchema(template: Template): z.ZodObject<z.ZodRawShape> {
  const normalized = normalizeTemplateForExtraction(template);

  if (normalized.paired && normalized.sides) {
    const shape: Record<string, z.ZodTypeAny> = {};
    if (normalized.sides.front) {
      shape.front = z.object(relaxedFieldsToShape(normalized.sides.front.fields));
    }
    if (normalized.sides.back) {
      shape.back = z.object(relaxedFieldsToShape(normalized.sides.back.fields));
    }
    const schema = z.object({ sides: z.object(shape) });
    assertExtractionZodSchema(schema);
    return schema;
  }

  const schema = z.object(relaxedFieldsToShape(normalized.fields ?? []));
  assertExtractionZodSchema(schema);
  return schema;
}

function coerceBoolean(value: unknown): boolean | undefined {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "yes", "si", "sí", "1"].includes(normalized)) {
      return true;
    }
    if (["false", "no", "0"].includes(normalized)) {
      return false;
    }
  }
  if (typeof value === "number") {
    return value !== 0;
  }
  return undefined;
}

function coerceNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return undefined;
}

function coerceDate(value: unknown): string | undefined {
  if (typeof value !== "string" || !value.trim()) {
    return undefined;
  }
  const trimmed = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return trimmed;
  }
  return undefined;
}

function coerceFieldValue(value: unknown, field: TemplateField): unknown {
  if (value === null || value === undefined || value === "") {
    return undefined;
  }

  switch (field.type) {
    case "number":
      return coerceNumber(value);
    case "boolean":
      return coerceBoolean(value);
    case "date":
      return coerceDate(value);
    case "string[]":
      if (Array.isArray(value)) {
        return value.map((item) => String(item));
      }
      return [String(value)];
    case "string":
    case "text":
      return String(value);
    default:
      return String(value);
  }
}

function coerceSideData(
  data: Record<string, unknown>,
  fields: TemplateField[],
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const field of fields) {
    const value = coerceFieldValue(data[field.name], field);
    if (value !== undefined) {
      result[field.name] = value;
    }
  }
  return result;
}

export function stripProposalMetadata(data: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (PROPOSAL_METADATA_KEYS.has(key)) {
      continue;
    }
    if (key === "fields" && isFieldDefinitionArray(value)) {
      continue;
    }
    if (key === "sides" && value && typeof value === "object" && !Array.isArray(value)) {
      const sides = value as Record<string, unknown>;
      const cleanedSides: Record<string, unknown> = {};
      for (const [sideName, sideValue] of Object.entries(sides)) {
        if (isFieldDefinitionSide(sideValue)) {
          continue;
        }
        if (sideValue && typeof sideValue === "object" && !Array.isArray(sideValue)) {
          cleanedSides[sideName] = stripProposalMetadata(sideValue as Record<string, unknown>);
        }
      }
      if (Object.keys(cleanedSides).length > 0) {
        result.sides = cleanedSides;
      }
      continue;
    }
    result[key] = value;
  }
  return result;
}

export function tryRepairSchemaDefinitionResponse(
  value: Record<string, unknown>,
  template: Template,
): Record<string, unknown> | null {
  if (!looksLikeSchemaDefinitionResponse(value)) {
    return null;
  }

  const stripped = stripProposalMetadata(value);
  if (Object.keys(stripped).length === 0) {
    return null;
  }

  if (looksLikeSchemaDefinitionResponse(stripped)) {
    return null;
  }

  return coerceExtractionData(stripped, template);
}

export function coerceExtractionData(
  data: Record<string, unknown>,
  template: Template,
): Record<string, unknown> {
  const normalized = normalizeTemplateForExtraction(template);

  if (normalized.paired && normalized.sides) {
    const sidesInput = data.sides as Record<string, Record<string, unknown>> | undefined;
    const sides: Record<string, Record<string, unknown>> = {};

    if (normalized.sides.front) {
      sides.front = coerceSideData(sidesInput?.front ?? {}, normalized.sides.front.fields);
    }
    if (normalized.sides.back) {
      sides.back = coerceSideData(sidesInput?.back ?? {}, normalized.sides.back.fields);
    }

    return { sides };
  }

  return coerceSideData(data, normalized.fields ?? []);
}

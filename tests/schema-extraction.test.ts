import { describe, expect, it, vi } from "vitest";
import { extractStructured } from "@/lib/extraction";
import { handleApprove } from "@/lib/discover-handler";
import {
  buildRelaxedExtractionSchema,
  coerceExtractionData,
  isProposalZodShape,
  tryRepairSchemaDefinitionResponse,
} from "@/lib/schema";
import type { Template } from "@/lib/types";

function makePngBuffer(): Buffer {
  return Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  );
}

const legalTemplate: Template = {
  templateKey: "legal/guatemala_staff_registration",
  category: "legal",
  version: 1,
  paired: false,
  fields: [
    { name: "NIT", type: "string", required: false },
    { name: "razon_social", type: "string", required: false },
    { name: "participacion_camara", type: "boolean", required: false },
  ],
};

describe("relaxed extraction schema", () => {
  it("builds data schema without proposal metadata keys", () => {
    const schema = buildRelaxedExtractionSchema(legalTemplate);
    expect(isProposalZodShape(schema.shape as Record<string, unknown>)).toBe(false);
    expect(schema.shape).toHaveProperty("NIT");
    expect(schema.shape).toHaveProperty("razon_social");
  });

  it("repairs mixed proposal metadata with embedded field values", () => {
    const repaired = tryRepairSchemaDefinitionResponse(
      {
        proposedTemplateKey: "legal/form",
        category: "legal",
        paired: false,
        fields: [{ name: "NIT", type: "string", required: false }],
        NIT: "1234567-8",
        razon_social: "Empresa Ejemplo, S.A.",
      },
      legalTemplate,
    );

    expect(repaired).toEqual({
      NIT: "1234567-8",
      razon_social: "Empresa Ejemplo, S.A.",
    });
  });

  it("coerces boolean and date values from loose model output", () => {
    const data = coerceExtractionData(
      {
        NIT: "1234567-8",
        participacion_camara: "si",
        fecha_constitucion: "not-a-date",
      },
      {
        ...legalTemplate,
        fields: [
          ...(legalTemplate.fields ?? []),
          { name: "fecha_constitucion", type: "date", required: false },
        ],
      },
    );

    expect(data).toMatchObject({
      NIT: "1234567-8",
      participacion_camara: true,
    });
    expect(data).not.toHaveProperty("fecha_constitucion");
  });
});

describe("legal template extraction pipeline", () => {
  it("uses two-stage pipeline for legal templates even when EXTRACTION_PIPELINE=single", async () => {
    process.env.EXTRACTION_PIPELINE = "single";

    const generateText = vi.fn().mockResolvedValue({ text: "NIT: 1234567-8\nRazón social: Empresa Ejemplo" });
    const generateObject = vi.fn().mockResolvedValue({
      object: { NIT: "1234567-8", razon_social: "Empresa Ejemplo, S.A." },
    });

    const data = await extractStructured(
      legalTemplate,
      {
        buffers: [makePngBuffer()],
        mimeTypes: ["image/png"],
        filenames: ["legal.png"],
      },
      { generateText, generateObject },
    );

    expect(generateText).toHaveBeenCalledTimes(1);
    expect(generateObject).toHaveBeenCalledTimes(1);
    expect(data).toEqual({
      NIT: "1234567-8",
      razon_social: "Empresa Ejemplo, S.A.",
    });
  });

  it("repairs proposal-shaped approve response when values are present", async () => {
    const formData = new FormData();
    formData.append("files", new File([makePngBuffer()], "legal.png", { type: "image/png" }));

    const { handleDiscover } = await import("@/lib/discover-handler");
    const discover = await handleDiscover(formData, {
      generateText: vi.fn(async () => ({ text: "Legal form." })),
      generateObject: vi.fn(async () => ({
        object: {
          proposedTemplateKey: "legal/form",
          category: "legal",
          paired: false,
          fields: [{ name: "NIT", type: "string", required: false }],
        },
      })),
    });

    if (discover.status !== 200) {
      throw new Error("discover failed");
    }

    const approve = await handleApprove(
      discover.body.proposalId,
      {
        template: {
          templateKey: "legal/form",
          category: "legal",
          version: 1,
          paired: false,
          fields: [{ name: "NIT", type: "string", required: false }],
        },
      },
      {
        generateText: vi.fn(async () => ({ text: "NIT: 999" })),
        generateObject: vi.fn(async () => ({
          object: {
            proposedTemplateKey: "legal/form",
            category: "legal",
            paired: false,
            fields: [{ name: "NIT", type: "string", required: false }],
            NIT: "999",
          },
        })),
      },
    );

    expect(approve.status).toBe(200);
    if (approve.status === 200) {
      expect(approve.body.data).toEqual({ NIT: "999" });
    }
  });
});

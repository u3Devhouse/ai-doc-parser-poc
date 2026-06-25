import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handleDiscover, handleApprove, handleListProposals } from "@/lib/discover-handler";
import { buildZodSchemaFromTemplate, isProposalZodShape } from "@/lib/schema";
import { createMockAiOverrides } from "@/lib/ai-mock";
import { isAdminAuthorized } from "@/lib/auth";

const TEST_DIR = path.join(process.cwd(), "data/templates-test-discover");
const PROPOSAL_TEST_DIR = path.join(process.cwd(), "data/proposals-test-discover");

function makePngBuffer(): Buffer {
  return Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  );
}

describe("discovery API handlers", () => {
  beforeEach(async () => {
    process.env.ADMIN_API_KEY = "test-admin-key";
    process.env.TEMPLATE_STORE_PATH = TEST_DIR;
    process.env.PROPOSAL_STORE_PATH = PROPOSAL_TEST_DIR;
    await fs.rm(TEST_DIR, { recursive: true, force: true });
    await fs.rm(PROPOSAL_TEST_DIR, { recursive: true, force: true });
    await fs.mkdir(TEST_DIR, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(TEST_DIR, { recursive: true, force: true });
    await fs.rm(PROPOSAL_TEST_DIR, { recursive: true, force: true });
  });

  it("rejects unauthenticated admin requests", () => {
    expect(isAdminAuthorized(null)).toBe(false);
    expect(isAdminAuthorized("Bearer wrong")).toBe(false);
    expect(isAdminAuthorized("Bearer test-admin-key")).toBe(true);
  });

  it("returns schema proposal from discover handler", async () => {
    const formData = new FormData();
    formData.append("files", new File([makePngBuffer()], "doc.png", { type: "image/png" }));

    const result = await handleDiscover(formData, {
      generateText: vi.fn(async () => ({ text: "Mock document summary." })),
      generateObject: vi.fn(async () => ({
        object: {
          proposedTemplateKey: "contract/nda",
          category: "contract",
          paired: false,
          fields: [{ name: "effectiveDate", type: "date", required: false }],
        },
      })),
    });

    expect(result.status).toBe(200);
    if (result.status === 200) {
      expect(result.body.proposedTemplateKey).toBe("contract/nda");
      expect(result.body.proposalId).toMatch(/^prop_/);
      expect(result.body.documentSummary).toBe("Mock document summary.");
    }
  });

  it("approve saves template to library when requested", async () => {
    const formData = new FormData();
    formData.append("files", new File([makePngBuffer()], "doc.png", { type: "image/png" }));

    const discover = await handleDiscover(formData, {
      generateText: vi.fn(async () => ({ text: "Mock document summary." })),
      generateObject: vi.fn(async () => ({
        object: {
          proposedTemplateKey: "contract/nda",
          category: "contract",
          paired: false,
          fields: [{ name: "effectiveDate", type: "date", required: false }],
        },
      })),
    });

    if (discover.status !== 200) {
      throw new Error("discover failed");
    }

    const approve = await handleApprove(
      discover.body.proposalId,
      {
        save: true,
        template: {
          templateKey: "contract/nda",
          category: "contract",
          version: 1,
          paired: false,
          fields: [{ name: "effectiveDate", type: "date", required: true }],
        },
      },
      {
        generateObject: vi.fn(async () => ({ object: { effectiveDate: "2024-06-01" } })),
      },
    );

    expect(approve.status).toBe(200);
    if (approve.status === 200) {
      expect(approve.body.saved).toBe(true);
      expect(approve.body.data).toEqual({ effectiveDate: "2024-06-01" });
    }

    const saved = await fs.readFile(path.join(TEST_DIR, "contract/nda.json"), "utf8");
    expect(JSON.parse(saved).templateKey).toBe("contract/nda");
  });

  it("approve does not fail for paired session state from discovery", async () => {
    const formData = new FormData();
    formData.append("files", new File([makePngBuffer()], "front.png", { type: "image/png" }));
    formData.append("files", new File([makePngBuffer()], "back.png", { type: "image/png" }));

    const discover = await handleDiscover(formData, {
      generateText: vi.fn(async () => ({ text: "Guatemala DPI front and back." })),
      generateObject: vi.fn(async () => ({
        object: {
          proposedTemplateKey: "identity/GT/dpi",
          category: "identity",
          paired: true,
          sides: {
            front: { fields: [{ name: "fullName", type: "string", required: false }] },
            back: { fields: [{ name: "expirationDate", type: "date", required: false }] },
          },
        },
      })),
    });

    if (discover.status !== 200) {
      throw new Error("discover failed");
    }

    const approve = await handleApprove(
      discover.body.proposalId,
      {
        save: false,
        template: {
          templateKey: "identity/GT/dpi",
          category: "identity",
          version: 1,
          paired: true,
          fields: [],
          sides: {
            front: { fields: [{ name: "fullName", type: "string", required: true }] },
            back: { fields: [{ name: "expirationDate", type: "date", required: true }] },
          },
        },
      },
      {
        generateObject: vi.fn(async () => ({
          object: {
            sides: {
              front: { fullName: "Juan Perez" },
              back: { expirationDate: "2030-01-15" },
            },
          },
        })),
      },
    );

    expect(approve.status).toBe(200);
    if (approve.status === 200) {
      expect(approve.body.data).toEqual({
        sides: {
          front: { fullName: "Juan Perez" },
          back: { expirationDate: "2030-01-15" },
        },
      });
    }
  });

  it("approve returns 422 for invalid paired schema instead of throwing", async () => {
    const formData = new FormData();
    formData.append("files", new File([makePngBuffer()], "doc.png", { type: "image/png" }));

    const discover = await handleDiscover(formData, {
      generateText: vi.fn(async () => ({ text: "Mock document summary." })),
      generateObject: vi.fn(async () => ({
        object: {
          proposedTemplateKey: "identity/GT/dpi",
          category: "identity",
          paired: true,
          sides: {
            front: { fields: [{ name: "fullName", type: "string", required: false }] },
            back: { fields: [{ name: "expirationDate", type: "date", required: false }] },
          },
        },
      })),
    });

    if (discover.status !== 200) {
      throw new Error("discover failed");
    }

    const approve = await handleApprove(discover.body.proposalId, {
      template: {
        templateKey: "identity/GT/dpi",
        category: "identity",
        version: 1,
        paired: true,
        fields: [],
        sides: { front: { fields: [] }, back: { fields: [] } },
      },
    });

    expect(approve.status).toBe(422);
    if (approve.status === 422) {
      expect(approve.body.error).toBe("invalid_schema");
    }
  });

  it("approve with legal template returns extracted values not schema definitions", async () => {
    const legalFields = [
      { name: "NIT", type: "string" as const, required: false },
      { name: "razon_social", type: "string" as const, required: false },
      { name: "fecha_constitucion", type: "date" as const, required: false },
      { name: "participacion_camara", type: "boolean" as const, required: false },
      { name: "departamento", type: "string" as const, required: false },
      { name: "municipio", type: "string" as const, required: false },
      { name: "correo_electronico_principal", type: "string" as const, required: false },
      { name: "actividad_economica_principal", type: "string" as const, required: false },
    ];

    const formData = new FormData();
    formData.append("files", new File([makePngBuffer()], "legal.png", { type: "image/png" }));

    const discover = await handleDiscover(formData, {
      generateText: vi.fn(async () => ({ text: "Guatemala legal registration form." })),
      generateObject: vi.fn(async () => ({
        object: {
          proposedTemplateKey: "legal/guatemala_staff_registration",
          category: "legal",
          paired: false,
          fields: legalFields,
        },
      })),
    });

    if (discover.status !== 200) {
      throw new Error("discover failed");
    }

    const template = {
      templateKey: "legal/guatemala_staff_registration",
      category: "legal" as const,
      version: 1,
      paired: false,
      fields: legalFields,
    };
    const extractionSchema = buildZodSchemaFromTemplate(template);
    expect(isProposalZodShape(extractionSchema.shape as Record<string, unknown>)).toBe(false);

    const extractedValues = {
      NIT: "1234567-8",
      razon_social: "Empresa Ejemplo, S.A.",
      fecha_constitucion: "2010-05-20",
      participacion_camara: true,
      departamento: "Guatemala",
      municipio: "Guatemala",
      correo_electronico_principal: "contacto@ejemplo.com",
      actividad_economica_principal: "Servicios",
    };

    const approve = await handleApprove(
      discover.body.proposalId,
      { save: false, template },
      {
        generateText: vi.fn(async () => ({ text: "NIT: 1234567-8" })),
        generateObject: vi.fn(async ({ schema }) => {
          expect(isProposalZodShape(schema.shape as Record<string, unknown>)).toBe(false);
          return { object: extractedValues };
        }),
      },
    );

    expect(approve.status).toBe(200);
    if (approve.status === 200) {
      expect(approve.body.data).toEqual(extractedValues);
    }
  });

  it("approve with mock AI returns data values for legal templates with many fields", async () => {
    const legalFields = Array.from({ length: 12 }, (_, index) => ({
      name: `field_${index + 1}`,
      type: "string" as const,
      required: false,
    }));

    const formData = new FormData();
    formData.append("files", new File([makePngBuffer()], "legal.png", { type: "image/png" }));

    const discover = await handleDiscover(formData, {
      generateText: vi.fn(async () => ({ text: "Legal form with many fields." })),
      generateObject: vi.fn(async () => ({
        object: {
          proposedTemplateKey: "legal/many_fields",
          category: "legal",
          paired: false,
          fields: legalFields,
        },
      })),
    });

    if (discover.status !== 200) {
      throw new Error("discover failed");
    }

    const approve = await handleApprove(
      discover.body.proposalId,
      {
        save: false,
        template: {
          templateKey: "legal/many_fields",
          category: "legal",
          version: 1,
          paired: false,
          fields: legalFields,
        },
      },
      createMockAiOverrides(),
    );

    expect(approve.status).toBe(200);
    if (approve.status === 200) {
      expect(approve.body.data).toMatchObject({
        field_1: "mock-field_1",
        field_12: "mock-field_12",
      });
      expect(approve.body.data).not.toHaveProperty("proposedTemplateKey");
      expect(approve.body.data).not.toHaveProperty("type");
    }
  });

  it("approve returns schema_mismatch when model returns schema definitions", async () => {
    const formData = new FormData();
    formData.append("files", new File([makePngBuffer()], "legal.png", { type: "image/png" }));

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
        generateText: vi.fn(async () => ({ text: "NIT field only" })),
        generateObject: vi.fn(async () => ({
          object: {
            type: "object",
            properties: { category: "legal" },
            proposedTemplateKey: "extraction_schema_v1",
          },
        })),
      },
    );

    expect(approve.status).toBe(422);
    if (approve.status === 422) {
      expect(approve.body.error).toBe("schema_mismatch");
      expect(approve.body.message).toContain("schema definition");
    }
  });

  it("lists persisted proposals for admin review", async () => {
    const formData = new FormData();
    formData.append("files", new File([makePngBuffer()], "doc.png", { type: "image/png" }));

    const discover = await handleDiscover(formData, {
      generateText: vi.fn(async () => ({ text: "Mock document summary." })),
      generateObject: vi.fn(async () => ({
        object: {
          proposedTemplateKey: "contract/nda",
          category: "contract",
          paired: false,
          fields: [{ name: "effectiveDate", type: "date", required: false }],
        },
      })),
    });

    if (discover.status !== 200) {
      throw new Error("discover failed");
    }

    const listed = await handleListProposals();
    expect(listed.status).toBe(200);
    if (listed.status === 200) {
      expect(listed.body.proposals).toHaveLength(1);
      expect(listed.body.proposals[0]?.proposalId).toBe(discover.body.proposalId);
      expect(listed.body.proposals[0]?.source).toBe("admin");
    }
  });
});

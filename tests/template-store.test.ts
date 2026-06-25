import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildZodSchemaFromTemplate } from "@/lib/schema";
import { getTemplate, listTemplates, saveTemplate } from "@/lib/template-store";
import type { Template } from "@/lib/types";

const TEST_DIR = path.join(process.cwd(), "data/templates-test-store");

const contractTemplate: Template = {
  templateKey: "contract/nda",
  category: "contract",
  version: 1,
  paired: false,
  fields: [
    { name: "effectiveDate", type: "date", required: false, description: "ISO 8601" },
    { name: "disclosingParty", type: "string", required: false },
  ],
};

const pairedTemplate: Template = {
  templateKey: "identity/CO/national_id",
  category: "identity",
  version: 1,
  paired: true,
  sides: {
    front: { fields: [{ name: "fullName", type: "string", required: false }] },
    back: { fields: [{ name: "address", type: "text", required: false }] },
  },
};

describe("template store", () => {
  beforeEach(async () => {
    process.env.TEMPLATE_STORE_PATH = TEST_DIR;
    await fs.rm(TEST_DIR, { recursive: true, force: true });
    await fs.mkdir(TEST_DIR, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(TEST_DIR, { recursive: true, force: true });
  });

  it("saves and loads nested template keys", async () => {
    await saveTemplate(contractTemplate);
    const loaded = await getTemplate("contract/nda");
    expect(loaded?.templateKey).toBe("contract/nda");
  });

  it("lists templates excluding example file name pattern", async () => {
    await saveTemplate(contractTemplate);
    await fs.writeFile(path.join(TEST_DIR, "_example.template.json"), "{}");
    const templates = await listTemplates();
    expect(templates).toHaveLength(1);
    expect(templates[0]?.templateKey).toBe("contract/nda");
  });

  it("loads the shipped Guatemala DPI PoC template", async () => {
    const source = path.join(process.cwd(), "data/templates/identity/GT/dpi.json");
    const targetDir = path.join(TEST_DIR, "identity/GT");
    await fs.mkdir(targetDir, { recursive: true });
    await fs.copyFile(source, path.join(targetDir, "dpi.json"));

    const loaded = await getTemplate("identity/GT/dpi");
    expect(loaded).toMatchObject({
      templateKey: "identity/GT/dpi",
      category: "identity",
      paired: true,
    });
    expect(loaded?.sides?.front?.fields?.some((field) => field.name === "cui")).toBe(true);
    expect(loaded?.sides?.front?.fields?.some((field) => field.name === "primer_apellido")).toBe(true);
    expect(loaded?.sides?.back?.fields?.some((field) => field.name === "domicilio")).toBe(true);
    expect(loaded?.sides?.front?.fields?.some((field) => field.name === "fecha_fotografia")).toBe(true);
    expect(loaded?.sides?.back?.fields?.some((field) => field.name === "fecha_vencimiento")).toBe(true);
    expect(loaded?.sides?.back?.fields?.some((field) => field.name === "tipo_sangre")).toBe(false);
  });
});

describe("dynamic zod schema", () => {
  it("builds schema with describe from field descriptions", () => {
    const schema = buildZodSchemaFromTemplate(contractTemplate);
    const shape = schema.shape;
    expect(shape.effectiveDate).toBeDefined();
    expect(shape.disclosingParty).toBeDefined();
  });

  it("parses paired identity templates", () => {
    const schema = buildZodSchemaFromTemplate(pairedTemplate);
    const parsed = schema.safeParse({ sides: { front: { fullName: "Test" }, back: { address: "Street" } } });
    expect(parsed.success).toBe(true);
  });

  it("builds schema for Guatemala DPI paired template", async () => {
    const raw = await fs.readFile(path.join(process.cwd(), "data/templates/identity/GT/dpi.json"), "utf8");
    const dpi = JSON.parse(raw) as Template;
    const schema = buildZodSchemaFromTemplate(dpi);
    const parsed = schema.safeParse({
      sides: {
        front: {
          cui: "1234567890101",
          primer_apellido: "Fernandez",
          segundo_apellido: "Lopez",
          nombres: "Jose Miguel",
          fecha_nacimiento: "1990-01-15",
          nacionalidad: "GUATEMALTECO",
          sexo: "M",
          fecha_fotografia: "2020-01-15",
        },
        back: {
          lugar_nacimiento: "Guatemala, Guatemala",
          domicilio: "Zona 10, Ciudad de Guatemala",
          fecha_vencimiento: "2030-01-15",
        },
      },
    });
    expect(parsed.success).toBe(true);
  });
});

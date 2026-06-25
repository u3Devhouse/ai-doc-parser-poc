import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handleExtract } from "@/lib/extract-handler";
import type { Template } from "@/lib/types";

const TEST_STORE = path.join(process.cwd(), "data/templates-test-extract");

const contractTemplate: Template = {
  templateKey: "contract/nda",
  category: "contract",
  version: 1,
  paired: false,
  fields: [{ name: "effectiveDate", type: "date", required: false }],
};

function makePngBuffer(): Buffer {
  return Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  );
}

function mockAi(extractData: Record<string, unknown>, classifyKey = "contract/nda") {
  return {
    generateObject: vi.fn(async ({ schema }) => {
      const shapeKeys = Object.keys(schema.shape ?? {});
      if (shapeKeys.includes("templateKey")) {
        return { object: { templateKey: classifyKey, category: "contract" } };
      }
      return { object: extractData };
    }),
  };
}

describe("POST /api/extract handler", () => {
  beforeEach(async () => {
    process.env.TEMPLATE_STORE_PATH = TEST_STORE;
    await fs.rm(TEST_STORE, { recursive: true, force: true });
    await fs.mkdir(TEST_STORE, { recursive: true });
    await fs.mkdir(path.join(TEST_STORE, "contract"), { recursive: true });
    await fs.writeFile(
      path.join(TEST_STORE, "contract/nda.json"),
      JSON.stringify(contractTemplate),
    );
  });

  afterEach(async () => {
    await fs.rm(TEST_STORE, { recursive: true, force: true });
  });

  it("returns schema and data for image upload", async () => {
    const formData = new FormData();
    formData.append("files", new File([makePngBuffer()], "doc.png", { type: "image/png" }));
    formData.set("templateKey", "contract/nda");

    const result = await handleExtract(formData, mockAi({ effectiveDate: "2024-01-15" }));

    expect(result.status).toBe(200);
    if (result.status === 200 && "data" in result.body) {
      expect(result.body.flow).toBe("extraction");
      expect(result.body.data).toEqual({ effectiveDate: "2024-01-15" });
      expect(result.body.schema.templateKey).toBe("contract/nda");
    }
  });

  it("returns 422 unreadable when extraction is empty", async () => {
    const formData = new FormData();
    formData.append("files", new File([makePngBuffer()], "doc.png", { type: "image/png" }));
    formData.set("templateKey", "contract/nda");

    const result = await handleExtract(formData, mockAi({}));

    expect(result.status).toBe(422);
    if (result.status === 422) {
      expect(result.body.error).toBe("unreadable");
    }
  });
});

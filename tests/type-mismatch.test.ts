import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handleExtract } from "@/lib/extract-handler";
import type { Template } from "@/lib/types";

const TEST_DIR = path.join(process.cwd(), "data/templates-test-mismatch");

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

describe("templateKey and type mismatch", () => {
  beforeEach(async () => {
    process.env.TEMPLATE_STORE_PATH = TEST_DIR;
    await fs.rm(TEST_DIR, { recursive: true, force: true });
    await fs.mkdir(path.join(TEST_DIR, "contract"), { recursive: true });
    await fs.writeFile(path.join(TEST_DIR, "contract/nda.json"), JSON.stringify(contractTemplate));
  });

  afterEach(async () => {
    await fs.rm(TEST_DIR, { recursive: true, force: true });
  });

  it("returns 404 when specified template is missing", async () => {
    const formData = new FormData();
    formData.append("files", new File([makePngBuffer()], "doc.png", { type: "image/png" }));
    formData.set("templateKey", "contract/missing");

    const result = await handleExtract(formData);
    expect(result.status).toBe(404);
    if (result.status === 404) {
      expect(result.body.error).toBe("template_not_found");
    }
  });

  it("returns 422 type_mismatch when classification differs", async () => {
    const formData = new FormData();
    formData.append("files", new File([makePngBuffer()], "doc.png", { type: "image/png" }));
    formData.set("templateKey", "contract/nda");

    const result = await handleExtract(formData, {
      generateObject: vi.fn(async ({ schema }) => {
        if ("templateKey" in (schema.shape ?? {})) {
          return { object: { templateKey: "identity/CO/national_id", category: "identity" } };
        }
        return { object: { effectiveDate: "2024-01-01" } };
      }),
    });

    expect(result.status).toBe(422);
    if (result.status === 422) {
      expect(result.body.error).toBe("type_mismatch");
      expect(result.body.expectedTemplateKey).toBe("contract/nda");
      expect(result.body.detectedTemplateKey).toBe("identity/CO/national_id");
    }
  });
});

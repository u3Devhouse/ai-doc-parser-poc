import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handleExtract } from "@/lib/extract-handler";
import { assertNoEphemeralFilesWritten } from "./helpers";
import type { Template } from "@/lib/types";

const TEST_DIR = path.join(process.cwd(), "data/templates-test-integration");
const PROJECT_ROOT = process.cwd();

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

const mockAi = {
  generateObject: vi.fn(async ({ schema }) => {
    if ("templateKey" in (schema.shape ?? {})) {
      return { object: { templateKey: "contract/nda", category: "contract" } };
    }
    return { object: { effectiveDate: "2024-01-15" } };
  }),
  generateText: vi.fn(async () => ({ text: "Vision extracted contract text" })),
};

describe("API integration (mocked AI)", () => {
  beforeEach(async () => {
    process.env.TEMPLATE_STORE_PATH = TEST_DIR;
    process.env.EXTRACTION_PIPELINE = "single";
    process.env.ADMIN_API_KEY = "test-admin-key";
    await fs.rm(TEST_DIR, { recursive: true, force: true });
    await fs.mkdir(path.join(TEST_DIR, "contract"), { recursive: true });
    await fs.writeFile(path.join(TEST_DIR, "contract/nda.json"), JSON.stringify(contractTemplate));
    vi.clearAllMocks();
  });

  afterEach(async () => {
    await fs.rm(TEST_DIR, { recursive: true, force: true });
    await assertNoEphemeralFilesWritten(PROJECT_ROOT);
  });

  it("extract success returns schema and data without writing uploads", async () => {
    const formData = new FormData();
    formData.append("files", new File([makePngBuffer()], "doc.png", { type: "image/png" }));
    formData.set("templateKey", "contract/nda");

    const result = await handleExtract(formData, mockAi);
    expect(result.status).toBe(200);
    if (result.status === 200 && "schema" in result.body) {
      expect(result.body.schema).toBeDefined();
      expect(result.body.data).toEqual({ effectiveDate: "2024-01-15" });
    }
  });

  it("routes to discovery when library is empty and no templateKey", async () => {
    await fs.rm(TEST_DIR, { recursive: true, force: true });
    await fs.mkdir(TEST_DIR, { recursive: true });

    const formData = new FormData();
    formData.append("files", new File([makePngBuffer()], "doc.png", { type: "image/png" }));

    const result = await handleExtract(formData, {
      generateObject: vi.fn(async ({ schema }) => {
        if ("templateKey" in (schema.shape ?? {})) {
          return { object: { templateKey: "contract/new", category: "contract" } };
        }
        if ("proposedTemplateKey" in (schema.shape ?? {})) {
          return {
            object: {
              proposedTemplateKey: "contract/new",
              category: "contract",
              paired: false,
              fields: [],
            },
          };
        }
        return { object: {} };
      }),
    });

    expect(result.status).toBe(200);
    if (result.status === 200) {
      expect(result.body.flow).toBe("discovery");
    }
  });

  it("two-stage pipeline uses vision then structure pass", async () => {
    process.env.EXTRACTION_PIPELINE = "two-stage";

    const formData = new FormData();
    formData.append("files", new File([makePngBuffer()], "doc.png", { type: "image/png" }));
    formData.set("templateKey", "contract/nda");

    const result = await handleExtract(formData, mockAi);
    expect(result.status).toBe(200);
    expect(mockAi.generateText).toHaveBeenCalled();
  });
});

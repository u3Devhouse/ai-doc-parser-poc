import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { countUploadSides, validatePairedUpload } from "@/lib/extraction";
import { handleExtract } from "@/lib/extract-handler";
import type { Template } from "@/lib/types";

const TEST_DIR = path.join(process.cwd(), "data/templates-test-paired");

const pairedTemplate: Template = {
  templateKey: "identity/CO/national_id",
  category: "identity",
  version: 1,
  paired: true,
  sides: {
    front: { fields: [{ name: "fullName", type: "string", required: true }] },
    back: { fields: [{ name: "address", type: "text", required: true }] },
  },
};

function makePngBuffer(): Buffer {
  return Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  );
}

describe("paired identity validation", () => {
  beforeEach(async () => {
    process.env.TEMPLATE_STORE_PATH = TEST_DIR;
    await fs.rm(TEST_DIR, { recursive: true, force: true });
    await fs.mkdir(path.join(TEST_DIR, "identity/CO"), { recursive: true });
    await fs.writeFile(
      path.join(TEST_DIR, "identity/CO/national_id.json"),
      JSON.stringify(pairedTemplate),
    );
  });

  afterEach(async () => {
    await fs.rm(TEST_DIR, { recursive: true, force: true });
  });

  it("returns 422 incomplete when only one image side uploaded", async () => {
    const formData = new FormData();
    formData.append("files", new File([makePngBuffer()], "front.png", { type: "image/png" }));
    formData.set("templateKey", "identity/CO/national_id");

    const result = await handleExtract(formData, {
      generateObject: vi.fn(async ({ schema }) => {
        if ("templateKey" in (schema.shape ?? {})) {
          return { object: { templateKey: "identity/CO/national_id", category: "identity" } };
        }
        return { object: { sides: { front: { fullName: "Ana" } } } };
      }),
    });

    expect(result.status).toBe(422);
    if (result.status === 422) {
      expect(result.body.error).toBe("incomplete");
    }
  });

  it("counts PDF pages as document sides for paired templates", async () => {
    const sideCount = await countUploadSides({
      buffers: [Buffer.from("pdf")],
      mimeTypes: ["application/pdf"],
      filenames: ["dpi.pdf"],
      pageCounts: [2],
    });

    expect(validatePairedUpload(pairedTemplate, sideCount).ok).toBe(true);
  });

  it("returns incomplete for a single-page PDF on paired templates", async () => {
    const sideCount = await countUploadSides({
      buffers: [Buffer.from("pdf")],
      mimeTypes: ["application/pdf"],
      filenames: ["dpi.pdf"],
      pageCounts: [1],
    });

    expect(validatePairedUpload(pairedTemplate, sideCount).ok).toBe(false);
  });

  it("extracts grouped sides when front and back provided", async () => {
    const formData = new FormData();
    formData.append("files", new File([makePngBuffer()], "front.png", { type: "image/png" }));
    formData.append("files", new File([makePngBuffer()], "back.png", { type: "image/png" }));
    formData.set("templateKey", "identity/CO/national_id");

    const result = await handleExtract(formData, {
      generateObject: vi.fn(async ({ schema }) => {
        if ("templateKey" in (schema.shape ?? {})) {
          return { object: { templateKey: "identity/CO/national_id", category: "identity" } };
        }
        return {
          object: {
            sides: {
              front: { fullName: "Ana García" },
              back: { address: "Calle 1" },
            },
          },
        };
      }),
    });

    expect(result.status).toBe(200);
    if (result.status === 200 && "data" in result.body) {
      expect(result.body.data).toEqual({
        sides: {
          front: { fullName: "Ana García" },
          back: { address: "Calle 1" },
        },
      });
    }
  });
});

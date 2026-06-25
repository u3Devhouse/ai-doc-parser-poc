import { describe, expect, it } from "vitest";
import { classifyDocument } from "@/lib/extraction";
import type { Template } from "@/lib/types";

// Test classification match logic via classifyDocument with mocked AI
describe("classification match for specified template", () => {
  const identityTemplate: Template = {
    templateKey: "identity/GT/dpi",
    category: "identity",
    version: 1,
    paired: true,
    sides: {
      front: { fields: [{ name: "cui", type: "string", required: false }] },
      back: { fields: [{ name: "domicilio", type: "text", required: false }] },
    },
  };

  it("accepts invented identity keys when category matches specified DPI template", async () => {
    process.env.TEMPLATE_STORE_PATH = "data/templates";

    const result = await classifyDocument(
      {
        buffers: [Buffer.from("fake")],
        mimeTypes: ["image/png"],
        filenames: ["dpi.png"],
      },
      "identity/GT/dpi",
      {
        generateObject: async () => ({
          object: { templateKey: "identity_document", category: "identity" },
        }),
      },
    );

    expect(result.match).toBe(true);
    expect(result.category).toBe("identity");
  });

  it("rejects wrong category even when model invents a key", async () => {
    process.env.TEMPLATE_STORE_PATH = "data/templates";

    const result = await classifyDocument(
      {
        buffers: [Buffer.from("fake")],
        mimeTypes: ["image/png"],
        filenames: ["doc.png"],
      },
      "identity/GT/dpi",
      {
        generateObject: async () => ({
          object: { templateKey: "general-legal-document", category: "legal" },
        }),
      },
    );

    expect(result.match).toBe(false);
  });
});

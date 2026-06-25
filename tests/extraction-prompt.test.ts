import { describe, expect, it } from "vitest";
import { buildExtractionPrompt } from "@/lib/extraction-prompt";
import type { Template } from "@/lib/types";

describe("buildExtractionPrompt", () => {
  it("includes Guatemala DPI date and CUI guidance", () => {
    const template: Template = {
      templateKey: "identity/GT/dpi",
      category: "identity",
      version: 1,
      paired: true,
      sides: {
        front: { fields: [{ name: "cui", type: "string", required: false }] },
        back: { fields: [{ name: "domicilio", type: "text", required: false }] },
      },
    };

    const prompt = buildExtractionPrompt(template);
    expect(prompt).toContain("DDMMMYYYY");
    expect(prompt).toContain("13-digit");
    expect(prompt).toContain("fecha de fotografía");
    expect(prompt).toContain("fecha de vencimiento");
    expect(prompt).toContain("Do not extract blood type");
  });
});

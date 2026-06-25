import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { handleExtract } from "@/lib/extract-handler";
import type { Template } from "@/lib/types";

const TEST_DIR = path.join(process.cwd(), "data/templates-test-two-stage");

const contractTemplate: Template = {
  templateKey: "contract/nda",
  category: "contract",
  version: 1,
  paired: false,
  fields: [{ name: "disclosingParty", type: "string", required: false }],
};

describe("two-stage extraction pipeline", () => {
  it("calls generateText then generateObject when EXTRACTION_PIPELINE=two-stage", async () => {
    process.env.TEMPLATE_STORE_PATH = TEST_DIR;
    process.env.EXTRACTION_PIPELINE = "two-stage";

    await fs.mkdir(path.join(TEST_DIR, "contract"), { recursive: true });
    await fs.writeFile(path.join(TEST_DIR, "contract/nda.json"), JSON.stringify(contractTemplate));

    const mockGenerateText = vi.fn().mockResolvedValue({ text: "Disclosing party: Acme Corp" });
    const mockGenerateObject = vi
      .fn()
      .mockResolvedValueOnce({ object: { templateKey: "contract/nda", category: "contract" } })
      .mockResolvedValueOnce({ object: { disclosingParty: "Acme Corp" } });

    const form = new FormData();
    form.set("templateKey", "contract/nda");
    form.append("files", new File([Buffer.from("fake")], "nda.png", { type: "image/png" }));

    const result = await handleExtract(form, {
      generateObject: mockGenerateObject,
      generateText: mockGenerateText,
    });

    expect(result.status).toBe(200);
    expect(mockGenerateText).toHaveBeenCalledTimes(1);
    expect(mockGenerateObject).toHaveBeenCalledTimes(2);

    process.env.EXTRACTION_PIPELINE = "single";
    await fs.rm(TEST_DIR, { recursive: true, force: true });
  });
});

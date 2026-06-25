import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handleExtract } from "@/lib/extract-handler";
import { handleDiscover, handleApprove } from "@/lib/discover-handler";
import { getProposal } from "@/lib/extraction";
import type { Template } from "@/lib/types";

const TEST_DIR = path.join(process.cwd(), "data/templates-test-api");
const PROPOSAL_TEST_DIR = path.join(process.cwd(), "data/proposals-test-api");

const contractTemplate: Template = {
  templateKey: "contract/nda",
  category: "contract",
  version: 1,
  paired: false,
  fields: [{ name: "disclosingParty", type: "string", required: false }],
};

const identityTemplate: Template = {
  templateKey: "identity/CO/national_id",
  category: "identity",
  version: 1,
  paired: true,
  sides: {
    front: { fields: [{ name: "fullName", type: "string", required: false }] },
    back: { fields: [{ name: "address", type: "text", required: false }] },
  },
};

const mockGenerateObject = vi.fn();
const mockGenerateText = vi.fn();
const ai = { generateObject: mockGenerateObject, generateText: mockGenerateText };

function formWithFiles(files: { name: string; type: string; content: Buffer }[], templateKey?: string) {
  const form = new FormData();
  for (const file of files) {
    form.append("files", new File([file.content], file.name, { type: file.type }));
  }
  if (templateKey) {
    form.set("templateKey", templateKey);
  }
  return form;
}

describe("extract handler", () => {
  beforeEach(async () => {
    process.env.TEMPLATE_STORE_PATH = TEST_DIR;
    process.env.PROPOSAL_STORE_PATH = PROPOSAL_TEST_DIR;
    process.env.ADMIN_API_KEY = "test-admin";
    await fs.mkdir(path.join(TEST_DIR, "contract"), { recursive: true });
    await fs.writeFile(path.join(TEST_DIR, "contract/nda.json"), JSON.stringify(contractTemplate));
    await fs.rm(PROPOSAL_TEST_DIR, { recursive: true, force: true });
    mockGenerateObject.mockReset();
    mockGenerateText.mockReset();
  });

  afterEach(async () => {
    await fs.rm(TEST_DIR, { recursive: true, force: true });
    await fs.rm(PROPOSAL_TEST_DIR, { recursive: true, force: true });
  });

  it("returns extracted JSON for known template with templateKey", async () => {
    mockGenerateObject
      .mockResolvedValueOnce({ object: { templateKey: "contract/nda", category: "contract" } })
      .mockResolvedValueOnce({ object: { disclosingParty: "Acme Corp" } });

    const result = await handleExtract(
      formWithFiles([{ name: "doc.png", type: "image/png", content: Buffer.from("fake") }], "contract/nda"),
      ai,
    );

    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({
      flow: "extraction",
      templateKey: "contract/nda",
      data: { disclosingParty: "Acme Corp" },
    });
  });

  it("returns 422 type_mismatch when document does not match templateKey", async () => {
    mockGenerateObject.mockResolvedValueOnce({
      object: { templateKey: "identity/CO/national_id", category: "identity" },
    });

    const result = await handleExtract(
      formWithFiles([{ name: "id.png", type: "image/png", content: Buffer.from("fake") }], "contract/nda"),
      ai,
    );

    expect(result.status).toBe(422);
    expect(result.body).toMatchObject({
      error: "type_mismatch",
      expectedTemplateKey: "contract/nda",
      detectedTemplateKey: "identity/CO/national_id",
    });
  });

  it("returns 404 when templateKey not in library", async () => {
    const result = await handleExtract(
      formWithFiles([{ name: "doc.png", type: "image/png", content: Buffer.from("fake") }], "contract/missing"),
      ai,
    );

    expect(result.status).toBe(404);
    expect(result.body).toMatchObject({ error: "template_not_found" });
  });

  it("returns 422 incomplete for paired identity with one file", async () => {
    await fs.mkdir(path.join(TEST_DIR, "identity/CO"), { recursive: true });
    await fs.writeFile(path.join(TEST_DIR, "identity/CO/national_id.json"), JSON.stringify(identityTemplate));

    mockGenerateObject.mockResolvedValueOnce({
      object: { templateKey: "identity/CO/national_id", category: "identity" },
    });

    const result = await handleExtract(
      formWithFiles([{ name: "front.png", type: "image/png", content: Buffer.from("fake") }], "identity/CO/national_id"),
      ai,
    );

    expect(result.status).toBe(422);
    expect(result.body).toMatchObject({ error: "incomplete" });
  });

  it("routes to discovery when library is empty and no templateKey", async () => {
    await fs.rm(TEST_DIR, { recursive: true, force: true });
    await fs.mkdir(TEST_DIR, { recursive: true });

    mockGenerateObject
      .mockResolvedValueOnce({ object: { templateKey: "contract/nda", category: "contract" } })
      .mockResolvedValueOnce({
        object: {
          proposedTemplateKey: "contract/nda",
          category: "contract",
          paired: false,
          fields: [{ name: "disclosingParty", type: "string", required: false }],
        },
      });

    const result = await handleExtract(
      formWithFiles([{ name: "doc.png", type: "image/png", content: Buffer.from("fake") }]),
      ai,
    );

    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ flow: "discovery" });
  });
});

describe("discover handler", () => {
  beforeEach(async () => {
    process.env.PROPOSAL_STORE_PATH = PROPOSAL_TEST_DIR;
    await fs.rm(PROPOSAL_TEST_DIR, { recursive: true, force: true });
    mockGenerateObject.mockReset();
    mockGenerateText.mockReset();
    mockGenerateText.mockResolvedValue({ text: "Mock document summary for tests." });
  });

  afterEach(async () => {
    await fs.rm(PROPOSAL_TEST_DIR, { recursive: true, force: true });
  });

  it("returns schema proposal for admin discover request", async () => {
    mockGenerateObject.mockResolvedValueOnce({
      object: {
        proposedTemplateKey: "contract/nda",
        category: "contract",
        paired: false,
        fields: [{ name: "disclosingParty", type: "string", required: false }],
      },
    });

    const result = await handleDiscover(
      formWithFiles([{ name: "nda.png", type: "image/png", content: Buffer.from("fake") }]),
      ai,
    );

    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({
      proposedTemplateKey: "contract/nda",
      category: "contract",
    });
    expect((result.body as { proposalId: string }).proposalId).toBeTruthy();
  });
});

describe("approve handler", () => {
  beforeEach(async () => {
    process.env.TEMPLATE_STORE_PATH = TEST_DIR;
    process.env.PROPOSAL_STORE_PATH = PROPOSAL_TEST_DIR;
    await fs.mkdir(TEST_DIR, { recursive: true });
    await fs.rm(PROPOSAL_TEST_DIR, { recursive: true, force: true });
    mockGenerateObject.mockReset();
    mockGenerateText.mockReset();
    mockGenerateText.mockResolvedValue({ text: "Mock document summary for tests." });
  });

  afterEach(async () => {
    await fs.rm(TEST_DIR, { recursive: true, force: true });
    await fs.rm(PROPOSAL_TEST_DIR, { recursive: true, force: true });
  });

  it("approves proposal, extracts, and saves template to library", async () => {
    mockGenerateObject.mockResolvedValueOnce({
      object: {
        proposedTemplateKey: "contract/nda",
        category: "contract",
        paired: false,
        fields: [{ name: "disclosingParty", type: "string", required: false }],
      },
    });

    const discover = await handleDiscover(
      formWithFiles([{ name: "nda.png", type: "image/png", content: Buffer.from("fake") }]),
      ai,
    );
    const proposalId = (discover.body as { proposalId: string }).proposalId;

    mockGenerateObject.mockResolvedValueOnce({ object: { disclosingParty: "Acme" } });

    const approve = await handleApprove(proposalId, { template: contractTemplate, save: true }, ai);

    expect(approve.status).toBe(200);
    expect(approve.body).toMatchObject({ saved: true, data: { disclosingParty: "Acme" } });
    expect(await getProposal(proposalId)).toBeNull();

    const saved = await fs.readFile(path.join(TEST_DIR, "contract/nda.json"), "utf8");
    expect(JSON.parse(saved).templateKey).toBe("contract/nda");
  });
});

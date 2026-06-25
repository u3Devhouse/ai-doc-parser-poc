import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { POST as extractPost } from "@/app/api/extract/route";
import { GET as discoverGet, POST as discoverPost } from "@/app/api/discover/route";
import { POST as approvePost } from "@/app/api/discover/[id]/approve/route";

const TEST_DIR = path.join(process.cwd(), "data/templates-test-local-mock");
const PROPOSAL_TEST_DIR = path.join(process.cwd(), "data/proposals-test-local-mock");

function makePngFile(name = "doc.png"): File {
  const buffer = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  );
  return new File([buffer], name, { type: "image/png" });
}

describe("local mock mode (HTTP routes)", () => {
  beforeEach(async () => {
    process.env.AI_GATEWAY_MOCK = "true";
    process.env.AI_GATEWAY_API_KEY = "";
    process.env.TEMPLATE_STORE_PATH = TEST_DIR;
    process.env.PROPOSAL_STORE_PATH = PROPOSAL_TEST_DIR;
    process.env.ADMIN_API_KEY = "dev-admin-secret";
    await fs.rm(TEST_DIR, { recursive: true, force: true });
    await fs.rm(PROPOSAL_TEST_DIR, { recursive: true, force: true });
    await fs.mkdir(path.join(TEST_DIR, "contract"), { recursive: true });
    await fs.writeFile(
      path.join(TEST_DIR, "contract/nda.json"),
      JSON.stringify({
        templateKey: "contract/nda",
        category: "contract",
        version: 1,
        paired: false,
        fields: [
          { name: "disclosingParty", type: "string", required: false },
          { name: "effectiveDate", type: "date", required: false },
        ],
      }),
    );
  });

  afterEach(async () => {
    delete process.env.AI_GATEWAY_MOCK;
    await fs.rm(TEST_DIR, { recursive: true, force: true });
    await fs.rm(PROPOSAL_TEST_DIR, { recursive: true, force: true });
  });

  it("POST /api/extract returns extraction JSON when AI_GATEWAY_MOCK is enabled", async () => {
    const formData = new FormData();
    formData.append("files", makePngFile());
    formData.set("templateKey", "contract/nda");

    const request = new Request("http://localhost/api/extract", { method: "POST", body: formData });
    const response = await extractPost(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      flow: "extraction",
      templateKey: "contract/nda",
      data: {
        disclosingParty: expect.any(String),
        effectiveDate: "2024-01-15",
      },
    });
  });

  it("POST /api/discover returns a schema proposal for admin requests", async () => {
    const formData = new FormData();
    formData.append("files", makePngFile());

    const request = new Request("http://localhost/api/discover", {
      method: "POST",
      headers: { Authorization: "Bearer dev-admin-secret" },
      body: formData,
    });
    const response = await discoverPost(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      proposedTemplateKey: "contract/nda",
      category: "contract",
      proposalId: expect.stringMatching(/^prop_/),
    });
  });

  it("POST /api/discover/:id/approve extracts and optionally saves template", async () => {
    const discoverForm = new FormData();
    discoverForm.append("files", makePngFile("nda.png"));

    const discoverRequest = new Request("http://localhost/api/discover", {
      method: "POST",
      headers: { Authorization: "Bearer dev-admin-secret" },
      body: discoverForm,
    });
    const discoverResponse = await discoverPost(discoverRequest);
    const proposal = await discoverResponse.json();

    const approveRequest = new Request(`http://localhost/api/discover/${proposal.proposalId}/approve`, {
      method: "POST",
      headers: {
        Authorization: "Bearer dev-admin-secret",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        template: {
          templateKey: "contract/nda",
          category: "contract",
          version: 1,
          paired: false,
          fields: proposal.fields,
        },
        save: true,
      }),
    });
    const approveResponse = await approvePost(approveRequest, {
      params: Promise.resolve({ id: proposal.proposalId }),
    });
    const approveBody = await approveResponse.json();

    expect(approveResponse.status).toBe(200);
    expect(approveBody).toMatchObject({
      templateKey: "contract/nda",
      saved: true,
      data: expect.objectContaining({ disclosingParty: expect.any(String) }),
    });

    const saved = await fs.readFile(path.join(TEST_DIR, "contract/nda.json"), "utf8");
    expect(JSON.parse(saved).templateKey).toBe("contract/nda");
  });

  it("GET /api/discover lists proposals created via POST", async () => {
    const discoverForm = new FormData();
    discoverForm.append("files", makePngFile("listed.png"));

    const discoverRequest = new Request("http://localhost/api/discover", {
      method: "POST",
      headers: { Authorization: "Bearer dev-admin-secret" },
      body: discoverForm,
    });
    const discoverResponse = await discoverPost(discoverRequest);
    const proposal = await discoverResponse.json();

    const listRequest = new Request("http://localhost/api/discover", {
      headers: { Authorization: "Bearer dev-admin-secret" },
    });
    const listResponse = await discoverGet(listRequest);
    const listBody = await listResponse.json();

    expect(listResponse.status).toBe(200);
    expect(listBody.proposals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ proposalId: proposal.proposalId, source: "admin" }),
      ]),
    );
  });

  it("POST /api/extract returns 503 when AI is not configured and mock is disabled", async () => {
    delete process.env.AI_GATEWAY_MOCK;

    const formData = new FormData();
    formData.append("files", makePngFile());
    formData.set("templateKey", "contract/nda");

    const request = new Request("http://localhost/api/extract", { method: "POST", body: formData });
    const response = await extractPost(request);
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body).toMatchObject({
      error: "ai_not_configured",
      message: expect.stringContaining("AI_GATEWAY_API_KEY"),
    });
  });
});

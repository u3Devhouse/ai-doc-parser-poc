import { GatewayAuthenticationError, GatewayInternalServerError } from "@ai-sdk/gateway";
import { NoObjectGeneratedError } from "ai";
import { describe, expect, it, vi } from "vitest";
import { aiErrorResponse } from "@/lib/ai-route-errors";
import { ExtractionFailedError, getExtractionModelIds } from "@/lib/extraction-errors";
import { extractStructured } from "@/lib/extraction";
import { handleApprove } from "@/lib/discover-handler";
import type { Template } from "@/lib/types";
import fs from "node:fs/promises";
import path from "node:path";

describe("aiErrorResponse", () => {
  it("maps authentication errors to ai_not_configured", async () => {
    const response = aiErrorResponse(
      new GatewayAuthenticationError({ message: "Unauthenticated request to AI Gateway." }),
    );

    expect(response?.status).toBe(503);
    const body = await response?.json();
    expect(body).toMatchObject({ error: "ai_not_configured" });
  });

  it("maps gateway errors to JSON with the gateway message", async () => {
    const response = aiErrorResponse(
      new GatewayInternalServerError({
        message: "Free tier users do not have access to this model.",
        statusCode: 403,
      }),
    );

    expect(response?.status).toBe(403);
    const body = await response?.json();
    expect(body).toMatchObject({
      error: "ai_gateway_error",
      message: "Free tier users do not have access to this model.",
    });
  });

  it("maps NoObjectGeneratedError to extraction_failed with actionable message", async () => {
    const response = aiErrorResponse(
      new NoObjectGeneratedError({
        message: "No object generated",
        response: { id: "test", timestamp: new Date(), modelId: "test" },
        usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
        finishReason: "stop",
      }),
    );

    expect(response?.status).toBe(422);
    const body = await response?.json();
    expect(body).toMatchObject({ error: "extraction_failed" });
    expect(body.message).toContain("EXTRACTION_PIPELINE=two-stage");
  });

  it("maps ExtractionFailedError with models and strategies tried", async () => {
    const response = aiErrorResponse(
      new ExtractionFailedError(new Error("validation failed"), {
        modelsTried: ["openai/gpt-4o", "openai/gpt-4o-mini"],
        strategiesTried: ["single-stage-vision", "two-stage-fallback"],
      }),
    );

    expect(response?.status).toBe(422);
    const body = await response?.json();
    expect(body.message).toContain("openai/gpt-4o");
    expect(body.message).toContain("two-stage-fallback");
  });
});

describe("extractStructured model fallback", () => {
  const template: Template = {
    templateKey: "contract/nda",
    category: "contract",
    version: 1,
    paired: false,
    fields: [{ name: "disclosingParty", type: "string", required: false }],
  };

  it("retries with fallback model when primary returns no object", async () => {
    const generateObject = vi
      .fn()
      .mockRejectedValueOnce(
        new NoObjectGeneratedError({
          message: "No object generated",
          response: { id: "1", timestamp: new Date(), modelId: "minimax/minimax-m3" },
          usage: { inputTokens: 1, outputTokens: 0, totalTokens: 1 },
          finishReason: "stop",
        }),
      )
      .mockResolvedValueOnce({ object: { disclosingParty: "Acme Corp" } });

    process.env.EXTRACTION_MODEL = "minimax/minimax-m3";
    process.env.EXTRACTION_FALLBACK_MODEL = "openai/gpt-4o-mini";

    const data = await extractStructured(
      template,
      {
        buffers: [Buffer.from("fake-image")],
        mimeTypes: ["image/png"],
        filenames: ["doc.png"],
      },
      { generateObject },
    );

    expect(data).toEqual({ disclosingParty: "Acme Corp" });
    expect(generateObject).toHaveBeenCalledTimes(2);
  });

  it("keeps a distinct fallback when primary matches DISCOVERY_MODEL", () => {
    process.env.EXTRACTION_MODEL = "openai/gpt-4o-mini";
    process.env.DISCOVERY_MODEL = "openai/gpt-4o-mini";
    delete process.env.EXTRACTION_FALLBACK_MODEL;

    expect(getExtractionModelIds("openai/gpt-4o-mini")).toEqual([
      "openai/gpt-4o-mini",
      "openai/gpt-4o",
    ]);
  });

  it("falls back to two-stage when single-stage vision extraction fails", async () => {
    const noObject = new NoObjectGeneratedError({
      message: "No object generated",
      response: { id: "1", timestamp: new Date(), modelId: "openai/gpt-4o" },
      usage: { inputTokens: 1, outputTokens: 0, totalTokens: 1 },
      finishReason: "stop",
    });

    const generateObject = vi
      .fn()
      .mockRejectedValueOnce(noObject)
      .mockRejectedValueOnce(noObject)
      .mockResolvedValueOnce({ object: { disclosingParty: "Acme Corp" } });

    const generateText = vi.fn().mockResolvedValue({ text: "Disclosing party: Acme Corp" });

    process.env.EXTRACTION_MODEL = "openai/gpt-4o";
    process.env.EXTRACTION_FALLBACK_MODEL = "openai/gpt-4o-mini";

    const data = await extractStructured(
      template,
      {
        buffers: [Buffer.from("fake-image")],
        mimeTypes: ["image/png"],
        filenames: ["doc.png"],
      },
      { generateObject, generateText },
    );

    expect(data).toEqual({ disclosingParty: "Acme Corp" });
    expect(generateText).toHaveBeenCalledTimes(1);
    expect(generateObject).toHaveBeenCalledTimes(3);
  });

  it("returns 422 with strategy details when approve extraction exhausts fallbacks", async () => {
    const proposalDir = path.join(process.cwd(), "data/proposals-test-approve-fallback");
    const templateDir = path.join(process.cwd(), "data/templates-test-approve-fallback");
    process.env.PROPOSAL_STORE_PATH = proposalDir;
    process.env.TEMPLATE_STORE_PATH = templateDir;

    const noObject = new NoObjectGeneratedError({
      message: "No object generated",
      response: { id: "1", timestamp: new Date(), modelId: "openai/gpt-4o" },
      usage: { inputTokens: 1, outputTokens: 0, totalTokens: 1 },
      finishReason: "stop",
    });

    const generateObject = vi.fn().mockRejectedValue(noObject);
    const generateText = vi.fn().mockResolvedValue({ text: "unstructured text" });

    const { saveProposal } = await import("@/lib/proposal-store");
    await fs.mkdir(proposalDir, { recursive: true });
    await saveProposal(
      {
        proposalId: "prop_test",
        proposedTemplateKey: "contract/nda",
        category: "contract",
        paired: false,
        fields: [{ name: "disclosingParty", type: "string", required: false }],
      },
      {
        buffers: [Buffer.from("fake")],
        mimeTypes: ["image/png"],
        filenames: ["doc.png"],
        documentSummary: "summary",
      },
      "admin",
    );

    const approve = await handleApprove(
      "prop_test",
      {
        template: {
          templateKey: "contract/nda",
          category: "contract",
          version: 1,
          paired: false,
          fields: [{ name: "disclosingParty", type: "string", required: false }],
        },
      },
      { generateObject, generateText },
    );

    expect(approve.status).toBe(422);
    if (approve.status === 422) {
      expect(approve.body.error).toBe("extraction_failed");
      expect(approve.body.message).toContain("two-stage-fallback");
    }

    await fs.rm(proposalDir, { recursive: true, force: true });
    await fs.rm(templateDir, { recursive: true, force: true });
  });
});

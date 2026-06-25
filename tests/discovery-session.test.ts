import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  handleChat,
  handleDiscover,
  handleGetProposal,
  handleRevise,
  handleUpdateDraft,
} from "@/lib/discover-handler";
import {
  applyAddField,
  applyRemoveField,
  applySetCategory,
} from "@/lib/discovery-schema-tools";
import type { DiscoverProposal } from "@/lib/types";

const PROPOSAL_TEST_DIR = path.join(process.cwd(), "data/proposals-test-session");

function makePngBuffer(): Buffer {
  return Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  );
}

const mockProposal = {
  proposedTemplateKey: "identity/GT/dpi",
  category: "identity" as const,
  paired: true,
  fields: undefined,
  sides: {
    front: {
      fields: [
        { name: "fullName", type: "string" as const, required: false },
        { name: "bloodType", type: "string" as const, required: false },
      ],
    },
    back: {
      fields: [{ name: "expirationDate", type: "date" as const, required: false }],
    },
  },
};

const aiOverrides = {
  generateText: vi.fn(async () => ({
    text: "2-page Guatemala DPI scan. Spanish labels. Paired front/back.",
  })),
  generateObject: vi.fn(async () => ({ object: mockProposal })),
};

describe("discovery session", () => {
  beforeEach(async () => {
    process.env.PROPOSAL_STORE_PATH = PROPOSAL_TEST_DIR;
    await fs.rm(PROPOSAL_TEST_DIR, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  afterEach(async () => {
    await fs.rm(PROPOSAL_TEST_DIR, { recursive: true, force: true });
  });

  it("returns document summary when creating a session", async () => {
    const formData = new FormData();
    formData.append("files", new File([makePngBuffer()], "dpi.png", { type: "image/png" }));

    const result = await handleDiscover(formData, aiOverrides);

    expect(result.status).toBe(200);
    if (result.status === 200) {
      expect(result.body.documentSummary).toContain("Guatemala DPI");
      expect(result.body.proposalId).toMatch(/^prop_/);
    }
  });

  it("returns full session from GET handler", async () => {
    const formData = new FormData();
    formData.append("files", new File([makePngBuffer()], "dpi.png", { type: "image/png" }));
    const created = await handleDiscover(formData, aiOverrides);
    if (created.status !== 200) {
      throw new Error("discover failed");
    }

    const session = await handleGetProposal(created.body.proposalId);
    expect(session.status).toBe(200);
    if (session.status === 200) {
      expect(session.body.documentSummary).toContain("Guatemala DPI");
      expect(session.body.messages).toEqual([]);
      expect(session.body.revisionCount).toBe(0);
      expect(session.body.sides?.front?.fields).toHaveLength(2);
    }
  });

  it("persists draft updates from the field table", async () => {
    const formData = new FormData();
    formData.append("files", new File([makePngBuffer()], "dpi.png", { type: "image/png" }));
    const created = await handleDiscover(formData, aiOverrides);
    if (created.status !== 200) {
      throw new Error("discover failed");
    }

    const updated = await handleUpdateDraft(created.body.proposalId, {
      proposedTemplateKey: "identity/GT/dpi_v2",
      fields: [{ name: "cui", type: "string", required: true }],
      paired: false,
    });

    expect(updated.status).toBe(200);
    if (updated.status === 200) {
      expect(updated.body.proposedTemplateKey).toBe("identity/GT/dpi_v2");
      expect(updated.body.fields?.[0]?.name).toBe("cui");
    }
  });

  it("revises schema from cached files, updates summary, and increments revision count", async () => {
    const formData = new FormData();
    formData.append("files", new File([makePngBuffer()], "dpi.png", { type: "image/png" }));
    const created = await handleDiscover(formData, aiOverrides);
    if (created.status !== 200) {
      throw new Error("discover failed");
    }

    const reviseOverrides = {
      ...aiOverrides,
      generateText: vi.fn(async () => ({
        text: "Updated summary after re-read: Guatemala DPI with front identity fields and back expiration.",
      })),
      generateObject: vi.fn(async () => ({
        object: {
          ...mockProposal,
          sides: {
            front: { fields: [{ name: "fullName", type: "string", required: false }] },
            back: {
              fields: [
                { name: "expirationDate", type: "date", required: false },
                { name: "address", type: "text", required: false },
              ],
            },
          },
        },
      })),
    };

    const revised = await handleRevise(created.body.proposalId, reviseOverrides);
    expect(revised.status).toBe(200);
    if (revised.status === 200) {
      expect(revised.body.revisionCount).toBe(1);
      expect(revised.body.sides?.back?.fields).toHaveLength(2);
      expect(revised.body.documentSummary).toContain("Updated summary after re-read");
    }
  });

  it("applies chat tool mutations to the stored draft", async () => {
    const formData = new FormData();
    formData.append("files", new File([makePngBuffer()], "dpi.png", { type: "image/png" }));
    const created = await handleDiscover(formData, aiOverrides);
    if (created.status !== 200) {
      throw new Error("discover failed");
    }

    const chatResult = await handleChat(
      created.body.proposalId,
      [
        {
          id: "user-1",
          role: "user",
          parts: [{ type: "text", text: "Remove blood type" }],
        },
      ],
      {
        streamText: async (options: {
          tools: {
            removeField: { execute: (input: { name: string; side?: "front" | "back" }) => Promise<unknown> };
          };
          onFinish: (result: { text: string }) => Promise<void>;
        }) => {
          await options.tools.removeField.execute({ name: "bloodType", side: "front" });
          await options.onFinish({ text: "Removed bloodType from front fields." });
          return {
            text: "Removed bloodType from front fields.",
            toUIMessageStreamResponse: () => new Response("ok"),
          };
        },
      },
    );

    expect(chatResult.kind).toBe("stream");

    const session = await handleGetProposal(created.body.proposalId);
    if (session.status !== 200) {
      throw new Error("session load failed");
    }
    expect(session.body.messages).toHaveLength(2);
    expect(session.body.messages[0]?.content).toBe("Remove blood type");
    expect(session.body.sides?.front?.fields?.some((field) => field.name === "bloodType")).toBe(false);
  });
});

describe("discovery schema tools", () => {
  const baseProposal: DiscoverProposal = {
    proposalId: "prop_test",
    proposedTemplateKey: "identity/GT/dpi",
    category: "identity",
    paired: true,
    sides: {
      front: { fields: [{ name: "bloodType", type: "string", required: false }] },
      back: { fields: [{ name: "expirationDate", type: "date", required: false }] },
    },
  };

  it("adds and removes fields on the correct side", () => {
    const withField = applyAddField(baseProposal, {
      name: "cui",
      type: "string",
      side: "front",
    });
    expect(withField.sides?.front?.fields?.some((field) => field.name === "cui")).toBe(true);

    const withoutBloodType = applyRemoveField(withField, { name: "bloodType", side: "front" });
    expect(withoutBloodType.sides?.front?.fields?.some((field) => field.name === "bloodType")).toBe(false);
  });

  it("updates category and template metadata", () => {
    const next = applySetCategory(baseProposal, "legal");
    expect(next.category).toBe("legal");
  });
});

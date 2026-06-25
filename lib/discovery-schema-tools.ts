import { tool } from "ai";
import { z } from "zod";
import type { DiscoverProposal, TemplateField } from "./types";

const fieldTypeSchema = z.enum(["string", "date", "number", "boolean", "string[]", "text"]);
const sideSchema = z.enum(["front", "back"]);

function cloneProposal(proposal: DiscoverProposal): DiscoverProposal {
  return JSON.parse(JSON.stringify(proposal)) as DiscoverProposal;
}

function getFieldList(proposal: DiscoverProposal, side?: "front" | "back"): TemplateField[] {
  if (proposal.paired && side) {
    return proposal.sides?.[side]?.fields ?? [];
  }
  return proposal.fields ?? [];
}

function setFieldList(
  proposal: DiscoverProposal,
  fields: TemplateField[],
  side?: "front" | "back",
): DiscoverProposal {
  const next = cloneProposal(proposal);
  if (next.paired && side) {
    next.sides = next.sides ?? {};
    next.sides[side] = { fields };
    return next;
  }
  next.fields = fields;
  return next;
}

export function applyAddField(
  proposal: DiscoverProposal,
  input: {
    name: string;
    type: TemplateField["type"];
    side?: "front" | "back";
    description?: string;
  },
): DiscoverProposal {
  const fields = getFieldList(proposal, input.side);
  if (fields.some((field) => field.name === input.name)) {
    return proposal;
  }
  const nextField: TemplateField = {
    name: input.name,
    type: input.type,
    required: false,
    description: input.description,
  };
  return setFieldList(proposal, [...fields, nextField], input.side);
}

export function applyRemoveField(
  proposal: DiscoverProposal,
  input: { name: string; side?: "front" | "back" },
): DiscoverProposal {
  const fields = getFieldList(proposal, input.side).filter((field) => field.name !== input.name);
  return setFieldList(proposal, fields, input.side);
}

export function applyUpdateField(
  proposal: DiscoverProposal,
  input: {
    name: string;
    side?: "front" | "back";
    newName?: string;
    type?: TemplateField["type"];
    description?: string;
    required?: boolean;
  },
): DiscoverProposal {
  const fields = getFieldList(proposal, input.side).map((field) => {
    if (field.name !== input.name) {
      return field;
    }
    return {
      ...field,
      name: input.newName ?? field.name,
      type: input.type ?? field.type,
      description: input.description ?? field.description,
      required: input.required ?? field.required,
    };
  });
  return setFieldList(proposal, fields, input.side);
}

export function applySetTemplateKey(proposal: DiscoverProposal, templateKey: string): DiscoverProposal {
  const next = cloneProposal(proposal);
  next.proposedTemplateKey = templateKey;
  return next;
}

export function applySetPaired(proposal: DiscoverProposal, paired: boolean): DiscoverProposal {
  const next = cloneProposal(proposal);
  next.paired = paired;
  if (paired && !next.sides) {
    next.sides = {
      front: { fields: next.fields ?? [] },
      back: { fields: [] },
    };
    delete next.fields;
  }
  if (!paired && next.sides) {
    next.fields = next.sides.front?.fields ?? [];
    delete next.sides;
  }
  return next;
}

export function applySetCategory(
  proposal: DiscoverProposal,
  category: DiscoverProposal["category"],
): DiscoverProposal {
  const next = cloneProposal(proposal);
  next.category = category;
  return next;
}

export type SchemaToolMutator = (proposal: DiscoverProposal) => DiscoverProposal;

export function createDiscoverySchemaTools(onMutate: (mutator: SchemaToolMutator) => void) {
  return {
    addField: tool({
      description: "Add a new optional field to the draft extraction schema",
      inputSchema: z.object({
        name: z.string(),
        type: fieldTypeSchema,
        side: sideSchema.optional(),
        description: z.string().optional(),
      }),
      execute: async (input) => {
        onMutate((proposal) => applyAddField(proposal, input));
        return { ok: true, action: "addField", ...input };
      },
    }),
    removeField: tool({
      description: "Remove a field from the draft extraction schema",
      inputSchema: z.object({
        name: z.string(),
        side: sideSchema.optional(),
      }),
      execute: async (input) => {
        onMutate((proposal) => applyRemoveField(proposal, input));
        return { ok: true, action: "removeField", ...input };
      },
    }),
    updateField: tool({
      description: "Update an existing field in the draft extraction schema",
      inputSchema: z.object({
        name: z.string(),
        side: sideSchema.optional(),
        newName: z.string().optional(),
        type: fieldTypeSchema.optional(),
        description: z.string().optional(),
        required: z.boolean().optional(),
      }),
      execute: async (input) => {
        onMutate((proposal) => applyUpdateField(proposal, input));
        return { ok: true, action: "updateField", ...input };
      },
    }),
    setTemplateKey: tool({
      description: "Set the proposed template key for this document",
      inputSchema: z.object({
        templateKey: z.string(),
      }),
      execute: async ({ templateKey }) => {
        onMutate((proposal) => applySetTemplateKey(proposal, templateKey));
        return { ok: true, action: "setTemplateKey", templateKey };
      },
    }),
    setPaired: tool({
      description: "Set whether this identity document template is paired (front/back)",
      inputSchema: z.object({
        paired: z.boolean(),
      }),
      execute: async ({ paired }) => {
        onMutate((proposal) => applySetPaired(proposal, paired));
        return { ok: true, action: "setPaired", paired };
      },
    }),
    setCategory: tool({
      description: "Set the document category (identity, contract, legal)",
      inputSchema: z.object({
        category: z.enum(["identity", "contract", "legal"]),
      }),
      execute: async ({ category }) => {
        onMutate((proposal) => applySetCategory(proposal, category));
        return { ok: true, action: "setCategory", category };
      },
    }),
  };
}

import type { AiOverrides } from "./extraction";
import { isProposalZodShape } from "./schema";

type ZodInnerDef = {
  typeName?: string;
  checks?: { kind: string }[];
};

type ZodShapeNode = {
  _def?: {
    typeName?: string;
    innerType?: { _def?: ZodInnerDef };
  };
  shape?: Record<string, unknown>;
};

function mockValueForZodNode(fieldSchema: unknown, fieldName: string): unknown {
  const described = fieldSchema as ZodShapeNode;
  const typeName = described._def?.typeName;
  const innerDef = described._def?.innerType?._def;

  const resolveType = (name?: string, inner?: ZodInnerDef) => {
    if (name === "ZodNumber" || inner?.typeName === "ZodNumber") {
      return 1;
    }
    if (name === "ZodBoolean" || inner?.typeName === "ZodBoolean") {
      return true;
    }
    if (name === "ZodArray" || inner?.typeName === "ZodArray") {
      return ["mock-item"];
    }
    if (inner?.checks?.some((check: { kind: string }) => check.kind === "regex")) {
      return "2024-01-15";
    }
    if (name === "ZodUnknown" || inner?.typeName === "ZodUnknown") {
      if (/date|fecha/i.test(fieldName)) {
        return "2024-01-15";
      }
      if (/participacion|enabled|active|paired/i.test(fieldName)) {
        return true;
      }
      return `mock-${fieldName}`;
    }
    return `mock-${fieldName}`;
  };

  if (typeName === "ZodOptional" || typeName === "ZodDefault") {
    return resolveType(innerDef?.typeName, innerDef);
  }

  if (typeName === "ZodObject" && described.shape) {
    return mockExtractionFromShape(described.shape);
  }

  return resolveType(typeName, described._def);
}

function mockExtractionFromShape(shape: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!shape) {
    return { disclosingParty: "Acme Corp (mock)", effectiveDate: "2024-01-15" };
  }

  if (isProposalZodShape(shape)) {
    return {
      proposedTemplateKey: "contract/nda",
      category: "contract",
      paired: false,
      fields: [
        { name: "disclosingParty", type: "string", required: false },
        { name: "effectiveDate", type: "date", required: false },
      ],
    };
  }

  if ("templateKey" in shape) {
    return { templateKey: "contract/nda", category: "contract" };
  }

  if ("sides" in shape && Object.keys(shape).length === 1) {
    const sidesNode = shape.sides as ZodShapeNode;
    const sideShape = sidesNode.shape ?? {};
    const sides: Record<string, Record<string, unknown>> = {};

    for (const [sideName, sideNode] of Object.entries(sideShape)) {
      const fieldsShape = (sideNode as ZodShapeNode).shape ?? {};
      sides[sideName] = mockExtractionFromShape(fieldsShape);
    }

    return { sides };
  }

  const result: Record<string, unknown> = {};
  for (const [name, fieldSchema] of Object.entries(shape)) {
    result[name] = mockValueForZodNode(fieldSchema, name);
  }

  return Object.keys(result).length > 0
    ? result
    : { disclosingParty: "Acme Corp (mock)", effectiveDate: "2024-01-15" };
}

export function createMockAiOverrides(): AiOverrides {
  return {
    generateObject: async (options: unknown) => {
      const opts = options as { schema?: { shape?: Record<string, unknown> } };
      return { object: mockExtractionFromShape(opts.schema?.shape) };
    },
    generateText: async () => ({ text: "Mock vision output for local development." }),
  };
}

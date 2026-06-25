import { GatewayAuthenticationError, GatewayError } from "@ai-sdk/gateway";
import { NextResponse } from "next/server";
import { extractionFailureMessage, isExtractionFailure, SchemaDefinitionResponseError } from "./extraction-errors";

export function aiErrorResponse(error: unknown): NextResponse | null {
  if (error instanceof SchemaDefinitionResponseError) {
    return NextResponse.json(
      {
        error: "schema_mismatch",
        message: error.message,
      },
      { status: 422 },
    );
  }

  if (isExtractionFailure(error)) {
    return NextResponse.json(
      {
        error: "extraction_failed",
        message: extractionFailureMessage(error),
      },
      { status: 422 },
    );
  }

  if (GatewayAuthenticationError.isInstance(error)) {
    return NextResponse.json(
      {
        error: "ai_not_configured",
        message:
          "Set AI_GATEWAY_API_KEY for real extraction, or AI_GATEWAY_MOCK=true for local mock responses.",
      },
      { status: 503 },
    );
  }

  if (GatewayError.isInstance(error)) {
    const status = error.statusCode >= 400 && error.statusCode < 600 ? error.statusCode : 502;
    return NextResponse.json(
      {
        error: "ai_gateway_error",
        message: error.message,
      },
      { status },
    );
  }

  if (error instanceof Error && error.name === "GatewayAuthenticationError") {
    return NextResponse.json(
      {
        error: "ai_not_configured",
        message:
          "Set AI_GATEWAY_API_KEY for real extraction, or AI_GATEWAY_MOCK=true for local mock responses.",
      },
      { status: 503 },
    );
  }

  return null;
}

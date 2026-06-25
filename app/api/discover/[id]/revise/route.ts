import { NextResponse } from "next/server";
import { isAdminAuthorized } from "@/lib/auth";
import { handleRevise } from "@/lib/discover-handler";
import { aiErrorResponse } from "@/lib/ai-route-errors";
import { resolveAiOverrides } from "@/lib/resolve-ai-overrides";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  if (!isAdminAuthorized(request.headers.get("authorization"))) {
    return NextResponse.json(
      { error: "unauthorized", message: "Admin API key required" },
      { status: 401 },
    );
  }

  const { id } = await context.params;

  try {
    const result = await handleRevise(id, resolveAiOverrides());
    return NextResponse.json(result.body, { status: result.status });
  } catch (error) {
    const gatewayResponse = aiErrorResponse(error);
    if (gatewayResponse) {
      return gatewayResponse;
    }
    throw error;
  }
}

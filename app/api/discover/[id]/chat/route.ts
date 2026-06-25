import { NextResponse } from "next/server";
import { isAdminAuthorized } from "@/lib/auth";
import { handleChat } from "@/lib/discover-handler";
import { aiErrorResponse } from "@/lib/ai-route-errors";
import { resolveAiOverrides } from "@/lib/resolve-ai-overrides";
import type { UIMessage } from "ai";

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
  const body = (await request.json()) as { messages: UIMessage[] };

  try {
    const result = await handleChat(id, body.messages, resolveAiOverrides());
    if (result.kind === "error") {
      return NextResponse.json(result.body, { status: result.status });
    }
    return result.response;
  } catch (error) {
    const gatewayResponse = aiErrorResponse(error);
    if (gatewayResponse) {
      return gatewayResponse;
    }
    throw error;
  }
}

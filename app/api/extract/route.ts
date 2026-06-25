import { NextResponse } from "next/server";
import { handleExtract } from "@/lib/extract-handler";
import { aiErrorResponse } from "@/lib/ai-route-errors";
import { resolveAiOverrides } from "@/lib/resolve-ai-overrides";

export async function POST(request: Request) {
  const formData = await request.formData();
  try {
    const result = await handleExtract(formData, resolveAiOverrides());
    return NextResponse.json(result.body, { status: result.status });
  } catch (error) {
    const gatewayResponse = aiErrorResponse(error);
    if (gatewayResponse) {
      return gatewayResponse;
    }
    throw error;
  }
}

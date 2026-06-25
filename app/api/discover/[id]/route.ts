import { NextResponse } from "next/server";
import { isAdminAuthorized } from "@/lib/auth";
import { handleGetProposal, handleUpdateDraft } from "@/lib/discover-handler";
import type { DiscoverProposal } from "@/lib/types";

export async function GET(
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
  const result = await handleGetProposal(id);
  return NextResponse.json(result.body, { status: result.status });
}

export async function PATCH(
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
  const body = (await request.json()) as Partial<DiscoverProposal>;
  const result = await handleUpdateDraft(id, body);
  return NextResponse.json(result.body, { status: result.status });
}

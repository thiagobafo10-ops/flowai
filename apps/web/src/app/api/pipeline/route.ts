import { NextResponse, type NextRequest } from "next/server";
import { unstable_rethrow } from "next/navigation";
import { parseKanbanFilters } from "@flowai/core";
import { getActiveOrg } from "@/lib/org/active-org";
import { getBoard } from "@/lib/crm/queries";

const headers = { "Cache-Control": "no-store" };

export async function GET(request: NextRequest) {
  try {
    const org = await getActiveOrg();
    if (!org) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401, headers });
    }
    const filters = parseKanbanFilters(Object.fromEntries(request.nextUrl.searchParams));
    const board = await getBoard(org.id, filters);
    return NextResponse.json(board, { headers });
  } catch (err) {
    unstable_rethrow(err);
    console.error("pipeline api failed", err);
    return NextResponse.json(
      { error: "Não foi possível carregar o pipeline." },
      { status: 500, headers },
    );
  }
}

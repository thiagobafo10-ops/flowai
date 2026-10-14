import { NextResponse } from "next/server";
import { generateAutomationWithAi } from "@/lib/automation/ai-actions";
import { AUTOMATION_FORBIDDEN } from "@/lib/automation/messages";

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const prompt = typeof body?.prompt === "string" ? body.prompt : "";
    const currentGraph = body?.currentGraph;

    const result = await generateAutomationWithAi({
      prompt,
      currentGraph,
    });

    if (!result.ok) {
      const status = result.error === AUTOMATION_FORBIDDEN ? 403 : 400;
      return NextResponse.json(result, { status });
    }

    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    console.error("POST /api/automacoes/gerar error:", error);
    return NextResponse.json(
      { ok: false, error: "Não foi possível processar a requisição." },
      { status: 500 },
    );
  }
}

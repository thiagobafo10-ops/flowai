import type { OpsHealth } from "@flowai/core";

export type HealthIssue = { severity: "critical" | "warning"; message: string };

/** Eventos pendentes há mais que isso sugerem worker parado. */
export const STALE_PENDING_MS = 5 * 60 * 1000;

/**
 * Lista o que exige atenção, em ordem de gravidade. `generated_at` é usado como
 * "agora" para que a decisão seja determinística entre servidor e cliente.
 */
export function healthIssues(health: OpsHealth): HealthIssue[] {
  const issues: HealthIssue[] = [];
  const generated = Date.parse(health.generated_at);
  const oldest = health.instagram_events.oldest_pending_at;
  if (oldest && Number.isFinite(generated) && generated - Date.parse(oldest) > STALE_PENDING_MS) {
    issues.push({
      severity: "critical",
      message: "Há comentários/eventos na fila parados há mais de 5 minutos (o worker pode estar parado).",
    });
  }
  if (health.send_intents.failed > 0) {
    issues.push({
      severity: "critical",
      message: `${health.send_intents.failed} envio(s) do Instagram falharam e precisam de reenvio.`,
    });
  }
  if (health.automation_runs.stalled > 0) {
    issues.push({
      severity: "critical",
      message: `${health.automation_runs.stalled} execução(ões) de automação travada(s).`,
    });
  }
  if (health.ai_jobs.stuck > 0) {
    issues.push({
      severity: "critical",
      message: `${health.ai_jobs.stuck} tarefa(s) da IA travada(s).`,
    });
  }
  if (health.send_intents.uncertain > 0) {
    issues.push({
      severity: "warning",
      message: `${health.send_intents.uncertain} envio(s) em estado incerto (podem ter saído ou não).`,
    });
  }
  for (const c of health.channels) {
    if (c.status === "error") {
      issues.push({ severity: "critical", message: `Canal “${c.name}” está com erro.` });
      continue;
    }
    if (c.connection?.disconnected_at) {
      issues.push({ severity: "critical", message: `A conexão Meta do canal “${c.name}” está desconectada.` });
    } else if (c.connection && !c.connection.token_verified_at) {
      issues.push({ severity: "warning", message: `O token do canal “${c.name}” ainda não foi validado.` });
    } else if (c.connection && !c.connection.webhook_verified_at) {
      issues.push({ severity: "warning", message: `O webhook do canal “${c.name}” ainda não foi validado.` });
    }
  }
  if (health.vip.some((v) => v.enabled && (v.comments_error || v.last_error))) {
    issues.push({
      severity: "warning",
      message: "As respostas automáticas (VIP) de um canal relatam erro.",
    });
  }
  return issues;
}

/** Data curta e determinística (fuso da organização) — segura para SSR e CSR. */
export function formatStamp(iso: string | null, timeZone: string): string {
  if (!iso) return "—";
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return "—";
  const date = new Date(ms);
  try {
    return new Intl.DateTimeFormat("pt-BR", {
      timeZone,
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).format(date);
  } catch {
    return date.toISOString().slice(0, 16).replace("T", " ");
  }
}

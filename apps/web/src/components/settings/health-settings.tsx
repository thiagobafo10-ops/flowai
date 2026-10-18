"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import type { OpsHealth, OpsErrorCount } from "@flowai/core";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatStamp, healthIssues } from "@/lib/ops/health-view";

const CHANNEL_STATUS = {
  active: { label: "Ativo", className: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" },
  needs_setup: { label: "Não configurado", className: "bg-muted text-muted-foreground" },
  error: { label: "Erro", className: "bg-destructive/10 text-destructive" },
} as const;

type Tone = "neutral" | "warn" | "bad";

function Stat({ label, value, tone = "neutral" }: { label: string; value: number; tone?: Tone }) {
  const toneClass =
    tone === "bad" ? "text-destructive" : tone === "warn" ? "text-amber-600 dark:text-amber-500" : "text-foreground";
  return (
    <div className="rounded-lg border bg-background px-3 py-2">
      <div className={cn("text-lg font-semibold tabular-nums", value > 0 ? toneClass : "text-muted-foreground")}>
        {value}
      </div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
}

function Section({ title, hint, children }: { title: string; hint: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3 rounded-lg border p-4">
      <div className="space-y-0.5">
        <h2 className="text-base font-medium">{title}</h2>
        <p className="text-xs text-muted-foreground">{hint}</p>
      </div>
      {children}
    </section>
  );
}

function ErrorList({ errors }: { errors: OpsErrorCount[] }) {
  if (errors.length === 0) {
    return <p className="text-xs text-muted-foreground">Nenhum erro registrado nos últimos 7 dias.</p>;
  }
  return (
    <ul className="space-y-1 text-xs">
      {errors.map((e) => (
        <li key={e.code} className="flex items-center justify-between gap-3">
          <code className="truncate rounded bg-muted px-1.5 py-0.5 text-muted-foreground">{e.code}</code>
          <span className="tabular-nums text-muted-foreground">{e.count}</span>
        </li>
      ))}
    </ul>
  );
}

export function HealthSettings({ health }: { health: OpsHealth }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const issues = healthIssues(health);
  const critical = issues.filter((i) => i.severity === "critical");

  return (
    <div data-testid="ops-health" className="space-y-6" aria-busy={pending}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Filas, envios, automações e IA. Atualizado em {formatStamp(health.generated_at, health.timezone)}.
        </p>
        <Button
          variant="outline"
          size="sm"
          disabled={pending}
          onClick={() => startTransition(() => router.refresh())}
        >
          <RefreshCw className={pending ? "animate-spin" : undefined} />
          Atualizar
        </Button>
      </div>

      {issues.length === 0 ? (
        <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-4 text-sm text-emerald-700 dark:text-emerald-400">
          Tudo funcionando: nenhum problema operacional detectado.
        </div>
      ) : (
        <div
          role="alert"
          className={cn(
            "space-y-2 rounded-lg border p-4 text-sm",
            critical.length > 0
              ? "border-destructive/30 bg-destructive/5 text-destructive"
              : "border-amber-500/30 bg-amber-500/5 text-amber-700 dark:text-amber-500",
          )}
        >
          <p className="font-medium">
            {critical.length > 0 ? "Atenção necessária" : "Pontos de atenção"} ({issues.length})
          </p>
          <ul className="list-inside list-disc space-y-1">
            {issues.map((i, index) => (
              <li key={`${index}-${i.message}`}>{i.message}</li>
            ))}
          </ul>
        </div>
      )}

      <Section title="Canais" hint="Status da conta e verificação da conexão Meta.">
        {health.channels.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhum canal conectado.</p>
        ) : (
          <ul className="space-y-2">
            {health.channels.map((c) => {
              const status = CHANNEL_STATUS[c.status];
              return (
                <li key={c.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border bg-background px-3 py-2">
                  <span className="font-medium">{c.name}</span>
                  <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">{c.type}</span>
                  <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", status.className)}>{status.label}</span>
                  {c.connection ? (
                    <span className="text-xs text-muted-foreground">
                      Token: {formatStamp(c.connection.token_verified_at, health.timezone)} · Webhook:{" "}
                      {formatStamp(c.connection.webhook_verified_at, health.timezone)}
                      {c.connection.disconnected_at
                        ? ` · Desconectada em ${formatStamp(c.connection.disconnected_at, health.timezone)}`
                        : ""}
                    </span>
                  ) : (
                    <span className="text-xs text-muted-foreground">Sem conexão Meta</span>
                  )}
                  {c.last_error || c.connection?.last_error ? (
                    <code className="rounded bg-destructive/10 px-1.5 py-0.5 text-xs text-destructive">
                      {c.last_error ?? c.connection?.last_error}
                    </code>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </Section>

      <div className="grid gap-6 lg:grid-cols-2">
        <Section title="Eventos do Instagram" hint="Comentários e DMs que entram na fila do worker.">
          <div className="grid grid-cols-3 gap-2">
            <Stat label="Na fila" value={health.instagram_events.pending} tone="warn" />
            <Stat label="Incerto" value={health.instagram_events.uncertain} tone="warn" />
            <Stat label="Falhou" value={health.instagram_events.failed} tone="bad" />
            <Stat label="Ignorados (24h)" value={health.instagram_events.ignored_24h} />
            <Stat label="Recebidos (24h)" value={health.instagram_events.pending_24h} />
          </div>
          <p className="text-xs text-muted-foreground">
            Evento mais antigo aguardando: {formatStamp(health.instagram_events.oldest_pending_at, health.timezone)}.
          </p>
          <div className="space-y-1">
            <p className="text-xs font-medium">Erros mais comuns</p>
            <ErrorList errors={health.instagram_events.top_errors} />
          </div>
        </Section>

        <Section title="Envios" hint="Mensagens no Direct e respostas privadas de comentário.">
          <div className="grid grid-cols-3 gap-2">
            <Stat label="Na fila" value={health.send_intents.pending} tone="warn" />
            <Stat label="Enviando" value={health.send_intents.sending} tone="warn" />
            <Stat label="Falhou" value={health.send_intents.failed} tone="bad" />
            <Stat label="Incerto" value={health.send_intents.uncertain} tone="warn" />
            <Stat label="Enviados (24h)" value={health.send_intents.sent_24h} />
          </div>
          <div className="space-y-1">
            <p className="text-xs font-medium">Erros mais comuns</p>
            <ErrorList errors={health.send_intents.top_errors} />
          </div>
        </Section>

        <Section title="Automações" hint="Execuções dos fluxos por gatilho.">
          <div className="grid grid-cols-3 gap-2">
            <Stat label="Executando" value={health.automation_runs.running} />
            <Stat label="Aguardando" value={health.automation_runs.waiting} />
            <Stat label="Pendente" value={health.automation_runs.pending} />
            <Stat label="Falhas (24h)" value={health.automation_runs.failed_24h} tone="bad" />
            <Stat label="Travadas" value={health.automation_runs.stalled} tone="bad" />
          </div>
        </Section>

        <Section title="Inteligência artificial" hint="Respostas e indexação da base de conhecimento.">
          <div className="grid grid-cols-3 gap-2">
            <Stat label="Na fila" value={health.ai_jobs.pending} tone="warn" />
            <Stat label="Executando" value={health.ai_jobs.running} />
            <Stat label="Falhas (24h)" value={health.ai_jobs.failed_24h} tone="bad" />
            <Stat label="Travadas" value={health.ai_jobs.stuck} tone="bad" />
          </div>
        </Section>
      </div>

      {health.vip.length > 0 ? (
        <Section title="Respostas automáticas (VIP)" hint="Resposta pública e convite privado em comentários.">
          <ul className="space-y-2">
            {health.vip.map((v) => {
              const channel = health.channels.find((c) => c.id === v.channel_id);
              const problem = v.comments_error ?? v.last_error;
              return (
                <li key={v.channel_id} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                  <span className="font-medium">{channel?.name ?? "Canal"}</span>
                  <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                    {v.enabled ? "Ativado" : "Desativado"}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    Comentários verificados: {formatStamp(v.comments_verified_at, health.timezone)}
                  </span>
                  {problem ? (
                    <code className="rounded bg-destructive/10 px-1.5 py-0.5 text-xs text-destructive">{problem}</code>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </Section>
      ) : null}
    </div>
  );
}

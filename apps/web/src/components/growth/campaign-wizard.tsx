"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import {
  AlertCircleIcon,
  ArrowLeftIcon,
  ArrowRightIcon,
  CalendarIcon,
  CheckCircle2Icon,
  ExternalLinkIcon,
  EyeIcon,
  InfoIcon,
  Loader2Icon,
  MessageSquareIcon,
  SaveIcon,
  SendIcon,
  SparklesIcon,
  UsersIcon,
} from "lucide-react";
import { toast } from "sonner";
import type { AudienceFilter, OutreachMessage } from "@flowai/core";
import { previewCampaignAudience, saveCampaignDraft, scheduleCampaign } from "@/lib/growth/actions";
import { formatAudiencePreview, parseScheduleToUtc } from "@/lib/growth/campaign-schedule";
import type { CampaignDetails, CampaignFilterRefs } from "@/lib/growth/queries";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { OutreachMessageForm } from "./outreach-message-form";

type WizardStep = 1 | 2 | 3;

export function CampaignWizard({
  campaign,
  refs,
  canWrite,
}: {
  campaign: CampaignDetails;
  refs: CampaignFilterRefs;
  canWrite: boolean;
}) {
  const router = useRouter();
  const [currentStep, setCurrentStep] = useState<WizardStep>(1);
  const [name, setName] = useState(campaign.name);

  // Passo 1: Público
  const [channelIds, setChannelIds] = useState<string[]>(
    campaign.audience.channelIds?.length > 0
      ? campaign.audience.channelIds
      : [refs.channels[0]?.id ?? ""].filter(Boolean),
  );
  const [tagsAll, setTagsAll] = useState<string[]>(campaign.audience.tagsAll ?? []);
  const [tagsAny, setTagsAny] = useState<string[]>(campaign.audience.tagsAny ?? []);
  const [tagsNone, setTagsNone] = useState<string[]>(campaign.audience.tagsNone ?? []);
  const [stageIds, setStageIds] = useState<string[]>(campaign.audience.stageIds ?? []);
  const [entryLinkIds, setEntryLinkIds] = useState<string[]>(campaign.audience.entryLinkIds ?? []);
  const [minLeadScore, setMinLeadScore] = useState<number | null>(campaign.audience.minLeadScore ?? null);
  const [lastInteractionDays, setLastInteractionDays] = useState<number | null>(
    campaign.audience.lastInteractionDays ?? null,
  );

  // Passo 2: Mensagem
  const [message, setMessage] = useState<OutreachMessage>(campaign.message);

  // Passo 3: Envio
  const [sendMode, setSendMode] = useState<"now" | "schedule">("now");
  const [scheduleDate, setScheduleDate] = useState(() => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    return tomorrow.toISOString().slice(0, 10);
  });
  const [scheduleTime, setScheduleTime] = useState("09:00");

  const [saving, startSave] = useTransition();
  const [scheduling, startSchedule] = useTransition();

  const audiencePayload: AudienceFilter = {
    channelIds,
    tagsAll,
    tagsAny,
    tagsNone,
    stageIds,
    minLeadScore,
    lastInteractionDays,
    entryLinkIds,
  };

  // Contagem de público em tempo real via useQuery (sem efeitos colaterais síncronos)
  const previewQuery = useQuery({
    queryKey: ["campaign-preview", audiencePayload],
    queryFn: async () => {
      const res = await previewCampaignAudience(audiencePayload);
      if (!res.ok) throw new Error(res.error);
      return res.data;
    },
    enabled: channelIds.length > 0,
    staleTime: 5000,
  });

  const counts = previewQuery.data ?? null;
  const loadingPreview = previewQuery.isFetching;

  const handleSaveDraft = (silent = false) => {
    return new Promise<boolean>((resolve) => {
      startSave(async () => {
        const res = await saveCampaignDraft({
          id: campaign.id,
          name: name.trim() || campaign.name,
          audience: audiencePayload,
          message,
        });

        if (!res.ok) {
          toast.error(res.error);
          resolve(false);
          return;
        }

        if (!silent) toast.success("Rascunho salvo com sucesso.");
        resolve(true);
      });
    });
  };

  const handleScheduleOrSend = () => {
    if (!canWrite) return;
    if (channelIds.length === 0) {
      toast.error("Selecione ao menos um canal para o envio.");
      setCurrentStep(1);
      return;
    }
    if (!message.text.trim()) {
      toast.error("Escreva o texto da mensagem antes de enviar.");
      setCurrentStep(2);
      return;
    }

    let scheduledAt: string | null = null;
    if (sendMode === "schedule") {
      try {
        scheduledAt = parseScheduleToUtc(scheduleDate, scheduleTime);
        const scheduledTimeMs = new Date(scheduledAt).getTime();
        if (scheduledTimeMs <= Date.now()) {
          toast.error("O horário de agendamento deve ser no futuro.");
          return;
        }
      } catch {
        toast.error("Data ou horário de agendamento inválido.");
        return;
      }
    }

    startSchedule(async () => {
      // Primeiro garante que o rascunho mais recente está salvo
      const saved = await handleSaveDraft(true);
      if (!saved) return;

      const res = await scheduleCampaign({
        id: campaign.id,
        scheduledAt,
      });

      if (!res.ok) {
        toast.error(res.error);
        return;
      }

      toast.success(
        sendMode === "now"
          ? "Campanha iniciada com sucesso!"
          : "Campanha agendada com sucesso!",
      );
      router.push(`/automacoes/campanhas/${campaign.id}`);
      router.refresh();
    });
  };

  const toggleArrayItem = (list: string[], item: string, setter: (next: string[]) => void) => {
    if (list.includes(item)) {
      setter(list.filter((x) => x !== item));
    } else {
      setter([...list, item]);
    }
  };

  return (
    <div className="space-y-6">
      {/* Barra superior de navegação e salvamento */}
      <div className="flex flex-col gap-4 border-b pb-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <Link
            href="/automacoes/campanhas"
            aria-label="Voltar para campanhas"
            className={buttonVariants({ variant: "ghost", size: "icon" })}
          >
            <ArrowLeftIcon className="size-4" />
          </Link>
          <div>
            <div className="flex items-center gap-2">
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="h-8 w-64 font-semibold text-foreground md:w-80"
                placeholder="Nome da campanha"
                disabled={!canWrite}
              />
              <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs text-muted-foreground">
                Rascunho
              </span>
            </div>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Passo {currentStep} de 3 —{" "}
              {currentStep === 1
                ? "Filtro do público"
                : currentStep === 2
                  ? "Composição da mensagem"
                  : "Revisão e envio"}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {canWrite && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => handleSaveDraft()}
              disabled={saving}
              className="gap-1.5"
            >
              {saving ? (
                <Loader2Icon className="size-3.5 animate-spin" />
              ) : (
                <SaveIcon className="size-3.5" />
              )}
              Salvar rascunho
            </Button>
          )}
        </div>
      </div>

      {/* Indicador de passos */}
      <nav aria-label="Progresso do assistente" className="flex items-center justify-between gap-2">
        {[
          { step: 1 as WizardStep, title: "1. Público", icon: UsersIcon },
          { step: 2 as WizardStep, title: "2. Mensagem", icon: MessageSquareIcon },
          { step: 3 as WizardStep, title: "3. Envio", icon: SendIcon },
        ].map((item) => {
          const Icon = item.icon;
          const isActive = currentStep === item.step;
          const isDone = currentStep > item.step;
          return (
            <button
              key={item.step}
              type="button"
              onClick={() => setCurrentStep(item.step)}
              className={`flex flex-1 items-center justify-center gap-2 rounded-lg border py-2.5 text-xs font-medium transition-colors sm:text-sm ${
                isActive
                  ? "border-primary bg-primary/5 text-primary ring-1 ring-primary"
                  : isDone
                    ? "border-border bg-muted/30 text-foreground hover:bg-muted/60"
                    : "border-border/50 text-muted-foreground hover:bg-muted/30"
              }`}
            >
              {isDone ? (
                <CheckCircle2Icon className="size-4 text-emerald-600 dark:text-emerald-400" />
              ) : (
                <Icon className="size-4" />
              )}
              {item.title}
            </button>
          );
        })}
      </nav>

      {/* PASSO 1: PÚBLICO */}
      {currentStep === 1 && (
        <div className="grid gap-6 lg:grid-cols-3">
          <div className="space-y-6 lg:col-span-2">
            {/* Canais */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Canais de envio</CardTitle>
                <CardDescription>
                  Selecione por quais canais os contatos do público devem ser contatados.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {refs.channels.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Nenhum canal cadastrado.</p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {refs.channels.map((ch) => {
                      const selected = channelIds.includes(ch.id);
                      return (
                        <button
                          key={ch.id}
                          type="button"
                          onClick={() => toggleArrayItem(channelIds, ch.id, setChannelIds)}
                          className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
                            selected
                              ? "border-primary bg-primary/10 text-primary"
                              : "border-border bg-card text-muted-foreground hover:bg-muted/50"
                          }`}
                        >
                          <span
                            className={`size-2 rounded-full ${
                              ch.type === "instagram" ? "bg-pink-500" : "bg-blue-500"
                            }`}
                          />
                          {ch.name}
                          <span className="text-xs uppercase text-muted-foreground">
                            ({ch.type})
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
                {channelIds.length === 0 && (
                  <p className="text-xs font-medium text-destructive">
                    Escolha ao menos um canal para calcular o público.
                  </p>
                )}
              </CardContent>
            </Card>

            {/* Filtros de Etiquetas */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Etiquetas</CardTitle>
                <CardDescription>
                  Filtre contatos com base nas etiquetas atribuídas.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* tagsAll */}
                <div className="space-y-2">
                  <Label className="text-xs font-medium">Contatos que possuem TODAS estas etiquetas:</Label>
                  <div className="flex flex-wrap gap-1.5">
                    {refs.tags.map((t) => {
                      const sel = tagsAll.includes(t.id);
                      return (
                        <button
                          key={t.id}
                          type="button"
                          onClick={() => toggleArrayItem(tagsAll, t.id, setTagsAll)}
                          className={`rounded-md border px-2.5 py-1 text-xs transition-colors ${
                            sel
                              ? "border-primary bg-primary/10 text-primary font-medium"
                              : "border-border bg-muted/40 text-muted-foreground hover:bg-muted"
                          }`}
                        >
                          {t.name}
                        </button>
                      );
                    })}
                    {refs.tags.length === 0 && (
                      <p className="text-xs text-muted-foreground">Nenhuma etiqueta cadastrada.</p>
                    )}
                  </div>
                </div>

                {/* tagsAny */}
                <div className="space-y-2">
                  <Label className="text-xs font-medium">Contatos que possuem AO MENOS UMA destas etiquetas:</Label>
                  <div className="flex flex-wrap gap-1.5">
                    {refs.tags.map((t) => {
                      const sel = tagsAny.includes(t.id);
                      return (
                        <button
                          key={t.id}
                          type="button"
                          onClick={() => toggleArrayItem(tagsAny, t.id, setTagsAny)}
                          className={`rounded-md border px-2.5 py-1 text-xs transition-colors ${
                            sel
                              ? "border-primary bg-primary/10 text-primary font-medium"
                              : "border-border bg-muted/40 text-muted-foreground hover:bg-muted"
                          }`}
                        >
                          {t.name}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* tagsNone */}
                <div className="space-y-2">
                  <Label className="text-xs font-medium">Contatos que NÃO POSSUEM nenhuma destas etiquetas (exclusão):</Label>
                  <div className="flex flex-wrap gap-1.5">
                    {refs.tags.map((t) => {
                      const sel = tagsNone.includes(t.id);
                      return (
                        <button
                          key={t.id}
                          type="button"
                          onClick={() => toggleArrayItem(tagsNone, t.id, setTagsNone)}
                          className={`rounded-md border px-2.5 py-1 text-xs transition-colors ${
                            sel
                              ? "border-rose-500 bg-rose-500/10 text-rose-600 dark:text-rose-400 font-medium"
                              : "border-border bg-muted/40 text-muted-foreground hover:bg-muted"
                          }`}
                        >
                          {t.name}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Etapas do Funil e Links de Entrada */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Etapa e Origem</CardTitle>
                <CardDescription>
                  Refine por posição no funil de vendas ou pelo link de entrada utilizado.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Etapas */}
                <div className="space-y-2">
                  <Label className="text-xs font-medium">Etapas do Funil:</Label>
                  <div className="flex flex-wrap gap-1.5">
                    {refs.stages.map((s) => {
                      const sel = stageIds.includes(s.id);
                      return (
                        <button
                          key={s.id}
                          type="button"
                          onClick={() => toggleArrayItem(stageIds, s.id, setStageIds)}
                          className={`rounded-md border px-2.5 py-1 text-xs transition-colors ${
                            sel
                              ? "border-primary bg-primary/10 text-primary font-medium"
                              : "border-border bg-muted/40 text-muted-foreground hover:bg-muted"
                          }`}
                        >
                          {s.name}
                        </button>
                      );
                    })}
                    {refs.stages.length === 0 && (
                      <p className="text-xs text-muted-foreground">Nenhuma etapa configurada.</p>
                    )}
                  </div>
                </div>

                {/* Links de Entrada */}
                <div className="space-y-2">
                  <Label className="text-xs font-medium">Vindos por Links de Entrada:</Label>
                  <div className="flex flex-wrap gap-1.5">
                    {refs.entryLinks.map((l) => {
                      const sel = entryLinkIds.includes(l.id);
                      return (
                        <button
                          key={l.id}
                          type="button"
                          onClick={() => toggleArrayItem(entryLinkIds, l.id, setEntryLinkIds)}
                          className={`rounded-md border px-2.5 py-1 text-xs transition-colors ${
                            sel
                              ? "border-primary bg-primary/10 text-primary font-medium"
                              : "border-border bg-muted/40 text-muted-foreground hover:bg-muted"
                          }`}
                        >
                          {l.name}
                        </button>
                      );
                    })}
                    {refs.entryLinks.length === 0 && (
                      <p className="text-xs text-muted-foreground">Nenhum link de entrada criado.</p>
                    )}
                  </div>
                </div>

                {/* Filtros numéricos */}
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="min-lead-score" className="text-xs font-medium">
                      Pontuação de lead mínima (0 a 100)
                    </Label>
                    <Input
                      id="min-lead-score"
                      type="number"
                      min={0}
                      max={100}
                      value={minLeadScore ?? ""}
                      onChange={(e) =>
                        setMinLeadScore(e.target.value === "" ? null : Number(e.target.value))
                      }
                      placeholder="Ex: 50"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="last-interaction" className="text-xs font-medium">
                      Última interação há no máximo (dias)
                    </Label>
                    <Input
                      id="last-interaction"
                      type="number"
                      min={1}
                      max={365}
                      value={lastInteractionDays ?? ""}
                      onChange={(e) =>
                        setLastInteractionDays(
                          e.target.value === "" ? null : Number(e.target.value),
                        )
                      }
                      placeholder="Ex: 7"
                    />
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Card Lateral de Prévia do Público */}
          <div className="space-y-4">
            <Card className="sticky top-6 border-primary/20 bg-primary/5">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="flex items-center gap-2 text-base text-primary">
                    <UsersIcon className="size-4" />
                    Prévia do público
                  </CardTitle>
                  {loadingPreview && <Loader2Icon className="size-4 animate-spin text-primary" />}
                </div>
                <CardDescription className="text-xs">
                  Estimativa calculada em tempo real com base nos filtros selecionados.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {counts ? (
                  <>
                    <div className="space-y-2">
                      <div className="text-2xl font-bold tracking-tight text-foreground">
                        {counts.inWindow} contatos
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {formatAudiencePreview(counts)}
                      </p>
                    </div>

                    <div className="rounded-lg border bg-card p-3 space-y-2 text-xs">
                      <div className="flex items-center justify-between">
                        <span className="text-muted-foreground">No público total:</span>
                        <span className="font-semibold">{counts.total}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-emerald-600 dark:text-emerald-400 font-medium">
                          Dentro da janela de 24h:
                        </span>
                        <span className="font-semibold text-emerald-600 dark:text-emerald-400">
                          {counts.inWindow}
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-amber-600 dark:text-amber-400 font-medium">
                          Fora da janela de 24h:
                        </span>
                        <span className="font-semibold text-amber-600 dark:text-amber-400">
                          {counts.outOfWindow}
                        </span>
                      </div>
                    </div>

                    {counts.outOfWindow > 0 && (
                      <div className="flex gap-2 rounded-lg border border-amber-500/20 bg-amber-500/10 p-2.5 text-xs text-amber-800 dark:text-amber-300">
                        <AlertCircleIcon className="size-4 shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" />
                        <span>
                          {counts.outOfWindow} contatos não interagiram nas últimas 24 horas e
                          ficarão de fora do envio para evitar bloqueios da Meta.
                        </span>
                      </div>
                    )}
                  </>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    Selecione ao menos um canal para calcular a estimativa de público.
                  </p>
                )}

                <Button
                  onClick={() => setCurrentStep(2)}
                  disabled={!counts || counts.total === 0}
                  className="w-full gap-2 mt-2"
                >
                  Continuar para Mensagem
                  <ArrowRightIcon className="size-4" />
                </Button>
              </CardContent>
            </Card>
          </div>
        </div>
      )}

      {/* PASSO 2: MENSAGEM */}
      {currentStep === 2 && (
        <div className="grid gap-6 lg:grid-cols-2">
          {/* Formulário de Mensagem */}
          <div className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Conteúdo da mensagem</CardTitle>
                <CardDescription>
                  Configure o texto, botões de ação ou respostas rápidas para engajar o contato.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <OutreachMessageForm
                  value={message}
                  onChange={setMessage}
                  activeAutomations={refs.automations}
                  disabled={!canWrite}
                />
              </CardContent>
            </Card>

            <div className="flex justify-between">
              <Button variant="outline" onClick={() => setCurrentStep(1)} className="gap-2">
                <ArrowLeftIcon className="size-4" />
                Voltar para Público
              </Button>
              <Button
                onClick={() => setCurrentStep(3)}
                disabled={!message.text.trim()}
                className="gap-2"
              >
                Continuar para Envio
                <ArrowRightIcon className="size-4" />
              </Button>
            </div>
          </div>

          {/* Prévia do Balão de Conversa (Mockup estilo Chat) */}
          <div className="space-y-4">
            <Card className="sticky top-6">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <EyeIcon className="size-4" />
                  Prévia da mensagem
                </CardTitle>
                <CardDescription className="text-xs">
                  Como a mensagem será visualizada pelo contato no dispositivo.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col items-center justify-center p-6 bg-muted/20 rounded-b-xl min-h-[320px]">
                {/* Mockup do balão */}
                <div className="w-full max-w-sm space-y-2">
                  <div className="rounded-2xl rounded-tl-xs bg-card border shadow-sm p-3.5 space-y-2 text-sm text-card-foreground">
                    <p className="whitespace-pre-wrap break-words">
                      {message.text || "Escreva a mensagem no formulário ao lado..."}
                    </p>
                    <div className="flex justify-end text-[10px] text-muted-foreground">
                      Agora
                    </div>
                  </div>

                  {/* Botões anexos */}
                  {message.buttons && message.buttons.length > 0 && (
                    <div className="space-y-1">
                      {message.buttons.map((b) => (
                        <div
                          key={b.id}
                          className="flex items-center justify-center gap-2 rounded-xl border bg-card/90 py-2 text-xs font-medium text-primary shadow-xs transition-colors"
                        >
                          {b.kind === "url" ? (
                            <ExternalLinkIcon className="size-3" />
                          ) : (
                            <SparklesIcon className="size-3" />
                          )}
                          {b.title}
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Respostas rápidas em pílulas */}
                  {message.quickReplies && message.quickReplies.length > 0 && (
                    <div className="flex flex-wrap justify-end gap-1.5 pt-1">
                      {message.quickReplies.map((q) => (
                        <div
                          key={q.id}
                          className="rounded-full border border-primary/40 bg-primary/10 px-3 py-1 text-xs font-medium text-primary shadow-xs"
                        >
                          {q.title}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      )}

      {/* PASSO 3: ENVIO E CONFIRMAÇÃO */}
      {currentStep === 3 && (
        <div className="max-w-2xl mx-auto space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Agendamento do envio</CardTitle>
              <CardDescription>
                Escolha se a campanha será disparada agora ou agendada para uma data futura.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Opções de envio */}
              <div className="grid gap-3 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={() => setSendMode("now")}
                  className={`flex flex-col items-start rounded-xl border p-4 text-left transition-colors ${
                    sendMode === "now"
                      ? "border-primary bg-primary/5 ring-1 ring-primary"
                      : "border-border hover:bg-muted/40"
                  }`}
                >
                  <div className="flex items-center gap-2 font-medium text-sm">
                    <SendIcon className="size-4 text-primary" />
                    Enviar agora
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Inicia a entrega imediatamente após a confirmação.
                  </p>
                </button>

                <button
                  type="button"
                  onClick={() => setSendMode("schedule")}
                  className={`flex flex-col items-start rounded-xl border p-4 text-left transition-colors ${
                    sendMode === "schedule"
                      ? "border-primary bg-primary/5 ring-1 ring-primary"
                      : "border-border hover:bg-muted/40"
                  }`}
                >
                  <div className="flex items-center gap-2 font-medium text-sm">
                    <CalendarIcon className="size-4 text-primary" />
                    Agendar envio
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Define uma data e horário específicos para disparo.
                  </p>
                </button>
              </div>

              {/* Campos de data e hora se agendado */}
              {sendMode === "schedule" && (
                <div className="grid gap-4 sm:grid-cols-2 rounded-xl border bg-muted/20 p-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="schedule-date" className="text-xs font-medium">
                      Data do envio
                    </Label>
                    <Input
                      id="schedule-date"
                      type="date"
                      value={scheduleDate}
                      onChange={(e) => setScheduleDate(e.target.value)}
                      required
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="schedule-time" className="text-xs font-medium">
                      Horário (Brasília / Horário Local)
                    </Label>
                    <Input
                      id="schedule-time"
                      type="time"
                      value={scheduleTime}
                      onChange={(e) => setScheduleTime(e.target.value)}
                      required
                    />
                  </div>
                </div>
              )}

              {/* Resumo e Confirmação */}
              <div className="rounded-xl border bg-muted/40 p-4 space-y-3 text-sm">
                <div className="font-medium text-foreground">Resumo do disparo</div>
                <div className="space-y-1.5 text-xs text-muted-foreground">
                  <div className="flex justify-between">
                    <span>Nome da campanha:</span>
                    <span className="font-semibold text-foreground">{name}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Contatos estimados no público:</span>
                    <span className="font-semibold text-foreground">
                      {counts?.total ?? "—"} contatos
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span>Aptos dentro da janela de 24h:</span>
                    <span className="font-semibold text-emerald-600 dark:text-emerald-400">
                      {counts?.inWindow ?? "—"} contatos
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span>Disparo previsto:</span>
                    <span className="font-semibold text-foreground">
                      {sendMode === "now"
                        ? "Imediato"
                        : `${scheduleDate.split("-").reverse().join("/")} às ${scheduleTime}`}
                    </span>
                  </div>
                </div>
              </div>

              {/* Confirmação com destaque */}
              <div className="flex items-start gap-3 rounded-xl border border-primary/20 bg-primary/5 p-4 text-sm text-foreground">
                <InfoIcon className="size-5 shrink-0 text-primary mt-0.5" />
                <div>
                  <p className="font-medium">
                    Enviar campanha para {counts?.inWindow ?? 0} contatos?
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    O sistema respeitará automaticamente o ritmo de envio e o limite de entregas da
                    Meta para proteger sua conta.
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          <div className="flex justify-between">
            <Button variant="outline" onClick={() => setCurrentStep(2)} className="gap-2">
              <ArrowLeftIcon className="size-4" />
              Voltar para Mensagem
            </Button>

            {canWrite && (
              <Button
                onClick={handleScheduleOrSend}
                disabled={scheduling || saving || (counts?.inWindow ?? 0) === 0}
                className="gap-2"
              >
                {scheduling ? (
                  <Loader2Icon className="size-4 animate-spin" />
                ) : sendMode === "now" ? (
                  <SendIcon className="size-4" />
                ) : (
                  <CalendarIcon className="size-4" />
                )}
                {sendMode === "now" ? "Confirmar e enviar agora" : "Confirmar agendamento"}
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

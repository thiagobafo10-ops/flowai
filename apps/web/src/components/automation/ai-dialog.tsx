"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangleIcon,
  BotIcon,
  CheckIcon,
  CornerDownLeftIcon,
  Loader2Icon,
  RotateCcwIcon,
  SparklesIcon,
  ZapIcon,
} from "lucide-react";
import { toast } from "sonner";
import type { AutomationGraph, SanitizedAiGraphResult } from "@flowai/core";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { AUTOMATION_TRIGGER_LABEL } from "@/lib/automation/messages";
import type { EditorRefs } from "@/lib/automation/queries";
import { generateAutomationWithAi } from "@/lib/automation/ai-actions";
import { createAutomationFromGraph } from "@/lib/automation/actions";
import { AutomationAiPreviewCanvas } from "./ai-preview-canvas";
import { cn } from "@/lib/utils";

const PROMPT_SUGGESTIONS = [
  {
    label: "Qualificação VIP",
    prompt: "Quando o contato mandar a primeira mensagem, verifique se ele possui a etiqueta VIP. Se tiver, envie uma saudação personalizada e transfira imediatamente para um atendente humano.",
  },
  {
    label: "Follow-up de Vendas",
    prompt: "Ao receber mensagem contendo 'orçamento', envie nossa mensagem com opções de atendimento, aguarde 2 horas e, se não responder, inscreva o contato na sequência de nutrição.",
  },
  {
    label: "Captura de Comentário",
    prompt: "Quando alguém comentar uma publicação no Instagram, envie o link de entrada no Direct e aguarde a resposta para mover a etapa do funil.",
  },
  {
    label: "Fora do Horário",
    prompt: "Verifique o horário comercial. Se estiver fechado, envie mensagem informando nosso expediente e encerre a conversa.",
  },
];

export type AutomationAiDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode?: "create" | "refine";
  currentGraph?: AutomationGraph;
  onApply?: (result: SanitizedAiGraphResult) => void;
  refs?: EditorRefs;
};

export function AutomationAiDialog({
  open,
  onOpenChange,
  mode = "create",
  currentGraph,
  onApply,
  refs,
}: AutomationAiDialogProps) {
  const router = useRouter();
  const [prompt, setPrompt] = useState("");
  const [refinePrompt, setRefinePrompt] = useState("");
  const [result, setResult] = useState<SanitizedAiGraphResult | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isApplying, startApplyTransition] = useTransition();

  const handleClose = () => {
    onOpenChange(false);
  };

  const handleGenerate = async (targetPrompt: string) => {
    if (!targetPrompt.trim() || targetPrompt.trim().length < 3) {
      toast.error("Descreva o fluxo com pelo menos 3 caracteres.");
      return;
    }

    setIsGenerating(true);
    try {
      const response = await generateAutomationWithAi({
        prompt: targetPrompt,
        currentGraph: result?.graph ?? currentGraph,
      });

      if (!response.ok) {
        toast.error(response.error);
        return;
      }

      setResult(response.data);
      setRefinePrompt("");
      toast.success("Fluxo gerado com sucesso!");
    } catch {
      toast.error("Ocorreu um erro ao comunicar com a IA.");
    } finally {
      setIsGenerating(false);
    }
  };

  const handleAccept = () => {
    if (!result) return;

    if (mode === "refine") {
      onApply?.(result);
      toast.success("Sugestão da IA aplicada ao fluxo!");
      handleClose();
      return;
    }

    startApplyTransition(async () => {
      const saveRes = await createAutomationFromGraph({
        name: result.name,
        triggerType: result.triggerType,
        triggerConfig: result.triggerConfig,
        graph: result.graph,
      });

      if (!saveRes.ok) {
        toast.error(saveRes.error);
        return;
      }

      toast.success("Automação criada com sucesso!");
      handleClose();
      router.push(`/automacoes/${saveRes.data.id}`);
    });
  };

  const handleReset = () => {
    setResult(null);
    setRefinePrompt("");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={cn("max-w-2xl transition-all", result ? "max-w-3xl" : "max-w-xl")}>
        <DialogHeader>
          <div className="flex items-center gap-2">
            <div className="flex size-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <SparklesIcon className="size-4" />
            </div>
            <div>
              <DialogTitle>
                {mode === "refine" ? "Ajustar fluxo com IA" : "Criar automação com IA"}
              </DialogTitle>
              <DialogDescription>
                {mode === "refine"
                  ? "Diga o que deseja alterar ou adicionar ao fluxo atual."
                  : "Descreva seu objetivo em linguagem natural. A IA estruturará todos os nós e caminhos."}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {!result ? (
          <div className="flex flex-col gap-4 py-2">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="ai-prompt" className="text-xs font-medium text-muted-foreground">
                O que este fluxo deve fazer?
              </label>
              <textarea
                id="ai-prompt"
                rows={4}
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="Ex: Quando o cliente mandar primeira mensagem, responder dando as boas-vindas, aguardar 1 hora e se não responder adicionar a tag Interessado..."
                disabled={isGenerating}
                className="w-full resize-none rounded-lg border border-input bg-transparent p-3 text-sm transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50"
              />
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>Dica: mencione esperas, condições e ações de etiquetas.</span>
                <span>{prompt.length}/1000</span>
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <span className="text-xs font-medium text-muted-foreground">Exemplos rápidos:</span>
              <div className="flex flex-wrap gap-2">
                {PROMPT_SUGGESTIONS.map((item) => (
                  <button
                    key={item.label}
                    type="button"
                    onClick={() => {
                      setPrompt(item.prompt);
                    }}
                    className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted/40 px-3 py-1 text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:bg-primary/5 hover:text-foreground"
                  >
                    <span>{item.label}</span>
                  </button>
                ))}
              </div>
            </div>

            <DialogFooter className="mt-4 gap-2">
              <Button variant="outline" onClick={handleClose} disabled={isGenerating}>
                Cancelar
              </Button>
              <Button
                onClick={() => handleGenerate(prompt)}
                disabled={isGenerating || prompt.trim().length < 3}
                className="gap-2"
              >
                {isGenerating ? (
                  <>
                    <Loader2Icon className="size-4 animate-spin" />
                    <span>Construindo automação...</span>
                  </>
                ) : (
                  <>
                    <SparklesIcon className="size-4" />
                    <span>Gerar fluxo</span>
                  </>
                )}
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <div className="flex flex-col gap-4 py-2">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b pb-3">
              <div className="flex items-center gap-2">
                <span className="font-semibold text-foreground">{result.name}</span>
                <span className="inline-flex items-center gap-1 rounded-md bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                  <ZapIcon className="size-3" />
                  {AUTOMATION_TRIGGER_LABEL[result.triggerType] ?? result.triggerType}
                </span>
              </div>
              <Button variant="ghost" size="sm" onClick={handleReset} className="h-7 text-xs">
                <RotateCcwIcon className="mr-1.5 size-3" />
                Começar de novo
              </Button>
            </div>

            <div className="flex items-start gap-2.5 rounded-lg border border-primary/20 bg-primary/5 p-3 text-xs text-foreground">
              <BotIcon className="mt-0.5 size-4 shrink-0 text-primary" />
              <p className="leading-relaxed">{result.explanation}</p>
            </div>

            <div className="h-[280px] w-full">
              <AutomationAiPreviewCanvas
                graph={result.graph}
                triggerType={result.triggerType}
                triggerConfig={result.triggerConfig}
                issues={result.issues}
                refs={refs}
              />
            </div>

            {result.issues.length > 0 && (
              <div className="flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
                <AlertTriangleIcon className="size-4 shrink-0" />
                <span>
                  {result.issues.length === 1
                    ? "Existe 1 ponto para revisar no editor antes de ativar."
                    : `Existem ${result.issues.length} pontos para revisar no editor antes de ativar.`}
                </span>
              </div>
            )}

            <div className="flex flex-col gap-1.5 rounded-lg border bg-muted/30 p-2.5">
              <label htmlFor="refine-prompt" className="text-xs font-medium text-muted-foreground">
                Quer ajustar algo neste fluxo?
              </label>
              <div className="flex gap-2">
                <input
                  id="refine-prompt"
                  type="text"
                  value={refinePrompt}
                  onChange={(e) => setRefinePrompt(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      if (refinePrompt.trim()) handleGenerate(refinePrompt);
                    }
                  }}
                  placeholder="Ex: Troque a mensagem de espera por 30 minutos..."
                  disabled={isGenerating}
                  className="flex-1 rounded-md border border-input bg-background px-3 py-1.5 text-xs outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50"
                />
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => handleGenerate(refinePrompt)}
                  disabled={isGenerating || !refinePrompt.trim()}
                  className="h-8 gap-1 text-xs"
                >
                  {isGenerating ? (
                    <Loader2Icon className="size-3.5 animate-spin" />
                  ) : (
                    <CornerDownLeftIcon className="size-3.5" />
                  )}
                  <span>Ajustar</span>
                </Button>
              </div>
            </div>

            <DialogFooter className="mt-2 gap-2">
              <Button variant="outline" onClick={handleClose} disabled={isApplying}>
                Fechar
              </Button>
              <Button onClick={handleAccept} disabled={isApplying} className="gap-2">
                {isApplying ? (
                  <>
                    <Loader2Icon className="size-4 animate-spin" />
                    <span>Salvando fluxo...</span>
                  </>
                ) : (
                  <>
                    <CheckIcon className="size-4" />
                    <span>{mode === "refine" ? "Aplicar ao fluxo" : "Abrir no editor"}</span>
                  </>
                )}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

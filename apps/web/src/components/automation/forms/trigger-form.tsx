"use client";

import { TRIGGER_TYPES, triggerConfigSchemas, type TriggerType } from "@flowai/core";
import type { EditorRefs } from "@/lib/automation/queries";
import { AUTOMATION_TRIGGER_LABEL } from "@/lib/automation/messages";
import { Input } from "@/components/ui/input";
import { defaultTriggerConfig } from "@/lib/automation/node-labels";
import { Field, KeywordModeOptions, KeywordsField, RefOptions, errorAt, invalidProps, selectClass, useLiveForm } from "./fields";
import { triggerToConfig, triggerToValues, type TriggerValues } from "./mappings";

import { InstagramMediaPicker } from "./instagram-media-picker";
import { CircleCheckIcon, FilterIcon, SparklesIcon } from "lucide-react";

type Props = {
  triggerType: TriggerType;
  triggerConfig: unknown;
  refs: EditorRefs;
  onChange: (type: TriggerType, config: unknown) => void;
};

/** Tipo do gatilho + campos do tipo; trocar o tipo recomeça a configuração. */
export function TriggerForm({ triggerType, triggerConfig, refs, onChange }: Props) {
  const instagram = refs.channels.filter((c) => c.type === "instagram");
  return (
    <div className="space-y-3">
      <Field id="trigger-type" label="Quando">
        <select
          id="trigger-type"
          className={selectClass}
          value={triggerType}
          onChange={(e) => {
            const type = e.target.value as TriggerType;
            onChange(type, defaultTriggerConfig(type, instagram[0]?.id ?? null));
          }}
        >
          {TRIGGER_TYPES.map((t) => <option key={t} value={t}>{AUTOMATION_TRIGGER_LABEL[t] ?? t}</option>)}
        </select>
      </Field>
      <TriggerFields key={triggerType} type={triggerType} config={triggerConfig} channels={instagram} refs={refs} onChange={(c) => onChange(triggerType, c)} />
    </div>
  );
}

function TriggerFields({ type, config, channels, refs, onChange }: {
  type: TriggerType;
  config: unknown;
  channels: EditorRefs["channels"];
  refs: EditorRefs;
  onChange: (config: unknown) => void;
}) {
  const { register, control, watch, setValue, formState: { errors } } = useLiveForm<TriggerValues>(
    triggerConfigSchemas[type],
    triggerToValues(config),
    (v) => triggerToConfig(type, v),
    onChange
  );
  const err = (path: string) => errorAt(errors, path);
  const anyKeyword = watch("anyKeyword");
  const isComment = type === "instagram_comment";

  const keywordSection = (
    <div className="space-y-3 pt-1">
      <div>
        <label className="text-sm font-medium leading-none">
          {isComment ? "Critério de comentário" : "Palavras-chave"}
        </label>
        <p className="text-xs text-muted-foreground mt-1">
          {isComment
            ? "Escolha se a automação responde a qualquer comentário ou apenas com palavras específicas."
            : "Defina quando o gatilho deve ser acionado na conversa."}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2 p-1 bg-muted/40 rounded-lg border border-border/50 text-xs font-medium">
        <button
          type="button"
          onClick={() => {
            setValue("anyKeyword", true, { shouldValidate: true });
            setValue("mode", "any", { shouldValidate: true });
          }}
          className={`flex items-center justify-center gap-1.5 py-1.5 px-3 rounded-md transition-all cursor-pointer ${
            anyKeyword
              ? "bg-background text-foreground shadow-sm border border-border/80 font-semibold"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <SparklesIcon className="size-3.5 text-primary" />
          <span>{isComment ? "Qualquer comentário" : "Qualquer palavra"}</span>
        </button>
        <button
          type="button"
          onClick={() => {
            setValue("anyKeyword", false, { shouldValidate: true });
            setValue("mode", "contains", { shouldValidate: true });
          }}
          className={`flex items-center justify-center gap-1.5 py-1.5 px-3 rounded-md transition-all cursor-pointer ${
            !anyKeyword
              ? "bg-background text-foreground shadow-sm border border-border/80 font-semibold"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <FilterIcon className="size-3.5" />
          <span>Palavras específicas</span>
        </button>
      </div>

      {anyKeyword ? (
        <div className="p-3 bg-primary/5 border border-primary/20 rounded-lg text-xs text-foreground/90 flex items-start gap-2.5">
          <CircleCheckIcon className="size-4 shrink-0 text-primary mt-0.5" />
          <div className="space-y-0.5">
            <p className="font-semibold text-foreground">
              {isComment ? "Qualquer comentário acionará o fluxo" : "Qualquer mensagem acionará o fluxo"}
            </p>
            <p className="text-[11px] text-muted-foreground">
              {isComment
                ? "Não é necessário definir palavras-chave. Qualquer pessoa que comentar na publicação ativará esta automação."
                : "A automação responderá a qualquer texto enviado pelo contato."}
            </p>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <KeywordsField id="trigger-keywords" control={control} name="keywords" error={errorAt(errors, "keywords", true)} />
          <Field id="trigger-mode" label="Comparação">
            <select id="trigger-mode" className={selectClass} {...register("mode")}>
              <KeywordModeOptions />
            </select>
          </Field>
        </div>
      )}
    </div>
  );

  const channelField = (
    <Field id="trigger-channel" label="Conta do Instagram" error={err("channelId")} hint={channels.length === 0 ? "Conecte uma conta do Instagram em Canais." : undefined}>
      <select id="trigger-channel" className={selectClass} {...invalidProps("trigger-channel", err("channelId"))} {...register("channelId")}>
        <RefOptions options={channels} empty="Escolha a conta" />
      </select>
    </Field>
  );

  switch (type) {
    case "message_received":
      return (
        <label htmlFor="trigger-first" className="flex items-center gap-2 text-sm">
          <input id="trigger-first" type="checkbox" role="switch" className="size-4" {...register("firstMessageOnly")} />
          Somente na primeira mensagem do contato
        </label>
      );
    case "keyword_detected":
      return <div className="space-y-3">{keywordSection}</div>;
    case "instagram_comment":
      return (
        <div className="space-y-4">
          {channelField}
          <InstagramMediaPicker
            channelId={watch("channelId")}
            value={watch("mediaId")}
            onChange={(mediaId) => setValue("mediaId", mediaId, { shouldValidate: true })}
            error={err("mediaId")}
          />
          <div className="pt-1">
            <label htmlFor="trigger-once-per-user" className="flex items-center gap-2 text-sm font-medium cursor-pointer">
              <input id="trigger-once-per-user" type="checkbox" role="switch" className="size-4" {...register("oncePerUser")} />
              <span>Responder apenas uma vez por pessoa</span>
            </label>
            <p className="text-xs text-muted-foreground mt-1 ml-6">
              Evita enviar mensagens repetidas caso a mesma pessoa comente mais de uma vez na publicação.
            </p>
          </div>
          {keywordSection}
        </div>
      );
    case "instagram_story":
      return channelField;
    case "entry_link":
      return (
        <Field id="trigger-links" label="Links de entrada" error={err("linkIds")} hint="Selecione um ou mais links. Use Ctrl ou Command para selecionar vários.">
          <select id="trigger-links" multiple className={`${selectClass} h-32`} {...invalidProps("trigger-links", err("linkIds"))} {...register("linkIds")}>
            {refs.entryLinks.map((link) => <option key={link.id} value={link.id}>{link.name}</option>)}
          </select>
        </Field>
      );
    case "contact_created":
      return <p className="text-sm text-muted-foreground">Começa quando um contato novo é criado.</p>;
    case "tag_added":
      return (
        <Field id="trigger-tag" label="Etiqueta" error={err("tagId")}>
          <select id="trigger-tag" className={selectClass} {...register("tagId")}>
            <RefOptions options={refs.tags} empty="Qualquer etiqueta" />
          </select>
        </Field>
      );
    case "stage_changed":
      return (
        <Field id="trigger-stage" label="Nova etapa" error={err("stageId")}>
          <select id="trigger-stage" className={selectClass} {...register("stageId")}>
            <RefOptions options={refs.stages} empty="Qualquer etapa" />
          </select>
        </Field>
      );
  }
}

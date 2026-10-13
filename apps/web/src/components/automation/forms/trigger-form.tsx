"use client";

import { TRIGGER_TYPES, triggerConfigSchemas, type TriggerType } from "@flowai/core";
import type { EditorRefs } from "@/lib/automation/queries";
import { AUTOMATION_TRIGGER_LABEL } from "@/lib/automation/messages";
import { Input } from "@/components/ui/input";
import { defaultTriggerConfig } from "../nodes/labels";
import {
  Field, KeywordModeOptions, KeywordsField, RefOptions, cleanKeywords, errorAt, invalidProps, rec, selectClass, str, useLiveForm,
} from "./fields";

type V = { firstMessageOnly: boolean; keywords: string[]; mode: string; channelId: string; mediaId: string; tagId: string; stageId: string };

function toValues(config: unknown): V {
  const c = rec(config);
  return {
    firstMessageOnly: c.firstMessageOnly === true,
    keywords: Array.isArray(c.keywords) ? (c.keywords as string[]) : [],
    mode: str(c.mode, "contains"),
    channelId: str(c.channelId),
    mediaId: str(c.mediaId),
    tagId: str(c.tagId),
    stageId: str(c.stageId),
  };
}

function toConfig(type: TriggerType, v: V): unknown {
  switch (type) {
    case "message_received":
      return { firstMessageOnly: !!v.firstMessageOnly };
    case "keyword_detected":
      return { keywords: cleanKeywords(v.keywords), mode: v.mode };
    case "instagram_comment":
      return { channelId: v.channelId, mediaId: v.mediaId?.trim() || null, keywords: cleanKeywords(v.keywords), mode: v.mode };
    case "instagram_story":
      return { channelId: v.channelId };
    case "contact_created":
      return {};
    case "tag_added":
      return { tagId: v.tagId || null };
    case "stage_changed":
      return { stageId: v.stageId || null };
  }
}

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
  const { register, control, formState: { errors } } = useLiveForm<V>(triggerConfigSchemas[type], toValues(config), (v) => toConfig(type, v), onChange);
  const err = (path: string) => errorAt(errors, path);
  const keywordFields = (
    <>
      <KeywordsField id="trigger-keywords" control={control} name="keywords" error={errorAt(errors, "keywords", true)} />
      <Field id="trigger-mode" label="Comparação">
        <select id="trigger-mode" className={selectClass} {...register("mode")}><KeywordModeOptions /></select>
      </Field>
    </>
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
      return <div className="space-y-3">{keywordFields}</div>;
    case "instagram_comment":
      return (
        <div className="space-y-3">
          {channelField}
          <Field id="trigger-media" label="ID da publicação (opcional)" hint="Em branco, vale para qualquer publicação." error={err("mediaId")}>
            <Input id="trigger-media" autoComplete="off" {...register("mediaId")} />
          </Field>
          {keywordFields}
        </div>
      );
    case "instagram_story":
      return channelField;
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

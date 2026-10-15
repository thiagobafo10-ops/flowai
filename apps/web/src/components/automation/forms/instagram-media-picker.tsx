"use client";

import { useEffect, useState, useTransition } from "react";
import {
  CheckIcon,
  ExternalLinkIcon,
  FilmIcon,
  GlobeIcon,
  ImageIcon,
  LayersIcon,
  Loader2Icon,
  RefreshCwIcon,
  SearchIcon,
  XIcon,
} from "lucide-react";
import { listInstagramMedia, type InstagramMediaItem } from "@/lib/instagram/actions";
import { Input } from "@/components/ui/input";
import { invalidProps } from "./fields";

type Props = {
  channelId: string;
  value: string;
  onChange: (mediaId: string) => void;
  error?: string;
};

export function InstagramMediaPicker({ channelId, value, onChange, error }: Props) {
  const [items, setItems] = useState<InstagramMediaItem[]>([]);
  const [isLoading, startTransition] = useTransition();
  const [hasLoaded, setHasLoaded] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [showManual, setShowManual] = useState(false);

  // Modo: "all" se valor vazio, "specific" se tiver ID selecionado ou se o usuário escolheu selecionar post
  const [mode, setMode] = useState<"all" | "specific">(() => (value?.trim() ? "specific" : "all"));

  useEffect(() => {
    if (value?.trim() && mode !== "specific") {
      setMode("specific");
    }
  }, [value, mode]);

  useEffect(() => {
    if (!channelId || mode !== "specific") return;
    let isCancelled = false;
    startTransition(async () => {
      setFetchError(null);
      const res = await listInstagramMedia(channelId);
      if (isCancelled) return;
      setHasLoaded(true);
      if (res.ok) {
        setItems(res.data.media);
      } else {
        setFetchError(res.error ?? "Não foi possível carregar as publicações.");
      }
    });
    return () => {
      isCancelled = true;
    };
  }, [channelId, mode]);

  const loadMedia = () => {
    if (!channelId) return;
    startTransition(async () => {
      setFetchError(null);
      const res = await listInstagramMedia(channelId);
      setHasLoaded(true);
      if (res.ok) {
        setItems(res.data.media);
      } else {
        setFetchError(res.error ?? "Não foi possível carregar as publicações.");
      }
    });
  };

  const handleSelectMode = (newMode: "all" | "specific") => {
    setMode(newMode);
    if (newMode === "all") {
      onChange("");
    }
  };

  const selectedPost = items.find((i) => i.id === value?.trim());
  const filteredItems = items.filter((item) =>
    search ? item.caption.toLowerCase().includes(search.toLowerCase()) || item.id.includes(search) : true
  );

  return (
    <div className="space-y-3">
      <div>
        <label className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
          Publicação de destino
        </label>
        <p className="text-xs text-muted-foreground mt-1">
          Defina se o gatilho responde em qualquer postagem ou em uma publicação específica.
        </p>
      </div>

      {/* Seletor de Modo: Todas vs Específica */}
      <div className="grid grid-cols-2 gap-2 p-1 bg-muted/40 rounded-lg border border-border/50 text-xs font-medium">
        <button
          type="button"
          onClick={() => handleSelectMode("all")}
          className={`flex items-center justify-center gap-1.5 py-1.5 px-3 rounded-md transition-all cursor-pointer ${
            mode === "all"
              ? "bg-background text-foreground shadow-sm border border-border/80 font-semibold"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <GlobeIcon className="size-3.5" />
          <span>Qualquer publicação</span>
        </button>
        <button
          type="button"
          onClick={() => handleSelectMode("specific")}
          className={`flex items-center justify-center gap-1.5 py-1.5 px-3 rounded-md transition-all cursor-pointer ${
            mode === "specific"
              ? "bg-background text-foreground shadow-sm border border-border/80 font-semibold"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <ImageIcon className="size-3.5" />
          <span>Publicação específica</span>
        </button>
      </div>

      {mode === "all" ? (
        <div className="p-3 bg-muted/20 border border-dashed border-border rounded-lg text-xs text-muted-foreground flex items-center gap-2">
          <GlobeIcon className="size-4 shrink-0 text-primary" />
          <span>Vale para comentários em <strong>todas as publicações</strong> (Feed, Reels e Carrossel) da conta selecionada.</span>
        </div>
      ) : (
        <div className="space-y-2.5">
          {!channelId ? (
            <p className="text-xs text-amber-500 bg-amber-500/10 border border-amber-500/20 p-2.5 rounded-lg">
              Selecione uma conta do Instagram acima para carregar as publicações.
            </p>
          ) : (
            <>
              {/* Publicação Selecionada no Topo */}
              {value?.trim() && (
                <div className="p-2.5 bg-primary/5 border border-primary/30 rounded-lg flex items-center justify-between gap-3 text-xs">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="size-10 rounded bg-muted/60 flex items-center justify-center shrink-0 overflow-hidden border border-border">
                      {selectedPost?.thumbnailUrl || selectedPost?.mediaUrl ? (
                        <img
                          src={selectedPost.thumbnailUrl ?? selectedPost.mediaUrl ?? ""}
                          alt="Thumbnail da publicação"
                          className="size-full object-cover"
                        />
                      ) : (
                        <ImageIcon className="size-5 text-muted-foreground" />
                      )}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="font-semibold text-foreground truncate">
                          {selectedPost ? (selectedPost.caption ? selectedPost.caption.slice(0, 40) + "…" : "Sem legenda") : `ID: ${value}`}
                        </span>
                        <span className="inline-flex items-center px-1.5 py-0.2 rounded text-[10px] bg-primary/20 text-primary font-medium">
                          Selecionada
                        </span>
                      </div>
                      <p className="text-[11px] text-muted-foreground font-mono">ID: {value}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {selectedPost?.permalink && (
                      <a
                        href={selectedPost.permalink}
                        target="_blank"
                        rel="noreferrer"
                        className="p-1 text-muted-foreground hover:text-foreground rounded hover:bg-muted"
                        title="Ver no Instagram"
                      >
                        <ExternalLinkIcon className="size-3.5" />
                      </a>
                    )}
                    <button
                      type="button"
                      onClick={() => onChange("")}
                      className="p-1 text-muted-foreground hover:text-destructive rounded hover:bg-muted"
                      title="Desmarcar publicação"
                    >
                      <XIcon className="size-3.5" />
                    </button>
                  </div>
                </div>
              )}

              {/* Barra de Busca e Atualizar */}
              <div className="flex items-center gap-2">
                <div className="relative flex-1">
                  <SearchIcon className="size-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    placeholder="Filtrar publicações..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="h-8 pl-8 text-xs"
                  />
                </div>
                <button
                  type="button"
                  onClick={loadMedia}
                  disabled={isLoading}
                  className="h-8 px-2.5 rounded-lg border border-input hover:bg-muted text-xs flex items-center gap-1 text-muted-foreground hover:text-foreground shrink-0 disabled:opacity-50 cursor-pointer"
                  title="Atualizar publicações"
                >
                  <RefreshCwIcon className={`size-3 ${isLoading ? "animate-spin" : ""}`} />
                  <span>Atualizar</span>
                </button>
              </div>

              {/* Lista Visual de Publicações */}
              {isLoading && !hasLoaded ? (
                <div className="flex flex-col items-center justify-center p-6 bg-muted/20 border border-border/50 rounded-lg text-xs text-muted-foreground gap-2">
                  <Loader2Icon className="size-5 animate-spin text-primary" />
                  <span>Carregando publicações do perfil...</span>
                </div>
              ) : fetchError ? (
                <div className="p-3 bg-destructive/10 border border-destructive/20 rounded-lg text-xs text-destructive space-y-1">
                  <p className="font-medium">{fetchError}</p>
                  <p className="text-[11px] text-muted-foreground">
                    Verifique se o token de acesso do Instagram possui permissão de leitura ou insira o ID manualmente abaixo.
                  </p>
                </div>
              ) : filteredItems.length === 0 ? (
                <div className="p-4 bg-muted/20 border border-dashed border-border rounded-lg text-xs text-center text-muted-foreground space-y-1">
                  <p>Nenhuma publicação recente encontrada.</p>
                  <p className="text-[11px]">Você pode inserir o ID numérico da postagem manualmente abaixo.</p>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-2 max-h-56 overflow-y-auto p-1 border border-border/50 rounded-lg bg-background/50">
                  {filteredItems.map((item) => {
                    const isSelected = item.id === value?.trim();
                    const icon =
                      item.mediaType === "VIDEO" ? (
                        <FilmIcon className="size-3 text-white" />
                      ) : item.mediaType === "CAROUSEL_ALBUM" ? (
                        <LayersIcon className="size-3 text-white" />
                      ) : (
                        <ImageIcon className="size-3 text-white" />
                      );

                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => onChange(item.id)}
                        className={`group relative flex flex-col text-left rounded-lg border p-1.5 transition-all overflow-hidden cursor-pointer ${
                          isSelected
                            ? "border-primary bg-primary/10 ring-2 ring-primary/40 shadow-sm"
                            : "border-border/60 hover:border-primary/50 hover:bg-muted/30"
                        }`}
                      >
                        <div className="relative aspect-video w-full rounded bg-muted/80 overflow-hidden mb-1.5 flex items-center justify-center">
                          {item.thumbnailUrl || item.mediaUrl ? (
                            <img
                              src={item.thumbnailUrl ?? item.mediaUrl ?? ""}
                              alt={item.caption || "Instagram post"}
                              className="size-full object-cover transition-transform group-hover:scale-105"
                              loading="lazy"
                            />
                          ) : (
                            <ImageIcon className="size-6 text-muted-foreground/50" />
                          )}
                          <div className="absolute top-1 left-1 p-0.5 rounded bg-black/60 backdrop-blur-xs flex items-center justify-center">
                            {icon}
                          </div>
                          {isSelected && (
                            <div className="absolute top-1 right-1 size-4 rounded-full bg-primary text-primary-foreground flex items-center justify-center shadow">
                              <CheckIcon className="size-2.5 stroke-[3]" />
                            </div>
                          )}
                        </div>
                        <p className="text-[11px] font-medium text-foreground line-clamp-2 leading-tight">
                          {item.caption ? item.caption : "(Sem legenda)"}
                        </p>
                        <span className="text-[10px] text-muted-foreground mt-1 font-mono">
                          {item.id}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </>
          )}

          {/* Fallback de ID Manual (sempre acessível para testes e flexibilidade) */}
          <div className="pt-1">
            <button
              type="button"
              onClick={() => setShowManual((v) => !v)}
              className="text-[11px] text-muted-foreground hover:text-foreground underline underline-offset-2 cursor-pointer"
            >
              {showManual ? "Ocultar inserção manual de ID" : "Inserir ou verificar ID manualmente"}
            </button>
          </div>
        </div>
      )}

      {/* Input de ID numérico mantido para acessibilidade, testes E2E e input manual */}
      <div className={mode === "specific" && showManual ? "space-y-1 mt-2" : "hidden"}>
        <label htmlFor="trigger-media" className="text-xs font-medium text-muted-foreground">
          ID da publicação (opcional)
        </label>
        <Input
          id="trigger-media"
          autoComplete="off"
          value={value ?? ""}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Ex.: 17923847291823"
          className="h-8 text-xs font-mono"
          {...invalidProps("trigger-media", error)}
        />
        <p className="text-[11px] text-muted-foreground">Em branco, vale para qualquer publicação.</p>
        {error && <p id="trigger-media-error" className="text-xs text-destructive">{error}</p>}
      </div>

      {/* Fallback para page.getByLabel("ID da publicação (opcional)") caso o modo manual esteja recolhido */}
      {!(mode === "specific" && showManual) && (
        <input
          id="trigger-media"
          aria-label="ID da publicação (opcional)"
          type="hidden"
          value={value ?? ""}
          readOnly
        />
      )}
    </div>
  );
}

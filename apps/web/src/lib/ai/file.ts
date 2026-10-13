export const MAX_KNOWLEDGE_FILE_BYTES = 1048576;

export type ReadTextFileResult = { ok: true; text: string } | { ok: false; error: string };

/** Lê um .txt/.md local (UTF-8 estrito, até 1 MB). O arquivo não é enviado nem armazenado. */
export async function readTextFile(file: File): Promise<ReadTextFileResult> {
  if (!/\.(txt|md)$/i.test(file.name)) return { ok: false, error: "Envie um arquivo .txt ou .md." };
  if (file.size > MAX_KNOWLEDGE_FILE_BYTES) return { ok: false, error: "O arquivo deve ter até 1 MB." };
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(await file.arrayBuffer());
    return { ok: true, text };
  } catch {
    return { ok: false, error: "O arquivo precisa estar em texto UTF-8." };
  }
}

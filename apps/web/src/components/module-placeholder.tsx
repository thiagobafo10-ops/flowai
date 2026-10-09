import { NAV_ITEMS } from "@/lib/navigation";

export function ModulePlaceholder({ href }: { href: string }) {
  const item = NAV_ITEMS.find((i) => i.href === href);
  if (!item) throw new Error(`Módulo desconhecido: ${href}`);
  const Icon = item.icon;
  return (
    <main className="flex flex-col items-start gap-4 p-6">
      <span className="flex size-12 items-center justify-center rounded-lg bg-primary/10 text-primary">
        <Icon className="size-6" aria-hidden="true" />
      </span>
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold">{item.label}</h1>
        <p className="max-w-prose text-muted-foreground">{item.description}</p>
      </div>
      <span className="rounded-full border px-3 py-1 text-xs font-medium text-muted-foreground">
        Em construção
      </span>
    </main>
  );
}

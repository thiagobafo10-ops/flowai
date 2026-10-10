import { RequireOrg } from "@/components/require-org";

export default function Page() {
  return (
    <RequireOrg>
      <div className="flex flex-col items-start gap-2">
        <span className="rounded-full border px-3 py-1 text-xs font-medium text-muted-foreground">
          Em construção
        </span>
        <p className="max-w-prose text-muted-foreground">Organização, equipe e integrações.</p>
      </div>
    </RequireOrg>
  );
}

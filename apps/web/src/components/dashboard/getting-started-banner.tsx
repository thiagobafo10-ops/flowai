import { Card, CardContent } from "@/components/ui/card";
import { ActionLink } from "@/components/ui/action-link";
import { IconOrb } from "@/components/ui/icon-orb";
import { SparklesIcon } from "lucide-react";

export function GettingStartedBanner() {
  return (
    <Card className="col-span-12">
      <CardContent className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-4">
          <IconOrb size="lg" aria-hidden="true">
            <SparklesIcon className="size-5" />
          </IconOrb>
          <p className="text-sm">
            Ainda não há dados. Conecte um canal para começar a receber conversas.
          </p>
        </div>
        <ActionLink href="/configuracoes">Conectar canal</ActionLink>
      </CardContent>
    </Card>
  );
}

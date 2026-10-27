import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

type FormAction = (formData: FormData) => Promise<void>;

export type ConsentCardProps = {
  authorizationId: string;
  clientName: string;
  userEmail: string;
  redirectHost: string | null;
  trustedRedirect: boolean;
  failed: boolean;
  actions: { approve: FormAction; deny: FormAction; switchAccount: FormAction };
};

function HiddenId({ id }: { id: string }) {
  return <input type="hidden" name="authorization_id" value={id} />;
}

export function ConsentCard(props: ConsentCardProps) {
  const { authorizationId, clientName, userEmail, redirectHost, trustedRedirect, failed, actions } = props;
  return (
    <Card>
      <CardHeader>
        <CardTitle>{clientName}</CardTitle>
        <CardDescription>Permitir que o Claude gerencie suas automações do Instagram?</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 text-sm text-muted-foreground">
        <p>
          <strong className="text-foreground">{clientName}</strong> poderá criar, editar, pausar e consultar
          automações e resultados da sua organização no FlowAI, com as mesmas permissões da sua conta.
        </p>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p>
            Conta: <strong className="text-foreground">{userEmail}</strong>
          </p>
          <form action={actions.switchAccount}>
            <HiddenId id={authorizationId} />
            <Button type="submit" variant="link" size="sm" className="h-auto p-0">
              Não é você? Sair
            </Button>
          </form>
        </div>
        <p>
          Você será redirecionado para:{" "}
          <strong className="break-all text-foreground">{redirectHost ?? "endereço desconhecido"}</strong>
        </p>
        {!trustedRedirect && (
          <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-destructive">
            Atenção: este pedido não vem do Claude. Só permita se você reconhece este endereço.
          </p>
        )}
        {failed && (
          <p role="alert" className="text-destructive">
            Não foi possível concluir. Tente novamente.
          </p>
        )}
      </CardContent>
      <CardFooter className="flex gap-2">
        <form action={actions.deny} className="flex-1">
          <HiddenId id={authorizationId} />
          <Button type="submit" variant="outline" className="w-full">
            Recusar
          </Button>
        </form>
        <form action={actions.approve} className="flex-1">
          <HiddenId id={authorizationId} />
          <Button type="submit" className="w-full">
            Permitir
          </Button>
        </form>
      </CardFooter>
    </Card>
  );
}

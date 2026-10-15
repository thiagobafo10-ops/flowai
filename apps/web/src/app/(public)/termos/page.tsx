import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Termos de Serviço | FlowAI",
  description: "Termos de Serviço e Condições de Uso da plataforma FlowAI.",
};

export default function TermosPage() {
  return (
    <main className="min-h-screen bg-background text-foreground py-16 px-4 sm:px-6 lg:px-8">
      <div className="max-w-3xl mx-auto space-y-8">
        <header className="border-b border-border pb-6">
          <h1 className="text-3xl font-bold tracking-tight">Termos de Serviço</h1>
          <p className="text-sm text-muted-foreground mt-2">Última atualização: 14 de Outubro de 2026</p>
        </header>

        <section className="space-y-4 text-sm leading-relaxed">
          <h2 className="text-xl font-semibold">1. Aceitação dos Termos</h2>
          <p>
            Ao acessar e utilizar os serviços da <strong>FlowAI</strong>, você concorda em cumprir e vincular-se a estes Termos de Serviço e a todas as leis e regulamentos aplicáveis.
          </p>

          <h2 className="text-xl font-semibold">2. Descrição dos Serviços</h2>
          <p>
            A FlowAI fornece soluções de software como serviço (SaaS) voltadas para atendimento ao cliente, gestão de relacionamentos (CRM) e automação de mensagens em canais de mídia social como Instagram e WhatsApp.
          </p>

          <h2 className="text-xl font-semibold">3. Uso Responsável e Políticas da Plataforma</h2>
          <p>
            O usuário se compromete a não utilizar a plataforma para envio de spam, conteúdo ofensivo, fraudulento ou que viole as Políticas da Plataforma Meta ou os Termos de Uso do Instagram. O descumprimento destas diretrizes pode resultar na suspensão imediata da conta.
          </p>

          <h2 className="text-xl font-semibold">4. Modificações e Encerramento</h2>
          <p>
            Reservamo-nos o direito de alterar ou atualizar estes termos a qualquer momento. O uso contínuo da plataforma após alterações constitui aceitação dos novos termos.
          </p>
        </section>
      </div>
    </main>
  );
}

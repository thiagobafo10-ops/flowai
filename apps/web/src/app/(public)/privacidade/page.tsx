import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Política de Privacidade | FlowAI",
  description: "Política de Privacidade e Proteção de Dados da plataforma FlowAI.",
};

export default function PrivacidadePage() {
  return (
    <main className="min-h-screen bg-background text-foreground py-16 px-4 sm:px-6 lg:px-8">
      <div className="max-w-3xl mx-auto space-y-8">
        <header className="border-b border-border pb-6">
          <h1 className="text-3xl font-bold tracking-tight">Política de Privacidade</h1>
          <p className="text-sm text-muted-foreground mt-2">Última atualização: 14 de Outubro de 2026</p>
        </header>

        <section className="space-y-4 text-sm leading-relaxed">
          <h2 className="text-xl font-semibold">1. Introdução</h2>
          <p>
            A <strong>FlowAI</strong> respeita a privacidade de seus usuários e tem o compromisso de proteger os dados pessoais tratados por meio de sua plataforma de automação, CRM e inteligência artificial para canais de mensagens (incluindo Instagram e WhatsApp).
          </p>

          <h2 className="text-xl font-semibold">2. Dados Coletados</h2>
          <p>
            Ao utilizar nossos serviços e conectar seus canais de atendimento, podemos coletar e processar:
          </p>
          <ul className="list-disc pl-6 space-y-1">
            <li>Dados cadastrais do usuário (nome, e-mail e informações da organização);</li>
            <li>Identificadores públicos de contas sociais conectadas (ID da conta, nome de usuário e identificadores de mensagens fornecidos pelas APIs da Meta);</li>
            <li>Conteúdo de mensagens e comentários recebidos exclusivamente para fins de execução dos fluxos de automação e atendimento contratados.</li>
          </ul>

          <h2 className="text-xl font-semibold">3. Uso das Informações e APIs da Meta</h2>
          <p>
            Os dados obtidos por meio das APIs da Meta (Instagram Graph API e Webhooks) são utilizados estritamente para:
          </p>
          <ul className="list-disc pl-6 space-y-1">
            <li>Receber e processar comentários e mensagens diretas em tempo real;</li>
            <li>Disparar as respostas automáticas configuradas pelo administrador da conta;</li>
            <li>Organizar contatos e históricos de atendimento no CRM da organização.</li>
          </ul>
          <p>
            A FlowAI não vende, não compartilha com terceiros para fins publicitários e não utiliza dados de mensagens de clientes para treinamento de modelos públicos.
          </p>

          <h2 className="text-xl font-semibold">4. Armazenamento e Segurança</h2>
          <p>
            Todas as credenciais de acesso e segredos de API são criptografados em repouso através de cofres de segurança (Vault) e as comunicações ocorrem exclusivamente sob HTTPS/TLS com validação criptográfica de assinaturas HMAC.
          </p>

          <h2 className="text-xl font-semibold">5. Exclusão de Dados</h2>
          <p>
            O usuário pode desconectar seus canais a qualquer momento na tela de configurações da plataforma, o que revoga os tokens e interrompe imediatamente a recepção de webhooks. Para solicitar a exclusão definitiva de todos os dados da organização, entre em contato através do e-mail de suporte.
          </p>

          <h2 className="text-xl font-semibold">6. Contato</h2>
          <p>
            Para esclarecimentos sobre esta política ou sobre o tratamento de dados pessoais, entre em contato através do endereço: <strong>suporte@flowai.com.br</strong>.
          </p>
        </section>
      </div>
    </main>
  );
}

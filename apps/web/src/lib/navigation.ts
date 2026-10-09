import {
  BarChart3,
  Bot,
  BookOpen,
  Inbox,
  KanbanSquare,
  LayoutDashboard,
  Settings,
  Users,
  Workflow,
  type LucideIcon,
} from "lucide-react";
import type { OrgRole } from "@flowai/core";

export type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  description: string;
};

export const NAV_ITEMS: readonly NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard, description: "" },
  {
    href: "/inbox",
    label: "Inbox",
    icon: Inbox,
    description: "Todas as conversas de WhatsApp e Instagram em um só lugar.",
  },
  {
    href: "/contatos",
    label: "Contatos",
    icon: Users,
    description: "Seus clientes e leads com histórico, tags e responsável.",
  },
  {
    href: "/pipeline",
    label: "Pipeline",
    icon: KanbanSquare,
    description: "Acompanhe oportunidades de venda por etapa.",
  },
  {
    href: "/automacoes",
    label: "Automações",
    icon: Workflow,
    description: "Crie fluxos automáticos de atendimento e vendas.",
  },
  {
    href: "/ia",
    label: "IA",
    icon: Bot,
    description: "Configure o agente de IA que atende seus clientes.",
  },
  {
    href: "/conhecimento",
    label: "Conhecimento",
    icon: BookOpen,
    description: "Documentos que a IA usa para responder com precisão.",
  },
  {
    href: "/analytics",
    label: "Analytics",
    icon: BarChart3,
    description: "Relatórios detalhados de atendimento e vendas.",
  },
  {
    href: "/configuracoes",
    label: "Configurações",
    icon: Settings,
    description: "Organização, equipe e integrações.",
  },
];

const ROLE_LABELS = {
  owner: "Proprietário",
  admin: "Administrador",
  agent: "Agente",
  viewer: "Visualizador",
} as const satisfies Record<OrgRole, string>;

export function roleLabel(role: OrgRole): (typeof ROLE_LABELS)[OrgRole] {
  return ROLE_LABELS[role];
}

/** Casa a rota exata ou uma sub-rota (`/contatos/123` → Contatos). */
export function findNavItem(pathname: string): NavItem | undefined {
  return NAV_ITEMS.find((item) => pathname === item.href || pathname.startsWith(`${item.href}/`));
}

import { Suspense } from "react";
import type { Metadata } from "next";
import { LoginForm } from "@/components/auth/login-form";
import { safeNextPath } from "@/lib/security/safe-next";

export const metadata: Metadata = { title: "Entrar | FlowAI" };

type Props = { searchParams: Promise<{ next?: string | string[] }> };

async function LoginWithReturn({ searchParams }: Props) {
  const { next } = await searchParams;
  return <LoginForm next={safeNextPath(Array.isArray(next) ? next[0] : next) ?? undefined} />;
}

export default function LoginPage(props: Props) {
  return (
    <Suspense fallback={<LoginForm />}>
      <LoginWithReturn {...props} />
    </Suspense>
  );
}

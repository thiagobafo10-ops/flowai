"use client";

import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2Icon } from "lucide-react";
import { toast } from "sonner";
import {
  createOrganizationSchema,
  type CreateOrganizationInput,
} from "@flowai/core";
import { createOrganization } from "@/app/onboarding/actions";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function CreateOrganizationForm() {
  const [pending, startTransition] = useTransition();
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<CreateOrganizationInput>({
    resolver: zodResolver(createOrganizationSchema),
    defaultValues: { name: "" },
  });

  const onSubmit = handleSubmit((values) => {
    setFormError(null);
    startTransition(async () => {
      const result = await createOrganization(values);
      // Em caso de sucesso a action redireciona e não retorna.
      if (result && !result.ok) {
        setFormError(result.error);
        toast.error(result.error);
      }
    });
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Crie sua organização</CardTitle>
        <CardDescription>
          Informe o nome da sua empresa para começar.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          <div className="space-y-2">
            <Label htmlFor="name">Nome da empresa</Label>
            <Input
              id="name"
              autoComplete="organization"
              aria-invalid={!!errors.name}
              {...register("name")}
            />
            {errors.name && (
              <p className="text-sm text-destructive">{errors.name.message}</p>
            )}
          </div>
          {formError && (
            <p role="alert" className="text-sm text-destructive">
              {formError}
            </p>
          )}
          <Button type="submit" className="w-full" disabled={pending}>
            {pending && <Loader2Icon className="animate-spin" />}
            Criar organização
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

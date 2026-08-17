"use client";

import * as React from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { LockKeyhole, Plane, Smartphone, UserRound } from "lucide-react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { identitySchema } from "@/lib/pilot-validation";
import { useApplicationServices } from "@/services/application-services-provider";
import type { AccessLinkRequest } from "@/types/services";

export function PilotIdentityForm({ portal = "pilot" }: { portal?: "pilot" | "member" }) {
  const portalPath = portal === "member" ? "/member" : "/pilot";
  const router = useRouter();
  const { pilotIdentity } = useApplicationServices();
  const [interactive, setInteractive] = React.useState(false);
  const [sent, setSent] = React.useState(false);
  React.useEffect(() => setInteractive(true), []);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<AccessLinkRequest>({
    resolver: zodResolver(identitySchema),
    defaultValues: { employeeNumber: "", mobile: "" },
  });

  const submit = handleSubmit(async (values) => {
    const result = await pilotIdentity.requestAccessLink(values);
    if (result.source === "mock") router.push(`${portalPath}/qualifications`);
    else setSent(true);
  });

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[430px] flex-col bg-surface px-6 pb-safe-bottom pt-12 shadow-sm">
      <div className="flex flex-col items-center gap-3 text-center">
        <div className="flex size-14 items-center justify-center rounded-lg bg-brand text-white">
          <Plane aria-hidden="true" className="size-8" />
        </div>
        <div>
          <p className="text-2xl font-bold text-primary">CrewQual</p>
          <p className="mt-1 text-xs font-semibold text-muted">
            机组资质合规系统 · {portal === "member" ? "成员门户" : "飞行员门户"}
          </p>
        </div>
      </div>

      <form onSubmit={submit} className="my-auto space-y-5 py-10" noValidate>
        <div>
          <h1 className="text-xl font-bold text-primary">
            {portal === "member" ? "成员资质查询" : "飞行员资质查询"}
          </h1>
          <p className="mt-1 text-[13px] text-secondary">请输入您的员工信息以获取访问链接</p>
          {sent ? (
            <p className="mt-3 rounded-md bg-emerald-50 p-3 text-xs leading-5 text-success">
              请求已受理。如果信息匹配，访问链接会发送到登记手机号；无论是否匹配，页面都会显示相同结果。
            </p>
          ) : null}
        </div>
        <div className="space-y-4">
          <div className="relative">
            <UserRound
              aria-hidden="true"
              className="pointer-events-none absolute left-3 top-[35px] z-10 size-4 text-secondary"
            />
            <Input
              label="员工工号"
              required
              disabled={!interactive}
              autoComplete="username"
              placeholder="例如：CQ-1049"
              className="pl-9"
              error={errors.employeeNumber?.message}
              {...register("employeeNumber")}
            />
          </div>
          <div className="relative">
            <Smartphone
              aria-hidden="true"
              className="pointer-events-none absolute left-3 top-[35px] z-10 size-4 text-secondary"
            />
            <Input
              label="登记手机号"
              required
              disabled={!interactive}
              inputMode="numeric"
              autoComplete="tel"
              maxLength={11}
              placeholder="登记的11位手机号码"
              className="pl-9"
              error={errors.mobile?.message}
              {...register("mobile")}
            />
          </div>
        </div>
        <div className="space-y-2">
          <Button
            type="submit"
            size="lg"
            className="w-full"
            disabled={!interactive}
            loading={isSubmitting}
          >
            发送访问链接
          </Button>
          <p className="text-center text-[11px] leading-5 text-muted">
            访问链接为一次性凭证，有效期 15 分钟
          </p>
        </div>
      </form>

      <p className="flex items-center gap-2 pb-6 text-[11px] text-muted">
        <LockKeyhole aria-hidden="true" className="size-3.5" />
        您的信息仅用于身份验证
      </p>
    </main>
  );
}

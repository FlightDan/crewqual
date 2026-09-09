import type { Metadata } from "next";
import { Suspense } from "react";
import { PasswordResetForm } from "./password-reset-form";

export const metadata: Metadata = { title: "设置管理员密码 · CrewQual" };

export default function AdminPasswordResetPage() {
  return (
    <Suspense fallback={<main className="min-h-dvh bg-surface" />}>
      <PasswordResetForm />
    </Suspense>
  );
}

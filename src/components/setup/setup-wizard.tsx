"use client";

import * as React from "react";
import Link from "next/link";
import {
  AlertCircle,
  Bell,
  Check,
  CheckCircle2,
  ChevronDown,
  CircleHelp,
  Clock3,
  Copy,
  Database,
  Edit3,
  FileArchive,
  Info,
  LockKeyhole,
  MessageSquare,
  QrCode,
  RefreshCw,
  Search,
  ShieldCheck,
  Smartphone,
  UserRoundCog,
  UsersRound,
  Wrench,
} from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/choice";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { setupCopy } from "@/lib/setup-i18n";
import { LOCALE_COOKIE } from "@/lib/locale";
import { cn } from "@/lib/utils";
import type {
  SetupCompleteInput,
  SetupCompleteResult,
  SetupEnvironmentStatus,
  SetupLocale,
  SetupOverview,
  SetupTemplate,
} from "@/types/setup";

type ApiEnvelope<T> = { data?: T; error?: { code?: string; message?: string } };
type SetupErrorMap = Partial<Record<"name" | "email" | "password" | "confirm" | "totp", string>>;
type BackupTargetType = SetupCompleteInput["backup"]["targetType"];
type NotificationChannelKey = "inApp" | "feishu" | "sms";

const timezones = [
  "Asia/Shanghai",
  "Asia/Hong_Kong",
  "Asia/Singapore",
  "Asia/Tokyo",
  "Europe/London",
  "America/Los_Angeles",
  "UTC",
];

const routeKeys = [
  "qualification_expiry",
  "review_approved",
  "review_returned",
  "upgrade_created",
  "upgrade_rescheduled",
  "upgrade_completed",
  "delivery_failed",
] as const;

const channelKeys = ["inApp", "feishu", "sms"] as const;

async function apiRequest<T>(url: string, method = "GET", body?: unknown): Promise<T> {
  const response = await fetch(url, {
    method,
    credentials: "include",
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = (await response.json().catch(() => ({}))) as ApiEnvelope<T>;
  if (!response.ok || !payload.data) {
    const error = new Error(payload.error?.message ?? "Request failed") as Error & {
      code?: string;
    };
    error.code = payload.error?.code;
    throw error;
  }
  return payload.data;
}

function passwordScore(value: string) {
  if (!value) return 0;
  return [
    value.length >= 12,
    /[a-z]/.test(value) && /[A-Z]/.test(value),
    /\d/.test(value),
    /[^A-Za-z0-9]/.test(value),
  ].filter(Boolean).length;
}

function templateLabel(template: SetupTemplate, locale: SetupLocale) {
  return template.translations[locale] || template.name;
}

function templateDescription(template: SetupTemplate, locale: SetupLocale) {
  return template.descriptionTranslations?.[locale] || template.description;
}

function statusTone(status: SetupEnvironmentStatus) {
  if (status === "ok") return "success" as const;
  if (status === "warning" || status === "unknown") return "warning" as const;
  return "danger" as const;
}

function StatusIcon({ status }: { status: SetupEnvironmentStatus }) {
  if (status === "ok") return <CheckCircle2 aria-hidden="true" className="size-4 text-success" />;
  if (status === "error") return <AlertCircle aria-hidden="true" className="size-4 text-danger" />;
  return <CircleHelp aria-hidden="true" className="size-4 text-warning" />;
}

function ProductMark({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-md bg-brand text-white">
        <ShieldCheck aria-hidden="true" className="size-5" />
      </span>
      <span className={cn("font-bold", compact ? "text-lg text-primary" : "text-xl text-white")}>
        CrewQual
      </span>
    </div>
  );
}

function SetupBadge({ required, locale }: { required?: boolean; locale: SetupLocale }) {
  const copy = setupCopy[locale];
  return (
    <Badge tone={required ? "warning" : "info"} className="shrink-0 text-[10px]">
      {required ? copy.required : copy.configureLater}
    </Badge>
  );
}

function SetupTitle({
  title,
  description,
  locale,
  required,
  optional,
}: {
  title: string;
  description: string;
  locale: SetupLocale;
  required?: boolean;
  optional?: boolean;
}) {
  return (
    <header className="space-y-2 pb-2">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-bold tracking-tight text-primary sm:text-[28px]">{title}</h1>
        {required || optional ? <SetupBadge required={required} locale={locale} /> : null}
      </div>
      <p className="max-w-3xl text-sm leading-6 text-secondary">{description}</p>
    </header>
  );
}

function SetupShell({
  step,
  locale,
  skipped,
  version,
  children,
  actions,
}: {
  step: number;
  locale: SetupLocale;
  skipped: Set<number>;
  version: string;
  children: React.ReactNode;
  actions: React.ReactNode;
}) {
  const copy = setupCopy[locale];
  return (
    <main className="min-h-dvh bg-surface lg:grid lg:h-dvh lg:grid-cols-[280px_minmax(0,1fr)] lg:overflow-hidden">
      <aside className="hidden h-dvh flex-col bg-nav px-6 py-8 lg:flex">
        <div>
          <ProductMark />
          <p className="mt-2 text-xs text-slate-300">{copy.productSubtitle}</p>
        </div>
        <ol className="mt-10 flex-1 space-y-4" aria-label={copy.wizardVersion}>
          {copy.steps.map((label, index) => {
            const number = index + 1;
            const complete = number < step;
            const active = number === step;
            return (
              <li key={label} className="flex min-w-0 items-center gap-3">
                <span
                  className={cn(
                    "inline-flex size-6 shrink-0 items-center justify-center rounded-full border text-xs font-semibold",
                    active && "border-brand bg-brand text-white",
                    complete && "border-brand bg-brand text-white",
                    !active && !complete && "border-slate-600 text-slate-500",
                  )}
                  aria-current={active ? "step" : undefined}
                >
                  {complete ? <Check aria-hidden="true" className="size-3.5" /> : number}
                </span>
                <span
                  className={cn(
                    "min-w-0 flex-1 truncate text-sm font-medium",
                    active || complete ? "text-white" : "text-slate-500",
                  )}
                >
                  {label}
                </span>
                {(number === 2 || number === 3) && !complete ? (
                  <Badge tone="warning" className="px-1.5 py-0.5 text-[9px]">
                    {copy.required}
                  </Badge>
                ) : number >= 4 && number <= 6 && !complete ? (
                  <span className="rounded bg-white/5 px-1.5 py-0.5 text-[9px] text-slate-600">
                    {skipped.has(number) ? copy.later : copy.optional}
                  </span>
                ) : null}
              </li>
            );
          })}
        </ol>
        <p className="text-[11px] text-slate-600">
          {copy.wizardVersion} v{version}
        </p>
      </aside>

      <section className="flex min-h-dvh min-w-0 flex-col lg:h-dvh">
        <header className="sticky top-0 z-20 border-b border-border bg-card lg:hidden">
          <div className="flex h-[54px] items-center justify-between px-4">
            <ProductMark compact />
            <span className="text-sm font-semibold text-brand">{copy.stepProgress(step)}</span>
          </div>
          <div className="h-1 bg-slate-200">
            <div
              className="h-full bg-brand transition-[width] duration-300"
              style={{ width: `${(step / 8) * 100}%` }}
            />
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-[960px] px-4 py-6 sm:px-8 sm:py-10 lg:px-20 lg:py-[60px]">
            {children}
          </div>
        </div>
        <footer className="sticky bottom-0 z-20 border-t border-border bg-card px-4 py-3 sm:px-8 lg:px-10 lg:py-5">
          {actions}
        </footer>
      </section>
    </main>
  );
}

function ActionBar({ left, right }: { left?: React.ReactNode; right: React.ReactNode }) {
  return (
    <div className="mx-auto flex w-full max-w-[1080px] items-center justify-between gap-3">
      <div>{left}</div>
      <div className="flex items-center gap-3">{right}</div>
    </div>
  );
}

function EnvironmentRow({
  label,
  status,
  detail,
  locale,
}: {
  label: string;
  status: SetupEnvironmentStatus;
  detail?: string;
  locale: SetupLocale;
}) {
  const copy = setupCopy[locale];
  const statusLabel =
    status === "ok"
      ? copy.welcome.normal
      : status === "error"
        ? copy.welcome.failed
        : copy.welcome.warning;
  return (
    <div className="flex min-h-11 items-center justify-between gap-4 border-b border-border py-2.5 last:border-0">
      <span className="flex min-w-0 items-center gap-2.5 text-sm text-primary">
        <StatusIcon status={status} />
        <span>{label}</span>
      </span>
      {detail ? (
        <span className="text-right text-xs text-secondary">{detail}</span>
      ) : (
        <Badge tone={statusTone(status)}>{statusLabel}</Badge>
      )}
    </div>
  );
}

function WelcomeStep({
  overview,
  locale,
  timezone,
  organizationName,
  checking,
  onLocale,
  onTimezone,
  onOrganization,
  onRecheck,
}: {
  overview: SetupOverview;
  locale: SetupLocale;
  timezone: string;
  organizationName: string;
  checking: boolean;
  onLocale: (locale: SetupLocale) => void;
  onTimezone: (timezone: string) => void;
  onOrganization: (name: string) => void;
  onRecheck: () => void;
}) {
  const copy = setupCopy[locale];
  const environment = overview.environment;
  return (
    <div className="space-y-8">
      <SetupTitle
        title={copy.welcome.title}
        description={copy.welcome.description}
        locale={locale}
      />
      <Card className="space-y-6 p-4 sm:p-8">
        <div className="grid gap-4 sm:grid-cols-2 sm:gap-6">
          <Select
            label={copy.welcome.locale}
            value={locale}
            options={[
              { label: setupCopy["zh-CN"].languageName, value: "zh-CN" },
              { label: setupCopy["en-US"].languageName, value: "en-US" },
            ]}
            onChange={(event) => onLocale(event.target.value as SetupLocale)}
          />
          <Select
            label={copy.welcome.timezone}
            value={timezone}
            options={timezones.map((value) => ({
              label: value === "Asia/Shanghai" ? `${value} (UTC+8)` : value,
              value,
            }))}
            onChange={(event) => onTimezone(event.target.value)}
          />
        </div>
        <Input
          label={copy.welcome.organization}
          placeholder={copy.welcome.organizationPlaceholder}
          value={organizationName}
          maxLength={128}
          onChange={(event) => onOrganization(event.target.value)}
        />
        <div className="space-y-3">
          <h2 className="text-sm font-semibold text-primary">{copy.welcome.environment}</h2>
          <div className="rounded-md border border-border bg-surface px-4 py-1">
            <EnvironmentRow
              label={copy.welcome.database}
              status={environment.database}
              locale={locale}
            />
            <EnvironmentRow
              label={copy.welcome.storage}
              status={environment.storage}
              locale={locale}
            />
            <EnvironmentRow
              label={copy.welcome.worker}
              status={environment.worker}
              detail={environment.workerDetail}
              locale={locale}
            />
            <EnvironmentRow
              label={copy.welcome.version}
              status="unknown"
              detail={`v${environment.version}`}
              locale={locale}
            />
          </div>
          <Button type="button" variant="link" size="sm" loading={checking} onClick={onRecheck}>
            <RefreshCw aria-hidden="true" className="size-3.5" />
            {copy.welcome.recheck}
          </Button>
        </div>
        {environment.database === "error" ? (
          <Alert tone="danger">{copy.welcome.databaseBlocked}</Alert>
        ) : null}
      </Card>
    </div>
  );
}

function StorageStep({
  locale,
  storage,
  busy,
  testResult,
  onChange,
  onTest,
}: {
  locale: SetupLocale;
  storage: SetupCompleteInput["storage"];
  busy: boolean;
  testResult: { ok: boolean; message: string } | null;
  onChange: (storage: SetupCompleteInput["storage"]) => void;
  onTest: () => void;
}) {
  const copy = setupCopy[locale];
  const external = storage.mode === "s3" ? storage : null;
  return (
    <div className="space-y-6">
      <SetupTitle
        title={copy.storage.title}
        description={copy.storage.description}
        locale={locale}
        required
      />
      <div className="grid gap-4 md:grid-cols-2">
        <button
          type="button"
          aria-pressed={storage.mode === "builtin"}
          className={cn(
            "rounded-lg border bg-card p-5 text-left shadow-card",
            storage.mode === "builtin"
              ? "border-2 border-brand ring-2 ring-brand/10"
              : "border-border",
          )}
          onClick={() => onChange({ mode: "builtin" })}
        >
          <Database aria-hidden="true" className="size-6 text-brand" />
          <strong className="mt-3 block text-primary">{copy.storage.builtin}</strong>
          <span className="mt-2 block text-xs leading-5 text-secondary">
            {copy.storage.builtinHelp}
          </span>
        </button>
        <button
          type="button"
          aria-pressed={storage.mode === "s3"}
          className={cn(
            "rounded-lg border bg-card p-5 text-left shadow-card",
            storage.mode === "s3" ? "border-2 border-brand ring-2 ring-brand/10" : "border-border",
          )}
          onClick={() =>
            onChange({
              mode: "s3",
              endpoint: "https://s3.example.com",
              region: "us-east-1",
              bucket: "crewqual-private",
              accessKeyId: "",
              secretAccessKey: "",
              forcePathStyle: false,
              sseKmsKeyId: "",
            })
          }
        >
          <FileArchive aria-hidden="true" className="size-6 text-brand" />
          <strong className="mt-3 block text-primary">{copy.storage.external}</strong>
          <span className="mt-2 block text-xs leading-5 text-secondary">
            {copy.storage.externalHelp}
          </span>
        </button>
      </div>
      {external ? (
        <Card className="space-y-5 p-4 sm:p-7">
          <div className="grid gap-4 sm:grid-cols-2">
            <Input
              label={copy.storage.endpoint}
              required
              type="url"
              value={external.endpoint}
              onChange={(event) => onChange({ ...external, endpoint: event.target.value })}
            />
            <Input
              label={copy.storage.region}
              required
              value={external.region}
              onChange={(event) => onChange({ ...external, region: event.target.value })}
            />
            <Input
              label={copy.storage.bucket}
              required
              value={external.bucket}
              onChange={(event) => onChange({ ...external, bucket: event.target.value })}
            />
            <Input
              label={copy.storage.accessKey}
              required
              autoComplete="off"
              value={external.accessKeyId}
              onChange={(event) => onChange({ ...external, accessKeyId: event.target.value })}
            />
            <Input
              label={copy.storage.secretKey}
              required
              type="password"
              autoComplete="new-password"
              value={external.secretAccessKey}
              onChange={(event) => onChange({ ...external, secretAccessKey: event.target.value })}
            />
            <Input
              label={copy.storage.kmsKey}
              value={external.sseKmsKeyId ?? ""}
              onChange={(event) => onChange({ ...external, sseKmsKeyId: event.target.value })}
            />
          </div>
          <Switch
            checked={external.forcePathStyle}
            label={
              <span>
                <span className="block font-semibold">{copy.storage.pathStyle}</span>
                <span className="mt-1 block text-xs font-normal text-muted">
                  {copy.storage.pathStyleHelp}
                </span>
              </span>
            }
            onChange={(event) => onChange({ ...external, forcePathStyle: event.target.checked })}
          />
        </Card>
      ) : null}
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" variant="secondary" loading={busy} onClick={onTest}>
          <RefreshCw aria-hidden="true" className="size-4" />
          {busy ? copy.storage.testing : copy.storage.test}
        </Button>
        {testResult ? (
          <Alert tone={testResult.ok ? "success" : "danger"}>{testResult.message}</Alert>
        ) : null}
      </div>
    </div>
  );
}

function PasswordStrength({ value, locale }: { value: string; locale: SetupLocale }) {
  const copy = setupCopy[locale];
  const score = passwordScore(value);
  const label = score >= 4 ? copy.admin.strong : score >= 2 ? copy.admin.medium : copy.admin.weak;
  return (
    <div className="space-y-2" aria-live="polite">
      <div className="flex items-center justify-between gap-3 text-xs">
        <span className="text-muted">{copy.admin.strength}</span>
        <span className={cn("font-semibold", score >= 4 ? "text-success" : "text-warning")}>
          {label}
        </span>
      </div>
      <div className="grid grid-cols-4 gap-1">
        {[1, 2, 3, 4].map((item) => (
          <span
            key={item}
            className={cn(
              "h-1 rounded-full bg-slate-200",
              item <= score && (score >= 4 ? "bg-success" : "bg-warning"),
            )}
          />
        ))}
      </div>
      <p className="text-xs text-muted">{copy.admin.passwordHint}</p>
    </div>
  );
}

function AdminStep({
  locale,
  admin,
  errors,
  busy,
  onChange,
  onGenerateTotp,
}: {
  locale: SetupLocale;
  admin: {
    displayName: string;
    email: string;
    password: string;
    confirmPassword: string;
    requireTotp: boolean;
    totpSecret: string;
    totpUri: string;
    enrollmentToken: string;
    verifiedToken: string;
    totpCode: string;
  };
  errors: SetupErrorMap;
  busy: boolean;
  onChange: (patch: Partial<typeof admin>) => void;
  onGenerateTotp: () => void;
}) {
  const copy = setupCopy[locale];
  const [showPassword, setShowPassword] = React.useState(false);
  const copySecret = async () => {
    if (admin.totpSecret && navigator.clipboard)
      await navigator.clipboard.writeText(admin.totpSecret);
  };
  return (
    <div className="space-y-6">
      <SetupTitle
        title={copy.admin.title}
        description={copy.admin.description}
        locale={locale}
        required
      />
      <Card className="space-y-6 p-4 sm:p-7">
        <div className="grid gap-4 sm:grid-cols-2">
          <Input
            label={copy.admin.name}
            required
            autoComplete="name"
            value={admin.displayName}
            error={errors.name}
            onChange={(event) => onChange({ displayName: event.target.value })}
          />
          <Input
            label={copy.admin.email}
            required
            type="email"
            autoComplete="username"
            value={admin.email}
            error={errors.email}
            onChange={(event) =>
              onChange({
                email: event.target.value,
                totpSecret: "",
                totpUri: "",
                enrollmentToken: "",
                verifiedToken: "",
                totpCode: "",
              })
            }
          />
          <Input
            label={copy.admin.password}
            required
            type={showPassword ? "text" : "password"}
            autoComplete="new-password"
            value={admin.password}
            error={errors.password}
            onChange={(event) => onChange({ password: event.target.value })}
          />
          <Input
            label={copy.admin.confirmPassword}
            required
            type={showPassword ? "text" : "password"}
            autoComplete="new-password"
            value={admin.confirmPassword}
            error={errors.confirm}
            onChange={(event) => onChange({ confirmPassword: event.target.value })}
          />
        </div>
        <div className="flex justify-end">
          <button
            type="button"
            className="text-xs font-medium text-brand hover:underline"
            onClick={() => setShowPassword((value) => !value)}
          >
            {showPassword ? copy.admin.hidePassword : copy.admin.showPassword}
          </button>
        </div>
        <PasswordStrength value={admin.password} locale={locale} />

        <div className="border-t border-border pt-5">
          <div className="mb-4 flex items-center gap-2">
            <LockKeyhole aria-hidden="true" className="size-5 text-primary" />
            <h2 className="font-semibold text-primary">{copy.admin.totpTitle}</h2>
          </div>
          <Switch
            checked={admin.requireTotp}
            label={copy.admin.enforce}
            helperText={copy.admin.enforceHelp}
            onChange={(event) =>
              onChange({
                requireTotp: event.target.checked,
                ...(!event.target.checked ? { verifiedToken: "", totpCode: "" } : {}),
              })
            }
          />
          {admin.requireTotp ? (
            <div className="mt-4 space-y-4">
              <Alert tone={admin.verifiedToken ? "success" : "warning"}>
                {admin.verifiedToken ? copy.admin.verified : copy.admin.totpWarning}
              </Alert>
              {!admin.totpSecret ? (
                <Button type="button" variant="secondary" loading={busy} onClick={onGenerateTotp}>
                  <QrCode aria-hidden="true" className="size-4" />
                  {busy ? copy.admin.generating : copy.admin.generate}
                </Button>
              ) : (
                <div className="grid gap-5 sm:grid-cols-[116px_minmax(0,1fr)] sm:items-center">
                  <a
                    href={admin.totpUri}
                    className="flex aspect-square items-center justify-center rounded-md border border-border bg-surface text-secondary hover:border-brand hover:text-brand"
                    aria-label={copy.admin.openAuthenticator}
                  >
                    <QrCode aria-hidden="true" className="size-14" />
                  </a>
                  <div className="min-w-0 space-y-3">
                    <div>
                      <p className="text-xs text-muted">{copy.admin.manualSecret}</p>
                      <div className="mt-1 flex items-center gap-2">
                        <code className="break-all text-sm font-bold text-primary">
                          {admin.totpSecret}
                        </code>
                        <button
                          type="button"
                          className="inline-flex size-8 items-center justify-center rounded text-brand hover:bg-blue-50"
                          onClick={() => void copySecret()}
                          aria-label="Copy TOTP secret"
                        >
                          <Copy aria-hidden="true" className="size-4" />
                        </button>
                      </div>
                    </div>
                    <Input
                      label={copy.admin.code}
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      pattern="[0-9]{6}"
                      maxLength={6}
                      className="max-w-56 font-mono text-lg tracking-[0.45em]"
                      value={admin.totpCode}
                      error={errors.totp}
                      onChange={(event) =>
                        onChange({
                          totpCode: event.target.value.replace(/\D/g, "").slice(0, 6),
                          verifiedToken: "",
                        })
                      }
                    />
                  </div>
                </div>
              )}
              <div>
                <p className="mb-2 text-xs font-semibold text-primary">{copy.admin.apps}</p>
                <div className="flex flex-wrap gap-2">
                  {["Microsoft Authenticator", "Google Authenticator", "1Password"].map((app) => (
                    <span
                      key={app}
                      className="rounded-full border border-border bg-surface px-3 py-1.5 text-xs text-secondary"
                    >
                      {app}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </Card>
    </div>
  );
}

function PositionsStep({
  locale,
  templates,
  selected,
  onToggle,
}: {
  locale: SetupLocale;
  templates: SetupTemplate[];
  selected: Set<string>;
  onToggle: (id: string) => void;
}) {
  const copy = setupCopy[locale];
  const [query, setQuery] = React.useState("");
  const [customHint, setCustomHint] = React.useState(false);
  const filtered = templates.filter((template) => {
    const value =
      `${templateLabel(template, locale)} ${templateDescription(template, locale)}`.toLowerCase();
    return value.includes(query.trim().toLowerCase());
  });
  const icons = [UsersRound, UserRoundCog, Clock3, Wrench, ShieldCheck];
  return (
    <div className="space-y-6">
      <SetupTitle
        title={copy.positions.title}
        description={copy.positions.description}
        locale={locale}
        optional
      />
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <label className="relative block sm:max-w-[320px] sm:flex-1">
          <span className="sr-only">{copy.positions.search}</span>
          <Search
            aria-hidden="true"
            className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted"
          />
          <input
            className="min-h-11 w-full rounded-md border border-border bg-card pl-10 pr-3 text-sm focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
            placeholder={copy.positions.search}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <div className="flex flex-wrap items-center gap-3">
          <Badge tone="info">{copy.positions.selected(selected.size)}</Badge>
          <Button type="button" variant="link" onClick={() => setCustomHint(true)}>
            + {copy.positions.custom}
          </Button>
        </div>
      </div>
      {customHint ? <Alert tone="info">{copy.positions.customHint}</Alert> : null}
      {filtered.length ? (
        <div className="grid gap-3 md:grid-cols-2">
          {filtered.map((template, index) => {
            const active = selected.has(template.id);
            const Icon = icons[index % icons.length]!;
            return (
              <button
                key={template.id}
                type="button"
                aria-pressed={active}
                onClick={() => onToggle(template.id)}
                className={cn(
                  "group relative min-h-36 rounded-lg border bg-card p-4 text-left shadow-card transition",
                  active
                    ? "border-2 border-brand ring-2 ring-brand/10"
                    : "border-border hover:border-blue-300",
                )}
              >
                {active ? (
                  <span className="absolute right-3 top-3 inline-flex size-5 items-center justify-center rounded-full bg-brand text-white">
                    <Check aria-hidden="true" className="size-3" />
                  </span>
                ) : null}
                <div className="flex items-center gap-3 pr-8">
                  <span className="inline-flex size-9 items-center justify-center rounded-md bg-blue-50 text-brand">
                    <Icon aria-hidden="true" className="size-5" />
                  </span>
                  <h2 className="font-semibold text-primary">{templateLabel(template, locale)}</h2>
                </div>
                <p className="mt-3 line-clamp-2 text-xs leading-5 text-secondary">
                  {templateDescription(template, locale)}
                </p>
                <div className="mt-3 flex items-center justify-between gap-3 text-xs">
                  <span className="text-muted">
                    {copy.positions.qualifications(template.qualificationCount, template.version)}
                  </span>
                  <span className="font-semibold text-brand">{copy.positions.details}</span>
                </div>
              </button>
            );
          })}
        </div>
      ) : (
        <Card className="p-8 text-center text-sm text-secondary">{copy.positions.empty}</Card>
      )}
      <p className="flex items-start gap-2 text-xs leading-5 text-secondary">
        <Info aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
        {copy.positions.note}
      </p>
    </div>
  );
}

function BackupStep({
  locale,
  backup,
  busy,
  testResult,
  onChange,
  onTest,
}: {
  locale: SetupLocale;
  backup: SetupCompleteInput["backup"];
  busy: boolean;
  testResult: { ok: boolean; message: string } | null;
  onChange: (patch: Partial<SetupCompleteInput["backup"]>) => void;
  onTest: () => void;
}) {
  const copy = setupCopy[locale];
  const [advanced, setAdvanced] = React.useState(false);
  const typeOptions = [
    { label: copy.backup.localType, value: "LOCAL" },
    { label: "SMB", value: "SMB" },
    { label: "FTP / FTPS", value: "FTP" },
    { label: "WebDAV", value: "WEBDAV" },
    { label: "S3", value: "S3" },
  ];
  const presets = [
    [Database, copy.backup.database, copy.backup.databaseValue],
    [FileArchive, copy.backup.gallery, copy.backup.galleryValue],
    [Clock3, copy.backup.schedule, copy.backup.scheduleValue],
    [RefreshCw, copy.backup.retention, copy.backup.retentionValue],
    [ShieldCheck, copy.backup.encryption, copy.backup.encryptionValue],
  ] as const;
  return (
    <div className="space-y-6">
      <SetupTitle
        title={copy.backup.title}
        description={copy.backup.description}
        locale={locale}
        optional
      />
      <Card className="space-y-5 p-4 sm:p-7">
        <Switch
          checked={backup.enabled}
          label={
            <span>
              <span className="block font-semibold">{copy.backup.enable}</span>
              <span className="mt-1 block text-xs font-normal text-muted">
                {copy.backup.enableHelp}
              </span>
            </span>
          }
          onChange={(event) => onChange({ enabled: event.target.checked })}
        />
        {backup.enabled ? (
          <>
            <div className="border-t border-border pt-5">
              <h2 className="mb-3 text-sm font-semibold text-primary">{copy.backup.recommended}</h2>
              <div className="rounded-md border border-border bg-surface px-4 py-2">
                {presets.map(([Icon, label, value]) => (
                  <div
                    key={label}
                    className="flex min-h-9 items-center justify-between gap-4 text-sm"
                  >
                    <span className="flex items-center gap-2 text-secondary">
                      <Icon aria-hidden="true" className="size-4" />
                      {label}
                    </span>
                    <strong className="text-right text-xs text-primary">{value}</strong>
                  </div>
                ))}
              </div>
            </div>
            <div className="space-y-4">
              <h2 className="text-sm font-semibold text-primary">{copy.backup.target}</h2>
              <div className="grid gap-4 sm:grid-cols-2">
                <Input
                  label={copy.backup.targetName}
                  value={backup.targetName}
                  onChange={(event) => onChange({ targetName: event.target.value })}
                />
                <Select
                  label={copy.backup.targetType}
                  value={backup.targetType}
                  options={typeOptions}
                  onChange={(event) => {
                    const targetType = event.target.value as BackupTargetType;
                    if (targetType !== "LOCAL") setAdvanced(true);
                    onChange({
                      targetType,
                      endpoint:
                        targetType === "LOCAL"
                          ? "/backups"
                          : targetType === "S3"
                            ? "https://s3.example.com"
                            : "",
                    });
                  }}
                />
              </div>
              <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
                <Input
                  label={copy.backup.targetPath}
                  value={backup.endpoint}
                  disabled={backup.targetType === "LOCAL"}
                  onChange={(event) => onChange({ endpoint: event.target.value })}
                />
                <Button type="button" variant="secondary" loading={busy} onClick={onTest}>
                  {busy ? copy.backup.testing : copy.backup.test}
                </Button>
              </div>
              {testResult ? (
                <Alert tone={testResult.ok ? "success" : "danger"}>{testResult.message}</Alert>
              ) : null}
              <button
                type="button"
                className="flex items-center gap-2 text-sm font-semibold text-secondary hover:text-brand"
                onClick={() => setAdvanced((value) => !value)}
              >
                <ChevronDown
                  aria-hidden="true"
                  className={cn("size-4 transition", advanced && "rotate-180")}
                />
                <span>
                  {copy.backup.advanced}
                  <span className="ml-2 text-xs font-normal text-muted">
                    {copy.backup.advancedHelp}
                  </span>
                </span>
              </button>
              {advanced ? (
                <div className="grid gap-4 rounded-md border border-border bg-surface p-4 sm:grid-cols-2">
                  <Input
                    label={copy.backup.basePath}
                    value={backup.basePath}
                    onChange={(event) => onChange({ basePath: event.target.value })}
                  />
                  {backup.targetType !== "LOCAL" ? (
                    <Input
                      label={copy.backup.secret}
                      type="password"
                      helperText={copy.backup.secretHint}
                      value={backup.secret ?? ""}
                      onChange={(event) => onChange({ secret: event.target.value })}
                    />
                  ) : null}
                </div>
              ) : null}
            </div>
          </>
        ) : (
          <Alert tone="info">{copy.backup.disabled}</Alert>
        )}
      </Card>
    </div>
  );
}

function ChannelCard({
  icon: Icon,
  title,
  description,
  enabled,
  children,
  onToggle,
}: {
  icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean | "true" }>;
  title: string;
  description: string;
  enabled: boolean;
  children?: React.ReactNode;
  onToggle: (enabled: boolean) => void;
}) {
  return (
    <Card className="overflow-hidden shadow-none">
      <div className="flex items-center gap-3 p-4">
        <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-md bg-blue-50 text-brand">
          <Icon aria-hidden="true" className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="font-semibold text-primary">{title}</h2>
          <p className="mt-1 text-xs leading-5 text-secondary">{description}</p>
        </div>
        <Switch
          aria-label={title}
          checked={enabled}
          onChange={(event) => onToggle(event.target.checked)}
        />
      </div>
      {enabled && children ? (
        <div className="grid gap-4 border-t border-border bg-surface p-4 sm:grid-cols-2">
          {children}
        </div>
      ) : null}
    </Card>
  );
}

function NotificationsStep({
  locale,
  notifications,
  routes,
  onChange,
  onRoutes,
}: {
  locale: SetupLocale;
  notifications: SetupCompleteInput["notifications"];
  routes: Record<string, NotificationChannelKey[]>;
  onChange: (next: SetupCompleteInput["notifications"]) => void;
  onRoutes: (next: Record<string, NotificationChannelKey[]>) => void;
}) {
  const copy = setupCopy[locale];
  const [advanced, setAdvanced] = React.useState(false);
  const enabledChannels = channelKeys.filter((key) =>
    key === "inApp" ? notifications.inApp : notifications[key].enabled,
  );
  const toggleChannel = (channel: (typeof channelKeys)[number], enabled: boolean) => {
    if (channel === "inApp") onChange({ ...notifications, inApp: enabled });
    else onChange({ ...notifications, [channel]: { ...notifications[channel], enabled } });
    const nextEnabled = channelKeys.filter((key) => {
      if (key === channel) return enabled;
      return key === "inApp" ? notifications.inApp : notifications[key].enabled;
    });
    onRoutes(
      Object.fromEntries(
        routeKeys.map((key) => [
          key,
          routes[key]?.filter((item) => nextEnabled.includes(item)).length
            ? routes[key]!.filter((item) => nextEnabled.includes(item))
            : nextEnabled,
        ]),
      ),
    );
  };
  return (
    <div className="space-y-6">
      <SetupTitle
        title={copy.notifications.title}
        description={copy.notifications.description}
        locale={locale}
        optional
      />
      <div className="space-y-3">
        <ChannelCard
          icon={Bell}
          title={copy.notifications.inApp}
          description={copy.notifications.inAppHelp}
          enabled={notifications.inApp}
          onToggle={(enabled) => toggleChannel("inApp", enabled)}
        />
        <ChannelCard
          icon={MessageSquare}
          title={copy.notifications.feishu}
          description={copy.notifications.feishuHelp}
          enabled={notifications.feishu.enabled}
          onToggle={(enabled) => toggleChannel("feishu", enabled)}
        >
          <Input
            label={copy.notifications.endpoint}
            type="url"
            value={notifications.feishu.endpoint}
            onChange={(event) =>
              onChange({
                ...notifications,
                feishu: { ...notifications.feishu, endpoint: event.target.value },
              })
            }
          />
          <Input
            label={copy.notifications.secret}
            type="password"
            value={notifications.feishu.secret ?? ""}
            onChange={(event) =>
              onChange({
                ...notifications,
                feishu: { ...notifications.feishu, secret: event.target.value },
              })
            }
          />
        </ChannelCard>
        <ChannelCard
          icon={Smartphone}
          title={copy.notifications.sms}
          description={copy.notifications.smsHelp}
          enabled={notifications.sms.enabled}
          onToggle={(enabled) => toggleChannel("sms", enabled)}
        >
          <Input
            label={copy.notifications.endpoint}
            type="url"
            value={notifications.sms.endpoint}
            onChange={(event) =>
              onChange({
                ...notifications,
                sms: { ...notifications.sms, endpoint: event.target.value },
              })
            }
          />
          <Input
            label={copy.notifications.secret}
            type="password"
            value={notifications.sms.secret ?? ""}
            onChange={(event) =>
              onChange({
                ...notifications,
                sms: { ...notifications.sms, secret: event.target.value },
              })
            }
          />
        </ChannelCard>
        <Card className="shadow-none">
          <button
            type="button"
            className="flex w-full items-center gap-3 p-4 text-left"
            onClick={() => setAdvanced((value) => !value)}
          >
            <ChevronDown
              aria-hidden="true"
              className={cn("size-4 transition", advanced && "rotate-180")}
            />
            <span>
              <span className="block text-sm font-semibold text-primary">
                {copy.notifications.advanced}
              </span>
              <span className="mt-1 block text-xs text-muted">
                {copy.notifications.advancedHelp}
              </span>
            </span>
          </button>
          {advanced ? (
            <div className="overflow-x-auto border-t border-border p-4">
              <table className="w-full min-w-[520px] text-sm">
                <thead>
                  <tr className="text-left text-xs text-muted">
                    <th className="pb-3 font-medium">{copy.notifications.routeEvent}</th>
                    <th className="pb-3 text-center font-medium">{copy.notifications.inApp}</th>
                    <th className="pb-3 text-center font-medium">{copy.notifications.feishu}</th>
                    <th className="pb-3 text-center font-medium">{copy.notifications.sms}</th>
                  </tr>
                </thead>
                <tbody>
                  {routeKeys.map((key, index) => (
                    <tr key={key} className="border-t border-border">
                      <td className="py-3 text-primary">{copy.notifications.events[index]}</td>
                      {channelKeys.map((channel) => {
                        const channelEnabled = enabledChannels.includes(channel);
                        return (
                          <td key={channel} className="py-3 text-center">
                            <input
                              type="checkbox"
                              className="size-4 accent-brand disabled:opacity-30"
                              disabled={!channelEnabled}
                              checked={routes[key]?.includes(channel) ?? false}
                              aria-label={`${copy.notifications.events[index]} — ${channel}`}
                              onChange={(event) => {
                                const current = routes[key] ?? [];
                                const next = event.target.checked
                                  ? [...new Set([...current, channel])]
                                  : current.filter((item) => item !== channel);
                                if (next.length) onRoutes({ ...routes, [key]: next });
                              }}
                            />
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-3 flex items-center gap-2 text-xs text-secondary">
                <Info aria-hidden="true" className="size-4" />
                {copy.notifications.routeHint}
              </p>
            </div>
          ) : null}
        </Card>
      </div>
    </div>
  );
}

function SummarySection({
  title,
  step,
  onEdit,
  children,
  locale,
}: {
  title: string;
  step: number;
  onEdit: (step: number) => void;
  children: React.ReactNode;
  locale: SetupLocale;
}) {
  return (
    <section className="border-b border-border py-4 first:pt-0 last:border-0 last:pb-0">
      <div className="mb-3 flex items-center justify-between gap-4">
        <h2 className="font-semibold text-primary">{title}</h2>
        <button
          type="button"
          className="inline-flex items-center gap-1 text-xs font-semibold text-brand hover:underline"
          onClick={() => onEdit(step)}
        >
          <Edit3 aria-hidden="true" className="size-3.5" />
          {setupCopy[locale].review.edit}
        </button>
      </div>
      <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[180px_minmax(0,1fr)]">
        {children}
      </dl>
    </section>
  );
}

function SummaryRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="text-secondary">{label}</dt>
      <dd className="min-w-0 font-medium text-primary">{children}</dd>
    </>
  );
}

function ReviewStep({
  locale,
  organizationName,
  timezone,
  storage,
  admin,
  templates,
  selected,
  backup,
  notifications,
  onEdit,
}: {
  locale: SetupLocale;
  organizationName: string;
  timezone: string;
  storage: SetupCompleteInput["storage"];
  admin: { displayName: string; email: string; requireTotp: boolean };
  templates: SetupTemplate[];
  selected: Set<string>;
  backup: SetupCompleteInput["backup"];
  notifications: SetupCompleteInput["notifications"];
  onEdit: (step: number) => void;
}) {
  const copy = setupCopy[locale];
  const picked = templates.filter((template) => selected.has(template.id));
  const qualifications = picked.reduce((sum, item) => sum + item.qualificationCount, 0);
  const channels = [
    ...(notifications.inApp ? [copy.notifications.inApp] : []),
    ...(notifications.feishu.enabled ? [copy.notifications.feishu] : []),
    ...(notifications.sms.enabled ? [copy.notifications.sms] : []),
  ];
  return (
    <div className="space-y-6">
      <SetupTitle title={copy.review.title} description={copy.review.description} locale={locale} />
      <Card className="p-4 sm:p-7">
        <SummarySection title={copy.review.storage} step={2} onEdit={onEdit} locale={locale}>
          <SummaryRow label={copy.review.storageMode}>
            {storage.mode === "builtin"
              ? copy.review.builtinStorage
              : `${copy.review.externalStorage} (${storage.bucket})`}
          </SummaryRow>
        </SummarySection>
        <SummarySection title={copy.review.admin} step={3} onEdit={onEdit} locale={locale}>
          <SummaryRow label={copy.review.name}>{admin.displayName}</SummaryRow>
          <SummaryRow label={copy.review.email}>{admin.email}</SummaryRow>
          <SummaryRow label={copy.review.totp}>
            {admin.requireTotp ? (
              <span className="text-success">✓ {copy.review.enabled}</span>
            ) : (
              <Badge>{copy.review.disabled}</Badge>
            )}
          </SummaryRow>
        </SummarySection>
        <SummarySection title={copy.review.positions} step={4} onEdit={onEdit} locale={locale}>
          <SummaryRow label={copy.review.selectedTemplates}>
            {picked.length
              ? picked.map((item) => templateLabel(item, locale)).join(", ")
              : copy.review.none}
          </SummaryRow>
          <SummaryRow label={copy.review.installedQualifications}>
            {picked.length ? copy.review.automaticRules(qualifications) : copy.review.none}
          </SummaryRow>
        </SummarySection>
        <SummarySection title={copy.review.backup} step={5} onEdit={onEdit} locale={locale}>
          <SummaryRow label={copy.review.backupStatus}>
            {backup.enabled ? copy.review.enabled : <Badge>{copy.review.disabled}</Badge>}
          </SummaryRow>
          {backup.enabled ? (
            <>
              <SummaryRow label={copy.review.backupTarget}>
                {backup.targetType} ({backup.endpoint}/{backup.basePath})
              </SummaryRow>
              <SummaryRow label={copy.review.backupFrequency}>{copy.review.dailyBackup}</SummaryRow>
            </>
          ) : null}
        </SummarySection>
        <SummarySection title={copy.review.notifications} step={6} onEdit={onEdit} locale={locale}>
          <SummaryRow label={copy.review.channels}>
            {channels.length ? channels.join(", ") : copy.review.none}
          </SummaryRow>
        </SummarySection>
        <SummarySection title={copy.review.system} step={1} onEdit={onEdit} locale={locale}>
          <SummaryRow label={copy.review.locale}>{setupCopy[locale].languageName}</SummaryRow>
          <SummaryRow label={copy.review.timezone}>{timezone}</SummaryRow>
          <SummaryRow label={copy.review.organization}>
            {organizationName || "CrewQual Organization"}
          </SummaryRow>
        </SummarySection>
      </Card>
    </div>
  );
}

function SuccessStep({
  locale,
  result,
  totpEnabled,
}: {
  locale: SetupLocale;
  result: SetupCompleteResult;
  totpEnabled: boolean;
}) {
  const copy = setupCopy[locale];
  const later = [
    ...(!result.backupEnabled ? [copy.review.backup] : []),
    ...(result.notificationChannels.length <= 1 ? [copy.success.notifications] : []),
  ];
  return (
    <main className="min-h-dvh bg-surface">
      <header className="flex h-[76px] items-center justify-between border-b border-border bg-card px-4 sm:px-8">
        <div>
          <ProductMark compact />
          <p className="mt-1 text-[10px] text-muted">{copy.productSubtitle}</p>
        </div>
        <span className="text-xs text-muted">
          {copy.wizardVersion} v{result.completed ? "2.1" : ""}
        </span>
      </header>
      <div className="mx-auto flex min-h-[calc(100dvh-76px)] max-w-[800px] flex-col items-center justify-center px-4 py-12 text-center">
        <span className="inline-flex size-20 items-center justify-center rounded-full bg-emerald-50 text-success ring-8 ring-emerald-50/60">
          <CheckCircle2 aria-hidden="true" className="size-10" />
        </span>
        <h1 className="mt-8 text-3xl font-bold text-primary">{copy.success.title}</h1>
        <p className="mt-2 text-sm text-secondary">{copy.success.description}</p>
        <div className="mt-8 grid w-full gap-4 text-left sm:grid-cols-2">
          <Card className="p-5 shadow-none">
            <h2 className="font-semibold text-primary">{copy.success.completed}</h2>
            <ul className="mt-4 space-y-3 text-sm text-secondary">
              {[
                copy.success.admin,
                copy.success.templates(result.installedTemplateCount),
                ...(result.backupEnabled ? [copy.success.backup] : []),
              ].map((item) => (
                <li key={item} className="flex items-center gap-2">
                  <CheckCircle2 aria-hidden="true" className="size-4 text-success" />
                  {item}
                </li>
              ))}
            </ul>
          </Card>
          <Card className="p-5 shadow-none">
            <h2 className="font-semibold text-primary">{copy.success.later}</h2>
            {later.length ? (
              <ul className="mt-4 space-y-3 text-sm text-secondary">
                {later.map((item) => (
                  <li key={item} className="flex items-center gap-2">
                    <CircleHelp aria-hidden="true" className="size-4 text-muted" />
                    {item}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-4 text-sm text-secondary">—</p>
            )}
          </Card>
        </div>
        {totpEnabled ? (
          <Alert tone="warning" className="mt-7 w-full text-left">
            {copy.success.security}
          </Alert>
        ) : null}
        <Link
          href="/admin/login"
          className="mt-7 inline-flex min-h-12 w-full max-w-[320px] items-center justify-center rounded-md bg-brand px-5 text-base font-semibold text-white shadow-card hover:bg-blue-600"
        >
          {copy.success.login}
        </Link>
        <Link
          href="/deployment"
          className="mt-3 inline-flex min-h-10 items-center text-sm font-semibold text-brand hover:underline"
        >
          {copy.success.docs}
        </Link>
      </div>
    </main>
  );
}

function SetupAuthorizationGate({
  locale,
  onAuthorized,
}: {
  locale: SetupLocale;
  onAuthorized: () => void;
}) {
  const copy = setupCopy[locale].authorization;
  const [code, setCode] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");

  const authorize = async () => {
    if (!/^\d{8}$/.test(code)) {
      setError(copy.required);
      return;
    }
    setBusy(true);
    setError("");
    try {
      await apiRequest<{ authorized: true }>("/api/setup/authorize", "POST", { code });
      onAuthorized();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Authorization failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="flex min-h-dvh items-center justify-center bg-surface px-4 py-8">
      <Card className="w-full max-w-lg space-y-6 p-6 sm:p-8">
        <div className="space-y-2">
          <h1 className="text-2xl font-bold tracking-tight text-primary">{copy.title}</h1>
          <p className="text-sm leading-6 text-secondary">{copy.description}</p>
        </div>
        <Input
          label={copy.code}
          placeholder={copy.placeholder}
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]{8}"
          maxLength={8}
          value={code}
          error={error}
          className="font-mono text-lg tracking-[0.35em]"
          onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 8))}
          onKeyDown={(event) => {
            if (event.key === "Enter") void authorize();
          }}
        />
        <Button type="button" className="w-full" loading={busy} onClick={() => void authorize()}>
          {busy ? copy.submitting : copy.submit}
        </Button>
      </Card>
    </main>
  );
}

export function SetupWizard({ initialOverview }: { initialOverview: SetupOverview }) {
  const [overview, setOverview] = React.useState(initialOverview);
  const [step, setStep] = React.useState(1);
  const [locale, setLocale] = React.useState<SetupLocale>(initialOverview.defaults.locale);
  const [timezone, setTimezone] = React.useState(initialOverview.defaults.timezone);
  const [organizationName, setOrganizationName] = React.useState(
    initialOverview.defaults.organizationName,
  );
  const [storage, setStorage] = React.useState<SetupCompleteInput["storage"]>({
    mode: "builtin",
  });
  const [admin, setAdmin] = React.useState({
    displayName: "",
    email: "",
    password: "",
    confirmPassword: "",
    requireTotp: true,
    totpSecret: "",
    totpUri: "",
    enrollmentToken: "",
    verifiedToken: "",
    totpCode: "",
  });
  const [adminErrors, setAdminErrors] = React.useState<SetupErrorMap>({});
  const [selectedTemplates, setSelectedTemplates] = React.useState<Set<string>>(new Set());
  const [backup, setBackup] = React.useState<SetupCompleteInput["backup"]>({
    enabled: true,
    targetName: setupCopy[initialOverview.defaults.locale].backup.defaultTargetName,
    targetType: "LOCAL",
    endpoint: "/backups",
    basePath: "crewqual",
    secret: "",
  });
  const [notifications, setNotifications] = React.useState<SetupCompleteInput["notifications"]>({
    inApp: true,
    feishu: { enabled: false, endpoint: "", secret: "" },
    sms: { enabled: false, endpoint: "", secret: "" },
  });
  const [routes, setRoutes] = React.useState<Record<string, NotificationChannelKey[]>>(
    Object.fromEntries(routeKeys.map((key) => [key, ["inApp"] as NotificationChannelKey[]])),
  );
  const [skipped, setSkipped] = React.useState<Set<number>>(new Set());
  const [checking, setChecking] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [backupResult, setBackupResult] = React.useState<{ ok: boolean; message: string } | null>(
    null,
  );
  const [storageResult, setStorageResult] = React.useState<{
    ok: boolean;
    message: string;
  } | null>(null);
  const [error, setError] = React.useState("");
  const [result, setResult] = React.useState<SetupCompleteResult | null>(null);
  const [authorized, setAuthorized] = React.useState(initialOverview.mode === "mock");
  const copy = setupCopy[locale];

  React.useEffect(() => {
    document.documentElement.lang = locale;
    const secure = window.location.protocol === "https:" ? "; Secure" : "";
    document.cookie = `${LOCALE_COOKIE}=${encodeURIComponent(locale)}; Max-Age=31536000; Path=/; SameSite=Lax${secure}`;
  }, [locale]);

  if (!authorized) {
    return <SetupAuthorizationGate locale={locale} onAuthorized={() => setAuthorized(true)} />;
  }

  const updateAdmin = (patch: Partial<typeof admin>) => {
    setAdmin((current) => ({ ...current, ...patch }));
    setAdminErrors({});
    setError("");
  };

  const recheck = async () => {
    setChecking(true);
    setError("");
    try {
      if (overview.mode === "mock") {
        await new Promise((resolve) => window.setTimeout(resolve, 450));
        setOverview({ ...overview });
      } else {
        setOverview(await apiRequest<SetupOverview>("/api/setup"));
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : copy.errors.request);
    } finally {
      setChecking(false);
    }
  };

  const generateTotp = async () => {
    const emailOk = /^\S+@\S+\.\S+$/.test(admin.email);
    if (!emailOk) {
      setAdminErrors({ email: copy.admin.invalidEmail });
      return;
    }
    setBusy(true);
    setError("");
    try {
      if (overview.mode === "mock") {
        await new Promise((resolve) => window.setTimeout(resolve, 350));
        updateAdmin({
          totpSecret: "JBSWY3DPEHPK3PXP",
          totpUri: `otpauth://totp/CrewQual:${encodeURIComponent(admin.email)}?secret=JBSWY3DPEHPK3PXP&issuer=CrewQual`,
          enrollmentToken: "mock-enrollment",
        });
      } else {
        const provisioned = await apiRequest<{
          secret: string;
          uri: string;
          enrollmentToken: string;
        }>("/api/setup/totp", "POST", { email: admin.email });
        updateAdmin({
          totpSecret: provisioned.secret,
          totpUri: provisioned.uri,
          enrollmentToken: provisioned.enrollmentToken,
        });
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : copy.errors.request);
    } finally {
      setBusy(false);
    }
  };

  const validateAdmin = async () => {
    const nextErrors: SetupErrorMap = {};
    if (!admin.displayName.trim()) nextErrors.name = copy.admin.nameRequired;
    if (!/^\S+@\S+\.\S+$/.test(admin.email)) nextErrors.email = copy.admin.invalidEmail;
    if (admin.password.length < 12) nextErrors.password = copy.admin.passwordShort;
    if (admin.confirmPassword !== admin.password) nextErrors.confirm = copy.admin.passwordMismatch;
    if (admin.requireTotp && (!admin.enrollmentToken || !/^\d{6}$/.test(admin.totpCode))) {
      nextErrors.totp = copy.admin.totpRequired;
    }
    if (Object.keys(nextErrors).length) {
      setAdminErrors(nextErrors);
      return false;
    }
    if (!admin.requireTotp) return true;
    setBusy(true);
    setError("");
    try {
      if (overview.mode === "mock") {
        await new Promise((resolve) => window.setTimeout(resolve, 350));
        updateAdmin({ verifiedToken: "mock-verified" });
      } else {
        const verified = await apiRequest<{ verifiedToken: string }>(
          "/api/setup/totp/verify",
          "POST",
          {
            email: admin.email,
            code: admin.totpCode,
            enrollmentToken: admin.enrollmentToken,
          },
        );
        updateAdmin({ verifiedToken: verified.verifiedToken });
      }
      return true;
    } catch (reason) {
      setAdminErrors({
        totp: reason instanceof Error ? reason.message : copy.admin.totpRequired,
      });
      return false;
    } finally {
      setBusy(false);
    }
  };

  const testBackup = async () => {
    setBusy(true);
    setBackupResult(null);
    try {
      if (overview.mode === "mock") {
        await new Promise((resolve) => window.setTimeout(resolve, 350));
        const ok = backup.targetType !== "LOCAL" || backup.endpoint.startsWith("/backups");
        setBackupResult({
          ok,
          message: ok ? copy.backup.valid : copy.backup.localPathError,
        });
      } else {
        setBackupResult(
          await apiRequest<{ ok: boolean; message: string }>("/api/setup/backup-test", "POST", {
            type: backup.targetType,
            endpoint: backup.endpoint,
            basePath: backup.basePath,
          }),
        );
      }
    } catch (reason) {
      setBackupResult({
        ok: false,
        message: reason instanceof Error ? reason.message : copy.errors.request,
      });
    } finally {
      setBusy(false);
    }
  };

  const testStorage = async () => {
    setBusy(true);
    setStorageResult(null);
    try {
      if (storage.mode === "s3") {
        if (
          !storage.endpoint.trim() ||
          !storage.region.trim() ||
          !storage.bucket.trim() ||
          !storage.accessKeyId.trim() ||
          !storage.secretAccessKey
        ) {
          setStorageResult({ ok: false, message: copy.storage.required });
          return false;
        }
      }
      if (overview.mode === "mock") {
        await new Promise((resolve) => window.setTimeout(resolve, 350));
        setStorageResult({ ok: true, message: copy.storage.valid });
      } else {
        setStorageResult(
          await apiRequest<{ ok: boolean; message: string }>(
            "/api/setup/storage-test",
            "POST",
            storage,
          ),
        );
      }
      return true;
    } catch (reason) {
      setStorageResult({
        ok: false,
        message: reason instanceof Error ? reason.message : copy.errors.request,
      });
      return false;
    } finally {
      setBusy(false);
    }
  };

  const goBack = () => {
    setError("");
    setStep((value) => Math.max(1, value - 1));
  };
  const goNext = async () => {
    setError("");
    if (step === 2 && !(await testStorage())) return;
    if (step === 3 && !(await validateAdmin())) return;
    if (
      step === 6 &&
      !notifications.inApp &&
      !notifications.feishu.enabled &&
      !notifications.sms.enabled
    ) {
      setError(copy.notifications.noChannel);
      return;
    }
    setSkipped((current) => {
      const next = new Set(current);
      next.delete(step);
      return next;
    });
    setStep((value) => Math.min(7, value + 1));
  };
  const skipStep = () => {
    setSkipped((current) => new Set(current).add(step));
    if (step === 4) setSelectedTemplates(new Set());
    if (step === 5) setBackup((current) => ({ ...current, enabled: false }));
    if (step === 6) {
      setNotifications((current) => ({
        ...current,
        inApp: true,
        feishu: { ...current.feishu, enabled: false },
        sms: { ...current.sms, enabled: false },
      }));
      setRoutes(
        Object.fromEntries(routeKeys.map((key) => [key, ["inApp"] as NotificationChannelKey[]])),
      );
    }
    setStep((value) => value + 1);
  };

  const complete = async () => {
    setBusy(true);
    setError("");
    const payload: SetupCompleteInput = {
      locale,
      timezone,
      organizationName,
      storage,
      admin: {
        displayName: admin.displayName.trim(),
        email: admin.email.trim().toLowerCase(),
        password: admin.password,
        requireTotp: admin.requireTotp,
        ...(admin.requireTotp ? { verifiedTotpToken: admin.verifiedToken } : {}),
      },
      templatePackIds: [...selectedTemplates],
      backup,
      notifications: {
        ...notifications,
        routes: routeKeys.map((key) => ({ key, channels: routes[key] ?? [] })),
      },
    };
    try {
      if (overview.mode === "mock") {
        await new Promise((resolve) => window.setTimeout(resolve, 850));
        setResult({
          completed: true,
          adminEmail: payload.admin.email,
          installedTemplateCount: payload.templatePackIds.length,
          installedPositionCount: payload.templatePackIds.length,
          storageMode: payload.storage.mode,
          backupEnabled: payload.backup.enabled,
          notificationChannels: [
            ...(payload.notifications.inApp ? ["inApp"] : []),
            ...(payload.notifications.feishu.enabled ? ["feishu"] : []),
            ...(payload.notifications.sms.enabled ? ["sms"] : []),
          ],
        });
      } else {
        setResult(await apiRequest<SetupCompleteResult>("/api/setup/complete", "POST", payload));
      }
      setStep(8);
      setAdmin((current) => ({
        ...current,
        password: "",
        confirmPassword: "",
        enrollmentToken: "",
        verifiedToken: "",
        totpCode: "",
      }));
    } catch (reason) {
      const currentError = reason as Error & { code?: string };
      if (currentError.code === "SETUP_ALREADY_COMPLETED") {
        setError(copy.errors.alreadyComplete);
        window.setTimeout(() => window.location.assign("/admin/login"), 1200);
      } else {
        setError(currentError.message || copy.errors.setup);
      }
    } finally {
      setBusy(false);
    }
  };

  if (step === 8 && result) {
    return <SuccessStep locale={locale} result={result} totpEnabled={admin.requireTotp} />;
  }

  let content: React.ReactNode;
  if (step === 1) {
    content = (
      <WelcomeStep
        overview={overview}
        locale={locale}
        timezone={timezone}
        organizationName={organizationName}
        checking={checking}
        onLocale={setLocale}
        onTimezone={setTimezone}
        onOrganization={setOrganizationName}
        onRecheck={() => void recheck()}
      />
    );
  } else if (step === 2) {
    content = (
      <StorageStep
        locale={locale}
        storage={storage}
        busy={busy}
        testResult={storageResult}
        onChange={(next) => {
          setStorage(next);
          setStorageResult(null);
        }}
        onTest={() => void testStorage()}
      />
    );
  } else if (step === 3) {
    content = (
      <AdminStep
        locale={locale}
        admin={admin}
        errors={adminErrors}
        busy={busy}
        onChange={updateAdmin}
        onGenerateTotp={() => void generateTotp()}
      />
    );
  } else if (step === 4) {
    content = (
      <PositionsStep
        locale={locale}
        templates={overview.templates}
        selected={selectedTemplates}
        onToggle={(id) =>
          setSelectedTemplates((current) => {
            const next = new Set(current);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
          })
        }
      />
    );
  } else if (step === 5) {
    content = (
      <BackupStep
        locale={locale}
        backup={backup}
        busy={busy}
        testResult={backupResult}
        onChange={(patch) => {
          setBackup((current) => ({ ...current, ...patch }));
          setBackupResult(null);
        }}
        onTest={() => void testBackup()}
      />
    );
  } else if (step === 6) {
    content = (
      <NotificationsStep
        locale={locale}
        notifications={notifications}
        routes={routes}
        onChange={setNotifications}
        onRoutes={setRoutes}
      />
    );
  } else {
    content = (
      <ReviewStep
        locale={locale}
        organizationName={organizationName}
        timezone={timezone}
        storage={storage}
        admin={admin}
        templates={overview.templates}
        selected={selectedTemplates}
        backup={backup}
        notifications={notifications}
        onEdit={setStep}
      />
    );
  }

  const optional = step >= 4 && step <= 6;
  const primaryLabel =
    step === 1
      ? copy.welcome.start
      : step === 3
        ? admin.requireTotp
          ? copy.admin.verify
          : copy.admin.save
        : step === 7
          ? copy.review.finish
          : copy.continue;
  const primaryDisabled = step === 1 && overview.environment.database === "error";

  return (
    <SetupShell
      step={step}
      locale={locale}
      skipped={skipped}
      version={overview.environment.version}
      actions={
        <ActionBar
          left={
            step > 1 ? (
              <Button type="button" variant="secondary" onClick={goBack} disabled={busy}>
                {copy.back}
              </Button>
            ) : undefined
          }
          right={
            <>
              {optional ? (
                <Button type="button" variant="ghost" onClick={skipStep} disabled={busy}>
                  {copy.later}
                </Button>
              ) : null}
              <Button
                type="button"
                loading={busy}
                disabled={primaryDisabled}
                onClick={() => (step === 7 ? void complete() : void goNext())}
                className="min-w-24"
              >
                {step === 7 && !busy ? <Check aria-hidden="true" className="size-4" /> : null}
                {busy && step === 7 ? copy.review.finishing : primaryLabel}
              </Button>
            </>
          }
        />
      }
    >
      {error ? (
        <Alert tone="danger" title={copy.errors.setup} className="mb-6">
          {error}
        </Alert>
      ) : null}
      {content}
    </SetupShell>
  );
}

"use client";

import * as React from "react";
import { History, KeyRound, Laptop, LogOut, RefreshCw, ShieldCheck } from "lucide-react";
import {
  SettingsSectionHeader,
  formatSettingsDate,
  type SettingsFeedback,
} from "@/components/admin/settings/settings-shared";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { isRemoteServiceMode } from "@/lib/service-mode";
import {
  adminSettingsService,
  isSecurityRiskSummaryComplete,
} from "@/services/admin-settings-service";
import { useAdminSession } from "@/services/admin-session-provider";
import { useI18n } from "@/components/i18n-provider";
import { localizeError } from "@/lib/error-i18n";
import type {
  AdminLoginMode,
  AuthenticationPreset,
  SecurityPolicy,
  SettingsAuditItem,
  SettingsSectionId,
  SettingsSession,
  SecurityRiskRange,
  SecurityRiskCategory,
  SecurityRiskSummary,
  SecurityRiskDetectionPage,
} from "@/types/admin-settings";

const riskCategories: SecurityRiskCategory[] = [
  "PUBLIC_SCAN",
  "CREDENTIAL_STUFFING",
  "DISTRIBUTED_LOGIN_ATTEMPT",
];
const riskRuleKeys = new Set([
  "KNOWN_PROBE",
  "PATH_ENUMERATION",
  "MULTI_ACCOUNT_FAILURE",
  "MULTI_SOURCE_FAILURE",
]);
const riskLineStyles = [
  { className: "text-brand", dash: undefined },
  { className: "text-warning", dash: "8 4" },
  { className: "text-secondary", dash: "2 4" },
];

/** Missing buckets are zero only when the server confirms complete collection. */
export function securityTrendRows(summary: SecurityRiskSummary) {
  const step = Math.max(60, summary.trendBucketSeconds) * 1000;
  const start = Math.floor(Date.parse(summary.since) / step) * step;
  const end = Date.parse(summary.until);
  const count = Math.max(0, Math.min(750, Math.ceil((end - start) / step)));
  const known = new Map(summary.trend.map((point) => [Date.parse(point.bucketStart), point]));
  const complete = isSecurityRiskSummaryComplete(summary);
  return Array.from({ length: count }, (_, index) => {
    const time = start + index * step;
    const point = known.get(time);
    return {
      bucketStart: new Date(time).toISOString(),
      requests: point?.requests ?? (complete ? 0 : null),
      categories: Object.fromEntries(
        riskCategories.map((category) => [
          category,
          point?.categories[category] ?? (complete ? 0 : null),
        ]),
      ) as Record<SecurityRiskCategory, number | null>,
    };
  });
}

function SecurityRiskTrend({ summary }: { summary: SecurityRiskSummary }) {
  const { locale, t } = useI18n();
  const rows = securityTrendRows(summary);
  const maximum = Math.max(
    1,
    ...rows.flatMap((row) => riskCategories.map((category) => row.categories[category] ?? 0)),
  );
  const x = (index: number) => 36 + (index / Math.max(1, rows.length - 1)) * 548;
  const y = (value: number) => 136 - (value / maximum) * 116;
  const number = new Intl.NumberFormat(locale);
  return (
    <div className="space-y-3">
      <h4 className="font-semibold">{t("securityRisk.trend")}</h4>
      <p className="text-sm leading-6 text-secondary">{t("securityRisk.trendDescription")}</p>
      {rows.length > 0 ? (
        <>
          <svg
            viewBox="0 0 608 164"
            className="w-full rounded-md border border-border bg-card"
            role="img"
            aria-label={t("securityRisk.trend")}
          >
            <title>{t("securityRisk.trend")}</title>
            <path d="M36 16V136H584" fill="none" stroke="currentColor" className="text-muted" />
            <text
              x="30"
              y="24"
              textAnchor="end"
              fill="currentColor"
              className="text-secondary"
              fontSize="12"
            >
              {number.format(maximum)}
            </text>
            <text
              x="30"
              y="140"
              textAnchor="end"
              fill="currentColor"
              className="text-secondary"
              fontSize="12"
            >
              0
            </text>
            {riskCategories.map((category, categoryIndex) => {
              let nextMove = true;
              const path = rows
                .map((row, index) => {
                  const value = row.categories[category];
                  if (value === null) {
                    nextMove = true;
                    return "";
                  }
                  const command = `${nextMove ? "M" : "L"}${x(index)},${y(value)}`;
                  nextMove = false;
                  return command;
                })
                .join(" ");
              return (
                <g key={category} className={riskLineStyles[categoryIndex].className}>
                  <path
                    d={path}
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeDasharray={riskLineStyles[categoryIndex].dash}
                  />
                  {rows.map((row, index) =>
                    row.categories[category] === null ? null : (
                      <circle
                        key={row.bucketStart}
                        cx={x(index)}
                        cy={y(row.categories[category]!)}
                        r="2"
                        fill="currentColor"
                      />
                    ),
                  )}
                </g>
              );
            })}
          </svg>
          <div className="flex flex-wrap justify-between gap-2 text-xs text-secondary">
            <span>{formatSettingsDate(rows[0].bucketStart, locale)}</span>
            <span>{formatSettingsDate(rows[rows.length - 1].bucketStart, locale)}</span>
          </div>
          <ul className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
            {riskCategories.map((category, index) => (
              <li key={category} className="flex items-center gap-2">
                <svg
                  aria-hidden="true"
                  viewBox="0 0 28 8"
                  className={`h-2 w-7 ${riskLineStyles[index].className}`}
                >
                  <path
                    d="M0 4H28"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeDasharray={riskLineStyles[index].dash}
                  />
                </svg>
                {t(`securityRisk.${category}`)}
              </li>
            ))}
          </ul>
        </>
      ) : null}
      <details className="rounded-md border border-border p-3">
        <summary className="cursor-pointer rounded py-1 text-sm font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand">
          {t("securityRisk.trendTable")}
        </summary>
        <div
          className="mt-3 max-h-80 overflow-auto"
          tabIndex={0}
          role="region"
          aria-label={t("securityRisk.trendTable")}
        >
          <table className="w-full min-w-[600px] border-collapse text-left text-sm">
            <caption className="sr-only">{t("securityRisk.trendDescription")}</caption>
            <thead>
              <tr className="border-b border-border">
                <th scope="col" className="p-2">
                  {t("securityRisk.time")}
                </th>
                <th scope="col" className="p-2">
                  {t("securityRisk.requests")}
                </th>
                {riskCategories.map((category) => (
                  <th key={category} scope="col" className="p-2">
                    {t(`securityRisk.${category}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.bucketStart} className="border-b border-border">
                  <th scope="row" className="whitespace-nowrap p-2 font-normal">
                    {formatSettingsDate(row.bucketStart, locale)}
                  </th>
                  <td className="p-2 tabular-nums">
                    {row.requests === null ? "—" : number.format(row.requests)}
                  </td>
                  {riskCategories.map((category) => (
                    <td key={category} className="p-2 tabular-nums">
                      {row.categories[category] === null
                        ? "—"
                        : number.format(row.categories[category]!)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}

/** Read-only global statistics, independent of permission to change security settings. */
export function SecurityRiskStatistics() {
  const { locale, t } = useI18n();
  const { hasPermission } = useAdminSession();
  const canRead = hasPermission("audit.read");
  const [range, setRange] = React.useState<SecurityRiskRange>("24h");
  const [page, setPage] = React.useState(1);
  const [refresh, setRefresh] = React.useState(0);
  const [summary, setSummary] = React.useState<SecurityRiskSummary | null>(null);
  const [detections, setDetections] = React.useState<SecurityRiskDetectionPage | null>(null);
  const [totalPages, setTotalPages] = React.useState(0);
  const [summaryError, setSummaryError] = React.useState(false);
  const [detectionsError, setDetectionsError] = React.useState(false);
  React.useEffect(() => {
    if (!canRead) return;
    let stale = false;
    setSummary(null);
    setSummaryError(false);
    void adminSettingsService
      .loadSecurityTrends(range)
      .then((data) => {
        if (!stale) setSummary(data);
      })
      .catch(() => {
        if (!stale) setSummaryError(true);
      });
    return () => {
      stale = true;
    };
  }, [canRead, range, refresh]);
  React.useEffect(() => {
    if (!canRead) return;
    let stale = false;
    setDetections(null);
    setDetectionsError(false);
    void adminSettingsService
      .loadSecurityDetections(range, page)
      .then((data) => {
        if (!stale) {
          setDetections(data);
          setTotalPages(data.totalPages);
        }
      })
      .catch(() => {
        if (!stale) setDetectionsError(true);
      });
    return () => {
      stale = true;
    };
  }, [canRead, range, page, refresh]);
  if (!canRead) return null;
  const complete = summary ? isSecurityRiskSummaryComplete(summary) : false;
  const format = (value: number | null | undefined) =>
    value == null || (!complete && value === 0) ? "—" : new Intl.NumberFormat(locale).format(value);
  const loading = !summary && !summaryError;
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <h3 className="font-bold">{t("securityRisk.title")}</h3>
            <p className="mt-1 text-sm leading-6 text-secondary">{t("securityRisk.description")}</p>
          </div>
          <Button
            type="button"
            variant="secondary"
            onClick={() => setRefresh((value) => value + 1)}
            disabled={loading}
          >
            <RefreshCw aria-hidden="true" className="size-4" />
            {t("securityRisk.refresh")}
          </Button>
        </div>
        <div className="mt-3 max-w-xs">
          <Select
            label={t("securityRisk.range")}
            value={range}
            onChange={(event) => {
              setPage(1);
              setTotalPages(0);
              setRange(event.target.value as SecurityRiskRange);
            }}
            options={(["24h", "7d", "30d"] as const).map((value) => ({
              value,
              label: t(`securityRisk.range${value}`),
            }))}
          />
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        {!isRemoteServiceMode() ? <Alert tone="info">{t("securityRisk.preview")}</Alert> : null}
        {loading ? (
          <p role="status" className="text-sm text-secondary">
            {t("common.loading")}
          </p>
        ) : null}
        {summaryError ? <Alert tone="warning">{t("securityRisk.loadError")}</Alert> : null}
        {summary ? (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Badge tone={complete ? "success" : "warning"}>
                {t(complete ? "securityRisk.complete" : "securityRisk.incomplete")}
              </Badge>
              <span className="text-xs text-secondary">
                {t("securityRisk.lastAggregated", {
                  time: formatSettingsDate(summary.lastAggregatedAt, locale),
                })}
              </span>
            </div>
            <p className="text-xs leading-5 text-secondary">
              {t("securityRisk.period", {
                since: formatSettingsDate(summary.since, locale),
                until: formatSettingsDate(summary.until, locale),
              })}
            </p>
            {!summary.collectionHealthy && isRemoteServiceMode() ? (
              <Alert tone="warning">{t("securityRisk.collectionError")}</Alert>
            ) : null}
            {summary.delayed ? <Alert tone="warning">{t("securityRisk.delayed")}</Alert> : null}
            {summary.droppedCount > 0 ? (
              <Alert tone="warning">
                {t("securityRisk.overflow", { count: summary.droppedCount })}
              </Alert>
            ) : null}
          </>
        ) : null}
        <dl className="grid gap-3 sm:grid-cols-3">
          {(
            [
              ["batches", summary?.batches],
              ["requests", summary?.requests],
              ["sources", summary?.sources],
            ] as const
          ).map(([key, value]) => (
            <div key={key} className="rounded-md border border-border p-4">
              <dt className="text-sm text-secondary">{t(`securityRisk.${key}`)}</dt>
              <dd className="mt-2 text-2xl font-semibold tabular-nums">
                {key === "sources" && summary?.sources === null ? (
                  <span className="text-base">{t("securityRisk.segmented")}</span>
                ) : (
                  format(value)
                )}
              </dd>
            </div>
          ))}
        </dl>
        {summary ? (
          <>
            {summary.keyRotation ? (
              <Alert tone="info">
                <p>{t("securityRisk.keyRotation")}</p>
                <ul className="mt-2 space-y-1">
                  {Object.entries(summary.sourceSegments).map(([version, count]) => (
                    <li key={version}>{t("securityRisk.sourceSegment", { version, count })}</li>
                  ))}
                </ul>
              </Alert>
            ) : null}
            {summary.unknownSourceRequests > 0 ? (
              <p className="text-sm text-secondary">
                {t("securityRisk.unknownSources", { count: summary.unknownSourceRequests })}
              </p>
            ) : null}
            {!complete ? (
              <p className="text-sm text-secondary">{t("securityRisk.observedOnly")}</p>
            ) : summary.requests === 0 ? (
              <p className="text-sm text-secondary">{t("securityRisk.empty")}</p>
            ) : null}
            <SecurityRiskTrend summary={summary} />
          </>
        ) : null}
        <div className="space-y-3 border-t border-border pt-5">
          <h4 className="font-semibold">{t("securityRisk.detectedBatches")}</h4>
          <p className="text-xs leading-5 text-secondary">{t("securityRisk.batchScope")}</p>
          {!detections && !detectionsError ? (
            <p role="status" className="text-sm text-secondary">
              {t("common.loading")}
            </p>
          ) : null}
          {detectionsError ? (
            <Alert tone="warning">{t("securityRisk.detectionsError")}</Alert>
          ) : null}
          <ul className="space-y-3">
            {detections?.items.map((item) => (
              <li key={item.id} className="space-y-2 rounded-md border border-border p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h5 className="font-semibold">{t(`securityRisk.${item.category}`)}</h5>
                  <Badge>
                    {t("common.ruleVersion")} {item.ruleVersion}
                  </Badge>
                </div>
                <p className="text-xs text-secondary">
                  {t("securityRisk.batchRange", {
                    since: formatSettingsDate(item.windowStart, locale),
                    until: formatSettingsDate(item.windowEnd, locale),
                  })}
                </p>
                <p className="text-sm">
                  {t("securityRisk.batchMetrics", {
                    requests: item.requestCount,
                    sources: item.sourceCount,
                    accounts: item.accountCount,
                    paths: item.pathCount,
                  })}
                </p>
                <ul className="space-y-1 text-sm text-secondary">
                  {item.sample.rules.map((rule) => (
                    <li key={rule}>
                      {t(
                        riskRuleKeys.has(rule)
                          ? `securityRisk.rule_${rule}`
                          : "securityRisk.ruleUnknown",
                      )}
                    </li>
                  ))}
                </ul>
                <p className="break-words text-sm text-secondary">
                  {t("securityRisk.maskedSources", {
                    sources:
                      item.sample.maskedSources
                        .map((value) =>
                          value === "来源不可判定" ? t("securityRisk.sourceUnknown") : value,
                        )
                        .join(", ") || t("securityRisk.sourceUnknown"),
                  })}
                </p>
                {item.accounts?.length ? (
                  <ul className="space-y-1 text-sm text-secondary">
                    {item.accounts.map((account, index) => (
                      <li key={`${account.label}-${index}`} className="break-all">
                        {t("securityRisk.accountCount", {
                          label: account.label,
                          count: account.count,
                        })}{" "}
                        {account.masked ? (
                          <span className="text-xs">· {t("securityRisk.maskedAccount")}</span>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                ) : null}
                {item.truncatedByRetention ? (
                  <Badge tone="neutral">{t("securityRisk.retentionTruncated")}</Badge>
                ) : null}
                {item.sample.successfulLoginAfterAttack ? (
                  <p className="text-sm text-warning">{t("securityRisk.combinedRisk")}</p>
                ) : null}
              </li>
            ))}
          </ul>
          {detections?.items.length === 0 && complete ? (
            <p className="text-sm text-secondary">{t("securityRisk.noDetails")}</p>
          ) : null}
          {totalPages > 0 ? (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-secondary">
                {t("common.pageLabel", { page, pages: totalPages })}
              </p>
              <div className="flex gap-2">
                <Button
                  variant="secondary"
                  type="button"
                  disabled={page <= 1 || !detections}
                  onClick={() => setPage((value) => value - 1)}
                >
                  {t("common.previousPage")}
                </Button>
                <Button
                  variant="secondary"
                  type="button"
                  disabled={page >= totalPages || !detections}
                  onClick={() => setPage((value) => value + 1)}
                >
                  {t("common.nextPage")}
                </Button>
              </div>
            </div>
          ) : null}
        </div>
        <p className="text-xs leading-5 text-secondary">{t("securityRisk.scope")}</p>
      </CardContent>
    </Card>
  );
}

export function SecuritySettingsSection({
  policy,
  sessions,
  audit,
  canWrite,
  onPolicyChange,
  onSessionsChange,
  notify,
}: {
  policy: SecurityPolicy;
  sessions: SettingsSession[];
  audit: SettingsAuditItem[];
  canWrite: boolean;
  onPolicyChange: (policy: SecurityPolicy) => void;
  onSessionsChange: (sessions: SettingsSession[]) => void;
  notify: SettingsFeedback;
}) {
  const { t } = useI18n();
  const loginModeOptions: Array<{ label: string; value: AdminLoginMode }> = [
    { label: t("settingsSecurity.passwordTotp"), value: "PASSWORD_TOTP" },
    { label: t("settingsSecurity.totpOnly"), value: "TOTP_ONLY" },
    { label: t("settingsSecurity.passwordOnly"), value: "PASSWORD_ONLY" },
  ];
  const presetOptions: Array<{ label: string; value: AuthenticationPreset }> = [
    { label: "增强认证：ASVS L3／等保三级身份鉴别", value: "ENHANCED_L3" },
    { label: "组合认证：ASVS L2／等保三级身份鉴别", value: "COMBINED_L2" },
    { label: "便捷认证（推荐）", value: "CONVENIENCE" },
  ];
  const auditSectionOptions: Array<{ label: string; value: "all" | SettingsSectionId }> = [
    { label: t("settingsSecurity.allAreas"), value: "all" },
    { label: t("settingsOrg.title"), value: "organization" },
    { label: t("settingsAccount.title"), value: "admins" },
    { label: t("settingsNotify.title"), value: "notifications" },
    { label: t("settings.ai.title"), value: "ai" },
    { label: t("settingsSecurity.title"), value: "security" },
  ];
  const [draft, setDraft] = React.useState(policy);
  const [saving, setSaving] = React.useState(false);
  const [sessionTarget, setSessionTarget] = React.useState<SettingsSession | null>(null);
  const [revoking, setRevoking] = React.useState(false);
  const [auditSection, setAuditSection] = React.useState<"all" | SettingsSectionId>("all");
  const [auditQuery, setAuditQuery] = React.useState("");
  const [credentialDialogOpen, setCredentialDialogOpen] = React.useState(false);
  const [currentPassword, setCurrentPassword] = React.useState("");
  const [currentTotpCode, setCurrentTotpCode] = React.useState("");
  const [bindingFido, setBindingFido] = React.useState(false);

  React.useEffect(() => setDraft(policy), [policy]);

  const persist = async (credentials?: {
    currentPassword?: string;
    currentTotpCode?: string;
    currentFidoChallengeId?: string;
    currentFidoResponse?: unknown;
  }) => {
    setSaving(true);
    try {
      const saved = await adminSettingsService.saveSecurity({ ...draft, ...credentials });
      onPolicyChange(saved.policy);
      setDraft(saved.policy);
      setCredentialDialogOpen(false);
      setCurrentPassword("");
      setCurrentTotpCode("");
      if (saved.reauthenticate && isRemoteServiceMode()) {
        notify("success", t("settingsSecurity.saveSuccess"), t("settingsSecurity.reauthRemote"));
        const loginUrl = `${saved.policy.appOrigin}/admin/login?reason=security-policy-changed`;
        window.setTimeout(
          () => window.location.assign(loginUrl),
          draft.appPort !== policy.appPort ? 4000 : 0,
        );
        return;
      }
      notify(
        "success",
        t("settingsSecurity.saveSuccess"),
        saved.reauthenticate ? t("settingsSecurity.reauthDemo") : t("settingsSecurity.applied"),
      );
    } catch (reason) {
      notify("danger", t("settingsSecurity.saveError"), localizeError(reason, t));
    } finally {
      setSaving(false);
    }
  };

  const save = async () => {
    if (
      draft.adminSessionTtlHours < 1 ||
      draft.pilotAccessLinkTtlMinutes < 5 ||
      draft.pilotSessionTtlMinutes < 15 ||
      draft.maxFailedAttempts < 3 ||
      draft.lockoutMinutes < 5
    ) {
      notify(
        "danger",
        t("settingsSecurity.invalidPolicy"),
        t("settingsSecurity.invalidPolicyHelp"),
      );
      return;
    }
    if (
      draft.adminLoginMode !== policy.adminLoginMode ||
      draft.authenticationPreset !== policy.authenticationPreset ||
      draft.memberLoginMode !== policy.memberLoginMode ||
      draft.adminFido2Required !== policy.adminFido2Required ||
      draft.memberFido2Required !== policy.memberFido2Required ||
      draft.highRiskReauthEnabled !== policy.highRiskReauthEnabled ||
      draft.allowPublicAccess !== policy.allowPublicAccess ||
      draft.appPort !== policy.appPort
    ) {
      setCredentialDialogOpen(true);
      return;
    }
    await persist();
  };

  const confirmModeChange = async () => {
    let fido: { challengeId: string; response: unknown } | undefined;
    if (policy.adminFido2Required) {
      try {
        const sessionResponse = await fetch("/api/admin/session", {
          credentials: "include",
          cache: "no-store",
        });
        const sessionPayload = (await sessionResponse.json().catch(() => ({}))) as {
          data?: { email?: string };
          error?: { message?: string };
        };
        if (!sessionResponse.ok || !sessionPayload.data?.email)
          throw new Error(sessionPayload.error?.message ?? "无法读取当前管理员身份");
        const optionsResponse = await fetch("/api/admin/login/fido-options", {
          method: "POST",
          credentials: "include",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ email: sessionPayload.data.email }),
        });
        const optionsPayload = (await optionsResponse.json().catch(() => ({}))) as {
          data?: { challengeId?: string; [key: string]: unknown };
          error?: { message?: string };
        };
        if (!optionsResponse.ok || !optionsPayload.data?.challengeId)
          throw new Error(optionsPayload.error?.message ?? "无法开始硬件验证");
        const { startAuthentication } = await import("@simplewebauthn/browser");
        fido = {
          challengeId: optionsPayload.data.challengeId,
          response: await startAuthentication({ optionsJSON: optionsPayload.data as never }),
        };
      } catch (reason) {
        notify("danger", "硬件验证失败", reason instanceof Error ? reason.message : "请重试");
        return;
      }
    }
    await persist({
      ...(policy.adminLoginMode !== "TOTP_ONLY" ? { currentPassword } : {}),
      ...(policy.adminLoginMode !== "PASSWORD_ONLY" ? { currentTotpCode } : {}),
      ...(fido
        ? { currentFidoChallengeId: fido.challengeId, currentFidoResponse: fido.response }
        : {}),
    });
  };

  const bindFido = async () => {
    setBindingFido(true);
    try {
      const csrf = decodeURIComponent(
        document.cookie
          .split("; ")
          .find((item) => item.startsWith("crewqual_admin_session_csrf="))
          ?.slice("crewqual_admin_session_csrf=".length) ?? "",
      );
      const headers = { "content-type": "application/json", "x-csrf-token": csrf };
      const optionsResponse = await fetch("/api/admin/security/fido", {
        method: "POST",
        credentials: "include",
        headers,
        body: JSON.stringify({ action: "options" }),
      });
      const optionsPayload = (await optionsResponse.json()) as {
        data?: { challengeId?: string; [key: string]: unknown };
        error?: { message?: string };
      };
      if (!optionsResponse.ok || !optionsPayload.data)
        throw new Error(optionsPayload.error?.message ?? "无法开始 FIDO2 注册");
      if (!optionsPayload.data.challengeId) throw new Error("FIDO2 注册挑战缺失，请重试");
      const { startRegistration } = await import("@simplewebauthn/browser");
      const response = await startRegistration({ optionsJSON: optionsPayload.data as never });
      const verifyResponse = await fetch("/api/admin/security/fido", {
        method: "POST",
        credentials: "include",
        headers,
        body: JSON.stringify({
          action: "verify",
          challengeId: optionsPayload.data.challengeId,
          response,
          label: "管理员硬件验证器",
        }),
      });
      const verifyPayload = (await verifyResponse.json()) as { error?: { message?: string } };
      if (!verifyResponse.ok) throw new Error(verifyPayload.error?.message ?? "FIDO2 注册失败");
      notify("success", "FIDO2 验证器已绑定", "之后可用于增强认证和高敏操作再次验证");
    } catch (reason) {
      notify("danger", "FIDO2 注册失败", reason instanceof Error ? reason.message : "请重试");
    } finally {
      setBindingFido(false);
    }
  };

  const revoke = async () => {
    if (!sessionTarget) return;
    setRevoking(true);
    try {
      await adminSettingsService.revokeSession(sessionTarget.id);
      onSessionsChange(sessions.filter((item) => item.id !== sessionTarget.id));
      setSessionTarget(null);
      notify("success", t("settingsSecurity.sessionEnded"), t("settingsSecurity.sessionEndedHelp"));
    } catch (reason) {
      notify("danger", t("settingsSecurity.endError"), localizeError(reason, t));
    } finally {
      setRevoking(false);
    }
  };

  const filteredAudit = audit.filter((item) => {
    const matchesSection = auditSection === "all" || item.section === auditSection;
    const matchesQuery = `${item.actor}${item.action}${item.unitName}${item.summary}`
      .toLowerCase()
      .includes(auditQuery.trim().toLowerCase());
    return matchesSection && matchesQuery;
  });

  return (
    <section className="space-y-5" aria-labelledby="security-settings-title">
      <SettingsSectionHeader
        title={t("settingsSecurity.title")}
        description={t("settingsSecurity.description")}
      />

      {!canWrite ? <Alert tone="info">{t("settingsSecurity.readonly")}</Alert> : null}

      <SecurityRiskStatistics />

      <Card>
        <CardHeader>
          <div className="flex items-start gap-3">
            <span className="inline-flex size-10 items-center justify-center rounded-md bg-emerald-50 text-success">
              <ShieldCheck aria-hidden="true" className="size-5" />
            </span>
            <div>
              <h3 className="font-bold">{t("settingsSecurity.global")}</h3>
              <p className="mt-1 text-xs text-muted">{t("settingsSecurity.globalDescription")}</p>
            </div>
          </div>
          <div className="rounded-md border border-amber-200 bg-amber-50 p-3">
            <label className="flex items-start gap-3 text-sm">
              <input
                type="checkbox"
                className="mt-1 size-4"
                checked={draft.allowPublicAccess}
                disabled={!canWrite}
                onChange={(event) =>
                  setDraft({ ...draft, allowPublicAccess: event.target.checked })
                }
              />
              <span>
                <span className="font-semibold">{t("settingsSecurity.publicAccess")}</span>
                <span className="mt-1 block text-xs text-muted">
                  {t("settingsSecurity.publicAccessHelp")}
                </span>
              </span>
            </label>
          </div>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="rounded-md border border-border p-3">
            <Select
              label="认证目标"
              options={presetOptions}
              value={draft.authenticationPreset}
              disabled={!canWrite}
              onChange={(event) => {
                const preset = event.target.value as AuthenticationPreset;
                const defaults =
                  preset === "ENHANCED_L3"
                    ? {
                        adminLoginMode: "PASSWORD_TOTP" as const,
                        memberLoginMode: "PASSWORD_TOTP" as const,
                        adminFido2Required: true,
                        memberFido2Required: true,
                      }
                    : preset === "COMBINED_L2"
                      ? {
                          adminLoginMode: "PASSWORD_TOTP" as const,
                          memberLoginMode: "PASSWORD_TOTP" as const,
                          adminFido2Required: false,
                          memberFido2Required: false,
                        }
                      : {
                          adminLoginMode: "PASSWORD_TOTP" as const,
                          memberLoginMode: "SMS_LINK" as const,
                          adminFido2Required: false,
                          memberFido2Required: false,
                        };
                setDraft({ ...draft, authenticationPreset: preset, ...defaults });
              }}
            />
            <p className="mt-2 text-xs text-muted">
              认证目标只配置身份鉴别方式；整体符合性仍需完成其他适用条款的验收。
            </p>
            {draft.memberLoginMode === "SMS_LINK" ? (
              <Alert tone="warning" className="mt-3">
                成员将使用单因素登录，不满足 ASVS L2／等保三级的组合认证要求。其他安全措施仍然有效。
              </Alert>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border p-3">
            <div>
              <p className="font-semibold">FIDO2 硬件验证器</p>
              <p className="mt-1 text-xs text-muted">
                支持 Yubico Security Key C NFC 等安全钥匙；需要 HTTPS。
              </p>
            </div>
            <Button
              type="button"
              variant="secondary"
              disabled={!canWrite}
              loading={bindingFido}
              onClick={() => void bindFido()}
            >
              <KeyRound aria-hidden="true" className="size-4" />
              绑定硬件验证器
            </Button>
          </div>
          <div className="rounded-md border border-border p-3">
            <Select
              label={t("settingsSecurity.loginMode")}
              options={loginModeOptions}
              value={draft.adminLoginMode}
              disabled={!canWrite}
              onChange={(event) =>
                setDraft({ ...draft, adminLoginMode: event.target.value as AdminLoginMode })
              }
            />
            <p className="mt-2 text-xs text-muted">{t("settingsSecurity.modeHelp")}</p>
            {draft.adminLoginMode === "PASSWORD_ONLY" ? (
              <Alert tone="warning" className="mt-3">
                关闭后将使用单因素登录，不满足 ASVS
                L2／等保三级的组合认证要求。其他安全措施仍然有效。
              </Alert>
            ) : null}
          </div>
          <div className="rounded-md border border-border p-3">
            <label className="flex items-start gap-3 text-sm">
              <input
                type="checkbox"
                className="mt-1 size-4"
                checked={draft.highRiskReauthEnabled}
                disabled={!canWrite}
                onChange={(event) =>
                  setDraft({ ...draft, highRiskReauthEnabled: event.target.checked })
                }
              />
              <span>
                <span className="font-semibold">高敏操作要求再次认证</span>
                <span className="mt-1 block text-xs text-muted">
                  默认开启；关闭后高敏操作不再要求附加认证，不满足 ASVS
                  L2／等保三级相关要求。其他安全措施仍然有效。
                </span>
              </span>
            </label>
          </div>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            <Input
              label={t("settingsSecurity.networkPort")}
              type="number"
              min={1}
              max={65535}
              value={draft.appPort}
              disabled={!canWrite}
              onChange={(event) => setDraft({ ...draft, appPort: Number(event.target.value) })}
            />
            <Input
              label={t("settingsSecurity.adminTtl")}
              type="number"
              min={1}
              max={72}
              value={draft.adminSessionTtlHours}
              disabled={!canWrite}
              onChange={(event) =>
                setDraft({ ...draft, adminSessionTtlHours: Number(event.target.value) })
              }
            />
            <Input
              label={t("settingsSecurity.linkTtl")}
              type="number"
              min={5}
              max={60}
              value={draft.pilotAccessLinkTtlMinutes}
              disabled={!canWrite}
              onChange={(event) =>
                setDraft({ ...draft, pilotAccessLinkTtlMinutes: Number(event.target.value) })
              }
            />
            <Input
              label={t("settingsSecurity.pilotTtl")}
              type="number"
              min={15}
              max={480}
              value={draft.pilotSessionTtlMinutes}
              disabled={!canWrite}
              onChange={(event) =>
                setDraft({ ...draft, pilotSessionTtlMinutes: Number(event.target.value) })
              }
            />
            <Input
              label={t("settingsSecurity.failedAttempts")}
              type="number"
              min={3}
              max={20}
              value={draft.maxFailedAttempts}
              disabled={!canWrite}
              onChange={(event) =>
                setDraft({ ...draft, maxFailedAttempts: Number(event.target.value) })
              }
            />
            <Input
              label={t("settingsSecurity.lockout")}
              type="number"
              min={5}
              max={1440}
              value={draft.lockoutMinutes}
              disabled={!canWrite}
              onChange={(event) =>
                setDraft({ ...draft, lockoutMinutes: Number(event.target.value) })
              }
            />
          </div>
          {canWrite ? (
            <div className="flex justify-end">
              <Button type="button" loading={saving} onClick={() => void save()}>
                {t("settingsSecurity.savePolicy")}
              </Button>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Dialog open={credentialDialogOpen} onOpenChange={setCredentialDialogOpen}>
        <DialogContent aria-describedby="security-mode-confirmation-description">
          <DialogTitle className="text-lg font-bold">
            {t("settingsSecurity.modeConfirmTitle")}
          </DialogTitle>
          <DialogDescription
            id="security-mode-confirmation-description"
            className="mt-1 text-sm text-secondary"
          >
            {t("settingsSecurity.modeConfirmDescription")}
          </DialogDescription>
          <div className="mt-5 space-y-4">
            {policy.adminLoginMode !== "TOTP_ONLY" ? (
              <Input
                label={t("settingsSecurity.currentPassword")}
                type="password"
                autoComplete="current-password"
                value={currentPassword}
                onChange={(event) => setCurrentPassword(event.target.value)}
                required
              />
            ) : null}
            {policy.adminLoginMode !== "PASSWORD_ONLY" ? (
              <Input
                label={t("settingsSecurity.currentTotp")}
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]{6}"
                maxLength={6}
                value={currentTotpCode}
                onChange={(event) => setCurrentTotpCode(event.target.value)}
                required
              />
            ) : null}
            {policy.adminFido2Required ? (
              <Alert tone="info">当前增强认证要求在确认前使用已绑定的 FIDO2 硬件安全钥匙。</Alert>
            ) : null}
          </div>
          <div className="mt-6 flex justify-end gap-3">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setCredentialDialogOpen(false)}
            >
              {t("settingsSecurity.cancel")}
            </Button>
            <Button type="button" loading={saving} onClick={() => void confirmModeChange()}>
              {t("settingsSecurity.confirmSwitch")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Card>
        <CardHeader>
          <div>
            <h3 className="font-bold">{t("settingsSecurity.sessions")}</h3>
            <p className="mt-1 text-xs text-muted">{t("settingsSecurity.sessionsDescription")}</p>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {sessions.map((session) => (
            <div
              key={session.id}
              className="flex flex-wrap items-center gap-3 rounded-md border border-border p-4"
            >
              <span className="inline-flex size-10 items-center justify-center rounded-md bg-slate-100 text-secondary">
                <Laptop aria-hidden="true" className="size-5" />
              </span>
              <div className="min-w-[180px] flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-semibold">{session.adminName}</p>
                  {session.current ? (
                    <Badge tone="success">{t("settingsSecurity.currentSession")}</Badge>
                  ) : null}
                </div>
                <p className="mt-1 text-xs text-muted">
                  {session.browser} · {session.maskedIp}
                </p>
              </div>
              <dl className="grid grid-cols-2 gap-x-5 gap-y-1 text-xs text-secondary">
                <div>
                  <dt className="text-muted">{t("settingsSecurity.login")}</dt>
                  <dd>{formatSettingsDate(session.createdAt)}</dd>
                </div>
                <div>
                  <dt className="text-muted">{t("settingsSecurity.recentActivity")}</dt>
                  <dd>{formatSettingsDate(session.lastSeenAt)}</dd>
                </div>
              </dl>
              {!session.current && canWrite ? (
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  onClick={() => setSessionTarget(session)}
                >
                  <LogOut aria-hidden="true" className="size-4" />
                  {t("settingsSecurity.endSession")}
                </Button>
              ) : null}
            </div>
          ))}
          {!sessions.length ? (
            <p className="py-8 text-center text-sm text-muted">
              {t("settingsSecurity.noSessions")}
            </p>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-start gap-3">
            <History aria-hidden="true" className="mt-0.5 size-5 text-secondary" />
            <div>
              <h3 className="font-bold">{t("settingsSecurity.audit")}</h3>
              <p className="mt-1 text-xs text-muted">{t("settingsSecurity.auditDescription")}</p>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_220px]">
            <Input
              aria-label={t("settingsSecurity.searchAudit")}
              placeholder={t("settingsSecurity.searchPlaceholder")}
              value={auditQuery}
              onChange={(event) => setAuditQuery(event.target.value)}
            />
            <Select
              aria-label={t("settingsSecurity.filterAudit")}
              options={auditSectionOptions}
              value={auditSection}
              onChange={(event) => setAuditSection(event.target.value as "all" | SettingsSectionId)}
            />
          </div>
          <div className="space-y-2">
            {filteredAudit.map((item) => (
              <div key={item.id} className="rounded-md border border-border p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="font-semibold">{item.action}</p>
                    <p className="mt-1 text-xs text-muted">
                      {item.actor} · {item.unitName}
                    </p>
                  </div>
                  <time className="text-xs text-muted">{formatSettingsDate(item.occurredAt)}</time>
                </div>
                <p className="mt-3 text-sm leading-6 text-secondary">{item.summary}</p>
              </div>
            ))}
            {!filteredAudit.length ? (
              <p className="py-8 text-center text-sm text-muted">{t("settingsSecurity.noAudit")}</p>
            ) : null}
          </div>
        </CardContent>
      </Card>

      <Dialog
        open={Boolean(sessionTarget)}
        onOpenChange={(open) => !open && setSessionTarget(null)}
      >
        <DialogContent aria-describedby="revoke-session-description">
          <DialogTitle className="text-lg font-bold">{t("settingsSecurity.endTitle")}</DialogTitle>
          <DialogDescription
            id="revoke-session-description"
            className="mt-2 text-sm leading-6 text-secondary"
          >
            {sessionTarget
              ? t("settingsSecurity.endDescription", {
                  name: sessionTarget.adminName,
                  browser: sessionTarget.browser,
                })
              : null}
          </DialogDescription>
          <Alert tone="warning" className="mt-4">
            {t("settingsSecurity.endWarning")}
          </Alert>
          <div className="mt-6 flex justify-end gap-3">
            <Button type="button" variant="secondary" onClick={() => setSessionTarget(null)}>
              {t("settingsSecurity.cancel")}
            </Button>
            <Button type="button" variant="danger" loading={revoking} onClick={() => void revoke()}>
              {t("settingsSecurity.confirmEnd")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </section>
  );
}

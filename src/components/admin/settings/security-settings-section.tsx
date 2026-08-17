"use client";

import * as React from "react";
import { History, Laptop, LogOut, ShieldCheck } from "lucide-react";
import {
  SettingsSectionHeader,
  formatSettingsDate,
  type SettingsFeedback,
} from "@/components/admin/settings/settings-shared";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Switch } from "@/components/ui/choice";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { adminSettingsService } from "@/services/admin-settings-service";
import type {
  SecurityPolicy,
  SettingsAuditItem,
  SettingsSectionId,
  SettingsSession,
} from "@/types/admin-settings";

const auditSectionOptions: Array<{ label: string; value: "all" | SettingsSectionId }> = [
  { label: "全部功能区", value: "all" },
  { label: "组织与单位", value: "organization" },
  { label: "管理员与权限", value: "admins" },
  { label: "通知设置", value: "notifications" },
  { label: "AI 与系统集成", value: "ai" },
  { label: "安全与审计", value: "security" },
];

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
  const [draft, setDraft] = React.useState(policy);
  const [saving, setSaving] = React.useState(false);
  const [sessionTarget, setSessionTarget] = React.useState<SettingsSession | null>(null);
  const [revoking, setRevoking] = React.useState(false);
  const [auditSection, setAuditSection] = React.useState<"all" | SettingsSectionId>("all");
  const [auditQuery, setAuditQuery] = React.useState("");

  React.useEffect(() => setDraft(policy), [policy]);

  const save = async () => {
    if (
      draft.adminSessionTtlHours < 1 ||
      draft.pilotAccessLinkTtlMinutes < 5 ||
      draft.pilotSessionTtlMinutes < 15 ||
      draft.maxFailedAttempts < 3 ||
      draft.lockoutMinutes < 5
    ) {
      notify("danger", "安全策略无法保存", "请检查会话时长、失败次数和锁定时间的最小值。 ");
      return;
    }
    setSaving(true);
    try {
      const saved = await adminSettingsService.saveSecurity(draft);
      onPolicyChange(saved);
      setDraft(saved);
      notify("success", "安全策略已保存", "新策略将应用于之后创建的会话和访问链接。 ");
    } catch (reason) {
      notify("danger", "安全策略保存失败", reason instanceof Error ? reason.message : "请稍后重试");
    } finally {
      setSaving(false);
    }
  };

  const revoke = async () => {
    if (!sessionTarget) return;
    setRevoking(true);
    try {
      await adminSettingsService.revokeSession(sessionTarget.id);
      onSessionsChange(sessions.filter((item) => item.id !== sessionTarget.id));
      setSessionTarget(null);
      notify("success", "管理员会话已结束", "该设备需要重新登录后才能访问系统。 ");
    } catch (reason) {
      notify("danger", "结束会话失败", reason instanceof Error ? reason.message : "请稍后重试");
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
        title="安全与审计"
        description="控制双重验证、会话和登录锁定策略，并追踪所有系统设置变更。"
      />

      {!canWrite ? (
        <Alert tone="info">
          当前角色可以查看安全状态，但不能修改全局安全策略或结束其他管理员会话。
        </Alert>
      ) : null}

      <Card>
        <CardHeader>
          <div className="flex items-start gap-3">
            <span className="inline-flex size-10 items-center justify-center rounded-md bg-emerald-50 text-success">
              <ShieldCheck aria-hidden="true" className="size-5" />
            </span>
            <div>
              <h3 className="font-bold">全局安全策略</h3>
              <p className="mt-1 text-xs text-muted">修改后不会延长或缩短已经签发的会话。</p>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="rounded-md border border-border p-3">
            <Switch
              label="强制管理员启用双重验证"
              checked={draft.requireTotp}
              disabled={!canWrite}
              onChange={(event) => setDraft({ ...draft, requireTotp: event.target.checked })}
              helperText="未完成绑定的账号不能进入管理端。"
            />
          </div>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            <Input
              label="管理员会话有效期（小时）"
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
              label="飞行员访问链接（分钟）"
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
              label="飞行员访问会话（分钟）"
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
              label="连续失败锁定次数"
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
              label="账号锁定时长（分钟）"
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
                保存安全策略
              </Button>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div>
            <h3 className="font-bold">活跃管理员会话</h3>
            <p className="mt-1 text-xs text-muted">IP 地址经过脱敏，仅用于识别异常登录。</p>
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
                  {session.current ? <Badge tone="success">当前会话</Badge> : null}
                </div>
                <p className="mt-1 text-xs text-muted">
                  {session.browser} · {session.maskedIp}
                </p>
              </div>
              <dl className="grid grid-cols-2 gap-x-5 gap-y-1 text-xs text-secondary">
                <div>
                  <dt className="text-muted">登录</dt>
                  <dd>{formatSettingsDate(session.createdAt)}</dd>
                </div>
                <div>
                  <dt className="text-muted">最近活动</dt>
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
                  结束会话
                </Button>
              ) : null}
            </div>
          ))}
          {!sessions.length ? (
            <p className="py-8 text-center text-sm text-muted">暂无活跃管理员会话</p>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-start gap-3">
            <History aria-hidden="true" className="mt-0.5 size-5 text-secondary" />
            <div>
              <h3 className="font-bold">设置审计记录</h3>
              <p className="mt-1 text-xs text-muted">密钥、密码和完整 Token 不会写入审计详情。</p>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_220px]">
            <Input
              aria-label="搜索审计记录"
              placeholder="搜索操作者、单位或变更摘要"
              value={auditQuery}
              onChange={(event) => setAuditQuery(event.target.value)}
            />
            <Select
              aria-label="筛选审计功能区"
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
              <p className="py-8 text-center text-sm text-muted">没有符合条件的审计记录</p>
            ) : null}
          </div>
        </CardContent>
      </Card>

      <Dialog
        open={Boolean(sessionTarget)}
        onOpenChange={(open) => !open && setSessionTarget(null)}
      >
        <DialogContent aria-describedby="revoke-session-description">
          <DialogTitle className="text-lg font-bold">结束管理员会话</DialogTitle>
          <DialogDescription
            id="revoke-session-description"
            className="mt-2 text-sm leading-6 text-secondary"
          >
            {sessionTarget
              ? `${sessionTarget.adminName} 在 ${sessionTarget.browser} 上的会话将立即失效。`
              : null}
          </DialogDescription>
          <Alert tone="warning" className="mt-4">
            该操作无法撤销，对方需要重新登录。
          </Alert>
          <div className="mt-6 flex justify-end gap-3">
            <Button type="button" variant="secondary" onClick={() => setSessionTarget(null)}>
              取消
            </Button>
            <Button type="button" variant="danger" loading={revoking} onClick={() => void revoke()}>
              确认结束会话
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </section>
  );
}

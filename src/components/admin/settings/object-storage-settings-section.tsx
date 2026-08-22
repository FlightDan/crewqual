"use client";

import * as React from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/choice";
import { Input } from "@/components/ui/input";
import { useI18n } from "@/components/i18n-provider";
import {
  ConnectionBadge,
  SettingsSectionHeader,
  type SettingsFeedback,
} from "@/components/admin/settings/settings-shared";

type StorageSnapshot = {
  mode: "builtin" | "s3";
  endpoint: string;
  region: string;
  bucket: string;
  forcePathStyle: boolean;
  sseKmsKeyId: string;
  credentialsConfigured: boolean;
  status: "ok" | "unconfigured" | "unavailable";
  evidenceCount: number;
  locationLocked: boolean;
  version: number;
  lastTestAt: string | null;
  lastTestMessage: string;
};

type Draft = {
  mode: "builtin" | "s3";
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
  sseKmsKeyId: string;
};

type ApiEnvelope<T> = { data?: T; error?: { message?: string } };

async function request<T>(method: "GET" | "POST" | "PATCH", body?: unknown) {
  const response = await fetch("/api/admin/settings/storage", {
    method,
    credentials: "include",
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = (await response.json()) as ApiEnvelope<T>;
  if (!response.ok || !payload.data) throw new Error(payload.error?.message ?? "Request failed");
  return payload.data;
}

function toDraft(value: StorageSnapshot): Draft {
  return {
    mode: value.mode,
    endpoint: value.endpoint || "https://s3.example.com",
    region: value.region || "us-east-1",
    bucket: value.bucket || "crewqual-private",
    accessKeyId: "",
    secretAccessKey: "",
    forcePathStyle: value.forcePathStyle,
    sseKmsKeyId: value.sseKmsKeyId,
  };
}

export function ObjectStorageSettingsSection({
  canWrite,
  notify,
}: {
  canWrite: boolean;
  notify: SettingsFeedback;
}) {
  const { t } = useI18n();
  const [snapshot, setSnapshot] = React.useState<StorageSnapshot | null>(null);
  const [draft, setDraft] = React.useState<Draft | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");

  React.useEffect(() => {
    void request<StorageSnapshot>("GET")
      .then((value) => {
        setSnapshot(value);
        setDraft(toDraft(value));
      })
      .catch((reason) =>
        setError(reason instanceof Error ? reason.message : t("settings.loadFailed")),
      );
  }, [t]);

  const payload = React.useCallback(() => {
    if (!draft) return null;
    return draft.mode === "builtin"
      ? { mode: "builtin" as const }
      : {
          mode: "s3" as const,
          endpoint: draft.endpoint,
          region: draft.region,
          bucket: draft.bucket,
          accessKeyId: draft.accessKeyId,
          secretAccessKey: draft.secretAccessKey,
          forcePathStyle: draft.forcePathStyle,
          sseKmsKeyId: draft.sseKmsKeyId,
        };
  }, [draft]);

  const test = async () => {
    const input = payload();
    if (!input) return;
    const testInput =
      input.mode === "s3" &&
      snapshot?.credentialsConfigured &&
      !input.accessKeyId &&
      !input.secretAccessKey &&
      input.endpoint === snapshot.endpoint &&
      input.region === snapshot.region &&
      input.bucket === snapshot.bucket &&
      input.forcePathStyle === snapshot.forcePathStyle &&
      input.sseKmsKeyId === snapshot.sseKmsKeyId
        ? { mode: "current" as const }
        : input;
    setBusy(true);
    setError("");
    try {
      const result = await request<{ ok: true; message: string }>("POST", testInput);
      notify("success", t("settings.storage.testPassed"), result.message);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("settings.storage.testFailed"));
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    const input = payload();
    if (!input || !snapshot) return;
    setBusy(true);
    setError("");
    try {
      const value = await request<StorageSnapshot>("PATCH", {
        storage: input,
        expectedVersion: snapshot.version,
      });
      setSnapshot(value);
      setDraft(toDraft(value));
      notify("success", t("settings.storage.saved"));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("settings.storage.saveFailed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      <SettingsSectionHeader
        title={t("settings.section.storage")}
        description={t("settings.section.storageDescription")}
        action={
          snapshot ? (
            <ConnectionBadge
              status={
                snapshot.status === "ok"
                  ? "connected"
                  : snapshot.status === "unavailable"
                    ? "error"
                    : "unconfigured"
              }
            />
          ) : undefined
        }
      />
      {error ? <Alert tone="danger">{error}</Alert> : null}
      {snapshot?.locationLocked ? (
        <Alert tone="warning">
          {t("settings.storage.locationLocked").replace("{count}", String(snapshot.evidenceCount))}
        </Alert>
      ) : null}
      {draft ? (
        <Card>
          <CardContent className="space-y-5 p-5 sm:p-7">
            <Switch
              checked={draft.mode === "s3"}
              disabled={!canWrite || Boolean(snapshot?.locationLocked)}
              label={t("settings.storage.external")}
              onChange={(event) =>
                setDraft({ ...draft, mode: event.target.checked ? "s3" : "builtin" })
              }
            />
            {draft.mode === "builtin" ? (
              <Alert tone="info">{t("settings.storage.builtinHelp")}</Alert>
            ) : (
              <div className="grid gap-4 md:grid-cols-2">
                <Input
                  label={t("settings.storage.endpoint")}
                  disabled={!canWrite || Boolean(snapshot?.locationLocked)}
                  value={draft.endpoint}
                  onChange={(event) => setDraft({ ...draft, endpoint: event.target.value })}
                />
                <Input
                  label={t("settings.storage.region")}
                  disabled={!canWrite}
                  value={draft.region}
                  onChange={(event) => setDraft({ ...draft, region: event.target.value })}
                />
                <Input
                  label={t("settings.storage.bucket")}
                  disabled={!canWrite || Boolean(snapshot?.locationLocked)}
                  value={draft.bucket}
                  onChange={(event) => setDraft({ ...draft, bucket: event.target.value })}
                />
                <Input
                  label={t("settings.storage.accessKey")}
                  disabled={!canWrite}
                  autoComplete="off"
                  value={draft.accessKeyId}
                  onChange={(event) => setDraft({ ...draft, accessKeyId: event.target.value })}
                />
                <Input
                  label={t("settings.storage.secretKey")}
                  disabled={!canWrite}
                  type="password"
                  autoComplete="new-password"
                  value={draft.secretAccessKey}
                  onChange={(event) => setDraft({ ...draft, secretAccessKey: event.target.value })}
                />
                <Input
                  label={t("settings.storage.kmsKey")}
                  disabled={!canWrite}
                  value={draft.sseKmsKeyId}
                  onChange={(event) => setDraft({ ...draft, sseKmsKeyId: event.target.value })}
                />
                <Switch
                  checked={draft.forcePathStyle}
                  disabled={!canWrite}
                  label={t("settings.storage.pathStyle")}
                  onChange={(event) => setDraft({ ...draft, forcePathStyle: event.target.checked })}
                />
              </div>
            )}
            {snapshot?.credentialsConfigured && draft.mode === "s3" ? (
              <p className="text-xs text-muted">{t("settings.storage.credentialsHint")}</p>
            ) : null}
            <div className="flex flex-wrap gap-3">
              <Button
                variant="secondary"
                disabled={!canWrite}
                loading={busy}
                onClick={() => void test()}
              >
                {t("settings.storage.test")}
              </Button>
              <Button disabled={!canWrite} loading={busy} onClick={() => void save()}>
                {t("settings.storage.save")}
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

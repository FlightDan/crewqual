export type UpdateMode = "managed" | "manual";
export type UpdatePhase =
  | "IDLE"
  | "CHECKING"
  | "PREFLIGHT"
  | "DOWNLOADING"
  | "BACKING_UP"
  | "MIGRATING"
  | "RESTARTING"
  | "HEALTH_CHECKING"
  | "SUCCEEDED"
  | "ROLLED_BACK"
  | "FAILED"
  | "NEEDS_MANUAL_RECOVERY";

export type UpdateJobStatus = {
  id: string;
  requestedVersion: string;
  currentVersion: string;
  phase: UpdatePhase;
  progress: number;
  message: string;
  errorCode: string | null;
  backupPath: string | null;
  startedAt: string | null;
  completedAt: string | null;
  actor: string | null;
};

export type SystemUpdateSnapshot = {
  mode: UpdateMode;
  currentVersion: string;
  latestVersion: string | null;
  releaseNotesUrl: string | null;
  releasePublishedAt: string | null;
  releaseChannel: "stable" | "unknown";
  canInstall: boolean;
  reason: string | null;
  updaterVersion: string | null;
  agentAvailable: boolean;
  job: UpdateJobStatus | null;
};

export type NetworkJobStatus = {
  id: string;
  phase: "STAGING" | "RESTARTING" | "HEALTH_CHECKING" | "SUCCEEDED" | "ROLLED_BACK" | "FAILED";
  progress: number;
  message: string;
  errorCode: string | null;
  startedAt: string | null;
  completedAt: string | null;
  actor: string | null;
  targetUrl: string | null;
};

export type NetworkApplyInput = {
  mode: "lan" | "tls";
  origin: string;
  domain: string;
  tlsEmail: string;
  port: number;
  siteAddress: string;
  appBind: string;
  acmeBind: string;
  acmePort: number;
  actor: string;
};

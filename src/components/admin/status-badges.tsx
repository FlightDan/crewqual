"use client";

import { Badge } from "@/components/ui/badge";
import { useI18n } from "@/components/i18n-provider";
import type {
  PilotHealth,
  ReviewAiStatus,
  ReviewHumanStatus,
  UpgradeStageStatus,
} from "@/types/services";

const humanStatusMap = {
  pending: { tone: "warning" },
  approved: { tone: "success" },
  returned: { tone: "danger" },
} as const;

const aiStatusMap = {
  matched: { tone: "success" },
  question: { tone: "warning" },
  mismatch: { tone: "danger" },
  unavailable: { tone: "neutral" },
} as const;

const healthMap = {
  unconfigured: { tone: "neutral" },
  normal: { tone: "success" },
  expiring: { tone: "warning" },
  expired: { tone: "danger" },
} as const;

const upgradeStatusMap = {
  completed: { tone: "success" },
  in_progress: { tone: "info" },
  delayed: { tone: "danger" },
  scheduled: { tone: "warning" },
  not_started: { tone: "neutral" },
} as const;

export function ReviewStatusBadge({ status }: { status: ReviewHumanStatus }) {
  const config = humanStatusMap[status];
  const { t } = useI18n();
  return <Badge tone={config.tone}>{t(`status.review.${status}`)}</Badge>;
}

export function AiResultBadge({ status }: { status: ReviewAiStatus }) {
  const config = aiStatusMap[status];
  const { t } = useI18n();
  return <Badge tone={config.tone}>{t(`status.ai.${status}`)}</Badge>;
}

export function PilotHealthBadge({ health }: { health: PilotHealth }) {
  const config = healthMap[health];
  const { t } = useI18n();
  return <Badge tone={config.tone}>{t(`status.health.${health}`)}</Badge>;
}

export function UpgradeStageBadge({ status }: { status: UpgradeStageStatus }) {
  const config = upgradeStatusMap[status];
  const { t } = useI18n();
  return <Badge tone={config.tone}>{t(`status.upgrade.${status}`)}</Badge>;
}

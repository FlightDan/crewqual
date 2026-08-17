import { Badge } from "@/components/ui/badge";
import type {
  PilotHealth,
  ReviewAiStatus,
  ReviewHumanStatus,
  UpgradeStageStatus,
} from "@/types/services";

const humanStatusMap = {
  pending: { label: "待审核", tone: "warning" },
  approved: { label: "已通过", tone: "success" },
  returned: { label: "已退回", tone: "danger" },
} as const;

const aiStatusMap = {
  matched: { label: "匹配通过", tone: "success" },
  question: { label: "存在疑问", tone: "warning" },
  mismatch: { label: "信息不一致", tone: "danger" },
  unavailable: { label: "不可用", tone: "neutral" },
} as const;

const healthMap = {
  unconfigured: { label: "未建档", tone: "neutral" },
  normal: { label: "正常", tone: "success" },
  expiring: { label: "临期", tone: "warning" },
  expired: { label: "存在过期", tone: "danger" },
} as const;

const upgradeStatusMap = {
  completed: { label: "已通过", tone: "success" },
  in_progress: { label: "进行中", tone: "info" },
  delayed: { label: "已延期", tone: "danger" },
  scheduled: { label: "待安排", tone: "warning" },
  not_started: { label: "未开始", tone: "neutral" },
} as const;

export function ReviewStatusBadge({ status }: { status: ReviewHumanStatus }) {
  const config = humanStatusMap[status];
  return <Badge tone={config.tone}>{config.label}</Badge>;
}

export function AiResultBadge({ status }: { status: ReviewAiStatus }) {
  const config = aiStatusMap[status];
  return <Badge tone={config.tone}>{config.label}</Badge>;
}

export function PilotHealthBadge({ health }: { health: PilotHealth }) {
  const config = healthMap[health];
  return <Badge tone={config.tone}>{config.label}</Badge>;
}

export function UpgradeStageBadge({ status }: { status: UpgradeStageStatus }) {
  const config = upgradeStatusMap[status];
  return <Badge tone={config.tone}>{config.label}</Badge>;
}

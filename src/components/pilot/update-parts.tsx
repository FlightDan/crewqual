"use client";

import * as React from "react";
import ReactCrop, { type Crop, type PixelCrop } from "react-image-crop";
import "react-image-crop/dist/ReactCrop.css";
import {
  BrainCircuit,
  Camera,
  Check,
  CircleAlert,
  FileImage,
  Info,
  Loader2,
  RefreshCw,
  TriangleAlert,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import type {
  DateCandidate,
  DateFieldName,
  DateFieldSource,
  DocumentAssistState,
} from "@/types/services";
import { processImageToJpeg, readImageSize } from "@/lib/image-processing";

export function ImageCropDialog({
  file,
  open,
  onOpenChange,
  onConfirm,
}: {
  file: File | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (blob: Blob) => void;
}) {
  const [sourceUrl, setSourceUrl] = React.useState("");
  const [crop, setCrop] = React.useState<Crop>({ unit: "%", x: 0, y: 0, width: 100, height: 100 });
  const [pixelCrop, setPixelCrop] = React.useState<PixelCrop | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");
  const imageSize = React.useRef({ width: 1, height: 1 });

  React.useEffect(() => {
    if (!file || !open) return;
    const nextUrl = typeof URL.createObjectURL === "function" ? URL.createObjectURL(file) : "";
    setSourceUrl(nextUrl);
    setCrop({ unit: "%", x: 0, y: 0, width: 100, height: 100 });
    setPixelCrop(null);
    setError("");
    return () => {
      if (nextUrl && typeof URL.revokeObjectURL === "function") URL.revokeObjectURL(nextUrl);
    };
  }, [file, open]);

  const confirm = async () => {
    if (!file || !pixelCrop) return;
    setBusy(true);
    setError("");
    try {
      const cropPixels = {
        x: (crop.x / 100) * imageSize.current.width,
        y: (crop.y / 100) * imageSize.current.height,
        width: (crop.width / 100) * imageSize.current.width,
        height: (crop.height / 100) * imageSize.current.height,
      };
      onConfirm(await processImageToJpeg(file, cropPixels));
      onOpenChange(false);
    } catch {
      setError("读取或压缩图片失败，请转换为 JPEG/PNG 后重试");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogTitle>裁切证照图片</DialogTitle>
        <DialogDescription>
          默认选中整张图片。确认后会校正方向、压缩为 JPEG 并上传。
        </DialogDescription>
        {sourceUrl ? (
          <div className="max-h-[55vh] overflow-auto rounded-lg bg-slate-100 p-2">
            <ReactCrop
              crop={crop}
              onChange={setCrop}
              onComplete={setPixelCrop}
              className="mx-auto max-h-[50vh] w-fit"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={sourceUrl}
                alt="待裁切凭证"
                onLoad={async () => {
                  imageSize.current = await readImageSize(file!);
                  setPixelCrop({
                    unit: "px",
                    x: 0,
                    y: 0,
                    width: imageSize.current.width,
                    height: imageSize.current.height,
                  });
                }}
                className="max-h-[50vh] max-w-full"
              />
            </ReactCrop>
          </div>
        ) : null}
        {error ? (
          <p role="alert" className="text-xs text-danger">
            {error}
          </p>
        ) : null}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button
            type="button"
            onClick={() => void confirm()}
            disabled={busy || !pixelCrop}
            loading={busy}
          >
            确认裁切并上传
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function UpdateSteps({ active }: { active: 1 | 2 | 3 }) {
  return (
    <ol
      aria-label="更新进度"
      className="-mx-4 flex items-center justify-between border-y border-border bg-card px-4 py-3 text-xs"
    >
      {["上传凭证", "手动填写", "审核并提交"].map((label, index) => {
        const number = (index + 1) as 1 | 2 | 3;
        return (
          <li
            key={label}
            aria-current={active === number ? "step" : undefined}
            className={cn(
              "flex items-center gap-1 whitespace-nowrap",
              active === number ? "font-bold text-brand" : "font-medium text-muted",
            )}
          >
            {active === number ? (
              <span aria-hidden="true" className="size-1.5 rounded-full bg-brand" />
            ) : null}
            {number}. {label}
          </li>
        );
      })}
    </ol>
  );
}

export function CredentialUpload({
  documentName,
  documentSize,
  previewUrl,
  error,
  onFile,
}: {
  documentName: string;
  documentSize: number;
  previewUrl: string;
  error?: string;
  onFile: (file: File) => void;
}) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const choose = () => inputRef.current?.click();
  const handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) onFile(file);
    event.target.value = "";
  };
  return (
    <section className="space-y-3" aria-labelledby="document-upload-title">
      <h2 id="document-upload-title" className="text-[13px] font-bold text-secondary">
        证照图像上传
      </h2>
      <input
        ref={inputRef}
        data-testid="credential-file"
        type="file"
        aria-labelledby="document-upload-title"
        aria-describedby="document-upload-help"
        accept="image/jpeg,image/png,image/webp,image/avif,image/gif,image/heic,image/heif"
        className="sr-only"
        onChange={handleChange}
      />
      {documentName ? (
        <div className="flex items-center gap-3 rounded-lg border border-border bg-card p-3">
          <div className="flex h-12 w-16 shrink-0 items-center justify-center overflow-hidden rounded-md bg-slate-100">
            {previewUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={previewUrl} alt="凭证本地预览" className="size-full object-cover" />
            ) : (
              <FileImage aria-hidden="true" className="size-6 text-muted" />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-semibold text-primary">{documentName}</p>
            <p className="text-[11px] text-muted">
              已成功上传 · {(documentSize / 1024 / 1024).toFixed(1)} MB
            </p>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={choose}
            className="shrink-0 px-2"
          >
            重新上传
          </Button>
        </div>
      ) : (
        <button
          type="button"
          onClick={choose}
          className={cn(
            "flex min-h-28 w-full flex-col items-center justify-center rounded-lg border border-dashed bg-card px-5 text-center transition hover:bg-blue-50/50",
            error ? "border-danger" : "border-brand",
          )}
        >
          <Camera aria-hidden="true" className="size-8 text-brand" />
          <span className="mt-2 text-sm font-semibold text-brand">点击拍照或选择图片</span>
          <span className="mt-1 text-xs text-muted">
            <span id="document-upload-help">支持 JPEG、PNG、WebP、AVIF、GIF，确认裁切后上传</span>
          </span>
        </button>
      )}
      {error ? (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      ) : null}
    </section>
  );
}

export function DateSourceLabel({
  source,
  confidence,
}: {
  source?: DateFieldSource;
  confidence?: number;
}) {
  if (!source) return null;
  if (source === "ai") {
    return (
      <span className="whitespace-nowrap rounded-full bg-blue-50 px-1.5 py-0.5 text-[10px] font-semibold text-brand">
        AI识别 · {Math.round((confidence ?? 0.98) * 100)}%
      </span>
    );
  }
  if (source === "manual_modified") {
    return (
      <span className="whitespace-nowrap rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-secondary">
        已手动修改
      </span>
    );
  }
  return null;
}

export function DateCandidates({
  field,
  candidates,
  onSelect,
  onIgnore,
}: {
  field: DateFieldName;
  candidates: DateCandidate[];
  onSelect: (candidate: DateCandidate) => void;
  onIgnore: () => void;
}) {
  return (
    <div className="rounded-lg bg-card p-3 shadow-popover" aria-label="候选日期选择区">
      <p className="mb-3 text-[13px] font-bold text-primary">
        请选择对应的{field === "issueDate" ? "签发" : "到期"}日期
      </p>
      <div className="space-y-2">
        {candidates.map((candidate, index) => (
          <button
            key={candidate.id}
            type="button"
            onClick={() => onSelect(candidate)}
            className={cn(
              "w-full rounded-md border p-2.5 text-left",
              index === 0 ? "border-brand bg-blue-50" : "border-transparent bg-slate-50",
            )}
          >
            <span
              className={cn("block text-sm font-bold", index === 0 ? "text-brand" : "text-primary")}
            >
              {candidate.value}
            </span>
            <span className="mt-1 block text-[11px] text-secondary">{candidate.description}</span>
          </button>
        ))}
      </div>
      <Button type="button" variant="ghost" size="sm" className="mt-2 w-full" onClick={onIgnore}>
        暂不使用
      </Button>
    </div>
  );
}

function AssistIcon({ state }: { state: DocumentAssistState }) {
  switch (state.kind) {
    case "recognizing":
    case "reviewing":
      return <Loader2 aria-hidden="true" className="size-4 animate-spin" />;
    case "recognized":
    case "matched":
      return <Check aria-hidden="true" className="size-4" />;
    case "ambiguous":
    case "conflict":
    case "mismatch":
      return <TriangleAlert aria-hidden="true" className="size-4" />;
    case "busy":
      return <CircleAlert aria-hidden="true" className="size-4" />;
    case "idle":
    case "skipped":
      return <BrainCircuit aria-hidden="true" className="size-4" />;
  }
}

export function AssistStatusCard({
  state,
  onRetry,
  onSkip,
  onUseAi,
  onKeepManual,
}: {
  state: DocumentAssistState;
  onRetry?: () => void;
  onSkip?: () => void;
  onUseAi?: () => void;
  onKeepManual?: () => void;
}) {
  if (state.kind === "idle" || state.kind === "ambiguous") return null;
  const tone =
    state.kind === "recognized" || state.kind === "matched"
      ? "border-emerald-100 bg-emerald-50 text-success"
      : state.kind === "conflict" || state.kind === "mismatch"
        ? "border-warning bg-orange-50 text-warning"
        : "border-border bg-card text-secondary";
  let title = "AI辅助";
  let description = "";
  switch (state.kind) {
    case "recognizing":
      title = "正在识别凭证日期";
      description = "您可以继续填写其他信息，无需等待。";
      break;
    case "recognized":
      title = "日期识别完成";
      description = "已识别并引入空白日期，请在提交前核对。";
      break;
    case "reviewing":
      title = "AI正在审核您的材料";
      description = "审核为可选步骤，不影响合法表单提交。";
      break;
    case "matched":
      title = "AI审核完成";
      description = "凭证与表单信息未发现明显差异。";
      break;
    case "conflict":
      title = "AI识别日期与您填写的日期不同";
      description = `默认保留手动日期 ${state.manualValue}；AI候选为 ${state.aiCandidate.value}。`;
      break;
    case "mismatch":
      title = "AI发现可能不一致";
      description = `${state.message}（凭证：${state.documentValue}，表单：${state.formValue}）。此警告不会阻断提交。`;
      break;
    case "busy":
      title = "AI识别系统繁忙";
      description = "您可以手动填写并直接提交，服务器将在后台继续处理。";
      break;
    case "skipped":
      title = "已跳过AI审核";
      description = "请核对手动填写的信息后提交。";
      break;
  }
  return (
    <div role="status" className={cn("rounded-lg border p-3 text-xs", tone)}>
      <div className="flex items-center gap-2 text-[13px] font-bold">
        <AssistIcon state={state} />
        <span>{title}</span>
      </div>
      <p className="mt-1.5 leading-5 text-secondary">{description}</p>
      {state.kind === "busy" ? (
        <div className="mt-3 grid grid-cols-2 gap-2">
          <Button type="button" variant="secondary" size="sm" onClick={onRetry}>
            <RefreshCw aria-hidden="true" className="size-3.5" /> 稍后重试
          </Button>
          <Button type="button" size="sm" onClick={onSkip}>
            跳过并直接提交
          </Button>
        </div>
      ) : null}
      {state.kind === "conflict" ? (
        <div className="mt-3 grid grid-cols-2 gap-2">
          <Button type="button" variant="secondary" size="sm" onClick={onKeepManual}>
            保留手动填写
          </Button>
          <Button type="button" size="sm" onClick={onUseAi}>
            使用AI日期
          </Button>
        </div>
      ) : null}
      {state.kind === "reviewing" ? (
        <Button type="button" variant="link" size="sm" className="mt-2" onClick={onSkip}>
          跳过AI审核
        </Button>
      ) : null}
    </div>
  );
}

export function AiReviewPanel({
  disabled,
  state,
  onReview,
  onSkip,
}: {
  disabled: boolean;
  state: DocumentAssistState;
  onReview: () => void;
  onSkip: () => void;
}) {
  const showActions = !["reviewing", "matched", "mismatch", "busy"].includes(state.kind);
  return (
    <section
      className="space-y-3 rounded-lg border border-border bg-card p-4"
      aria-labelledby="ai-review-title"
    >
      <div>
        <h2 id="ai-review-title" className="text-[13px] font-bold text-secondary">
          AI辅助审核（可选）
        </h2>
        <p className="mt-1 text-xs leading-5 text-secondary">
          AI仅辅助识别并引入日期，其他信息由您手动填写。所有内容均可修改，请在提交前核对。
        </p>
      </div>
      {showActions ? (
        <div className="space-y-1">
          <Button type="button" className="w-full" disabled={disabled} onClick={onReview}>
            开始AI审核
          </Button>
          <Button
            type="button"
            variant="ghost"
            className="w-full"
            disabled={disabled}
            onClick={onSkip}
          >
            跳过AI审核
          </Button>
        </div>
      ) : null}
    </section>
  );
}

export function SubmitConfirmDialog({
  open,
  onOpenChange,
  onSubmit,
  submitting,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: () => void;
  submitting: boolean;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm rounded-xl p-5">
        <DialogTitle className="text-base font-bold text-primary">AI辅助处理尚未完成</DialogTitle>
        <DialogDescription className="mt-2 text-[13px] leading-5 text-secondary">
          可直接提交，服务器将在后台继续处理，不会影响本次申请。
        </DialogDescription>
        <div className="mt-4 grid grid-cols-2 gap-2 pr-6">
          <DialogClose asChild>
            <Button type="button" variant="secondary">
              继续等待
            </Button>
          </DialogClose>
          <Button type="button" loading={submitting} onClick={onSubmit}>
            直接提交
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function AiNotice() {
  return (
    <div className="flex gap-2 rounded-md bg-blue-50 p-3 text-xs leading-5 text-brand">
      <Info aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      <p>AI只会填充空白日期，不会覆盖手动填写，也不会自动填写证件编号、签发机构或等级/参数。</p>
    </div>
  );
}

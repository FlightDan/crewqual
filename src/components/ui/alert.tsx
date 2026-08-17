import * as React from "react";
import { CircleAlert, CircleCheck, Info, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";

const alertMap = {
  info: { icon: Info, className: "border-blue-100 bg-blue-50 text-info" },
  success: { icon: CircleCheck, className: "border-emerald-100 bg-emerald-50 text-success" },
  warning: { icon: TriangleAlert, className: "border-orange-100 bg-orange-50 text-warning" },
  danger: { icon: CircleAlert, className: "border-red-100 bg-red-50 text-danger" },
} as const;

export function Alert({
  tone = "info",
  title,
  children,
  className,
}: {
  tone?: keyof typeof alertMap;
  title?: string;
  children: React.ReactNode;
  className?: string;
}) {
  const config = alertMap[tone];
  const Icon = config.icon;
  return (
    <div
      role="alert"
      className={cn("flex gap-3 rounded-md border p-3 text-sm", config.className, className)}
    >
      <Icon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      <div>
        {title ? <p className="font-semibold">{title}</p> : null}
        <div className="leading-5">{children}</div>
      </div>
    </div>
  );
}

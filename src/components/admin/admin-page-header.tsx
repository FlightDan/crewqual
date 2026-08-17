import * as React from "react";
import { cn } from "@/lib/utils";

export function AdminPageHeader({
  title,
  description,
  action,
  className,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap items-start justify-between gap-3", className)}>
      <div>
        <h2 className="text-lg font-bold text-primary lg:text-xl">{title}</h2>
        {description ? (
          <p className="mt-1 text-xs text-secondary lg:text-sm">{description}</p>
        ) : null}
      </div>
      {action}
    </div>
  );
}

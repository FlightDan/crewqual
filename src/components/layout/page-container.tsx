import * as React from "react";
import { cn } from "@/lib/utils";

export function PageContainer({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLElement>) {
  return (
    <main className={cn("w-full min-w-0 flex-1 p-4 pb-24 lg:p-6 lg:pb-6", className)} {...props}>
      {children}
    </main>
  );
}

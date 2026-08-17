"use client";

import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { cn } from "@/lib/utils";

export const Drawer = DialogPrimitive.Root;
export const DrawerTrigger = DialogPrimitive.Trigger;
export const DrawerClose = DialogPrimitive.Close;
export const DrawerTitle = DialogPrimitive.Title;
export const DrawerDescription = DialogPrimitive.Description;

export function DrawerContent({
  className,
  children,
  side = "left",
  ...props
}: React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & { side?: "left" | "right" }) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-[var(--z-drawer)] bg-slate-950/40" />
      <DialogPrimitive.Content
        className={cn(
          "fixed inset-y-0 z-[var(--z-drawer)] w-[min(21rem,calc(100vw-3rem))] bg-card shadow-popover",
          side === "left" ? "left-0" : "right-0",
          className,
        )}
        {...props}
      >
        {children}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

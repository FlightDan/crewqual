import * as React from "react";
import { cn } from "@/lib/utils";

export function FormField({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return <div className={cn("space-y-1.5", className)}>{children}</div>;
}

export function FieldLabel({
  htmlFor,
  required,
  children,
}: {
  htmlFor?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label htmlFor={htmlFor} className="block text-sm font-semibold text-secondary">
      {children}{" "}
      {required ? (
        <span className="text-danger" aria-hidden="true">
          *
        </span>
      ) : null}
    </label>
  );
}

export function FieldHint({
  id,
  error,
  children,
}: {
  id?: string;
  error?: boolean;
  children: React.ReactNode;
}) {
  return (
    <p id={id} className={cn("text-xs leading-5", error ? "text-danger" : "text-muted")}>
      {children}
    </p>
  );
}

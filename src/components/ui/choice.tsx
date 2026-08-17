import * as React from "react";
import { cn } from "@/lib/utils";
import { FieldHint, FormField } from "@/components/ui/form-field";

type ChoiceBaseProps = {
  label?: React.ReactNode;
  helperText?: React.ReactNode;
  error?: React.ReactNode;
};

export function Checkbox({
  id,
  label,
  helperText,
  error,
  className,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & ChoiceBaseProps) {
  const generatedId = React.useId();
  const inputId = id ?? generatedId;
  return (
    <FormField>
      <label
        className="flex min-h-11 items-center gap-3 text-sm font-medium text-primary"
        htmlFor={inputId}
      >
        <input
          id={inputId}
          type="checkbox"
          className={cn("size-4 accent-brand", className)}
          {...props}
        />
        {label}
      </label>
      {helperText ? <FieldHint>{helperText}</FieldHint> : null}
      {error ? <FieldHint error>{error}</FieldHint> : null}
    </FormField>
  );
}

export function Radio({
  id,
  label,
  helperText,
  error,
  className,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & ChoiceBaseProps) {
  const generatedId = React.useId();
  const inputId = id ?? generatedId;
  return (
    <FormField>
      <label
        className="flex min-h-11 items-center gap-3 text-sm font-medium text-primary"
        htmlFor={inputId}
      >
        <input
          id={inputId}
          type="radio"
          className={cn("size-4 accent-brand", className)}
          {...props}
        />
        {label}
      </label>
      {helperText ? <FieldHint>{helperText}</FieldHint> : null}
      {error ? <FieldHint error>{error}</FieldHint> : null}
    </FormField>
  );
}

export function Switch({
  id,
  label,
  helperText,
  error,
  className,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & ChoiceBaseProps) {
  const generatedId = React.useId();
  const inputId = id ?? generatedId;
  return (
    <FormField>
      <label
        className="flex min-h-11 items-center justify-between gap-3 text-sm font-medium text-primary"
        htmlFor={inputId}
      >
        {label}
        <span className="relative inline-flex">
          <input id={inputId} type="checkbox" role="switch" className="peer sr-only" {...props} />
          <span
            aria-hidden="true"
            className={cn(
              "h-6 w-11 rounded-full bg-slate-300 transition peer-checked:bg-brand peer-focus-visible:ring-2 peer-focus-visible:ring-brand/40 after:absolute after:left-1 after:top-1 after:size-4 after:rounded-full after:bg-white after:transition peer-checked:after:translate-x-5",
              className,
            )}
          />
        </span>
      </label>
      {helperText ? <FieldHint>{helperText}</FieldHint> : null}
      {error ? <FieldHint error>{error}</FieldHint> : null}
    </FormField>
  );
}

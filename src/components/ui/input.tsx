import * as React from "react";
import { cn } from "@/lib/utils";
import { FieldHint, FieldLabel, FormField } from "@/components/ui/form-field";

type ControlProps = {
  label?: React.ReactNode;
  required?: boolean;
  helperText?: React.ReactNode;
  error?: React.ReactNode;
};

function describedBy(id: string, helperText?: React.ReactNode, error?: React.ReactNode) {
  return (
    [helperText ? `${id}-hint` : null, error ? `${id}-error` : null].filter(Boolean).join(" ") ||
    undefined
  );
}

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement>, ControlProps {}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ id, label, required, helperText, error, className, ...props }, ref) => {
    const generatedId = React.useId();
    const inputId = id ?? generatedId;
    return (
      <FormField>
        {label ? (
          <FieldLabel htmlFor={inputId} required={required}>
            {label}
          </FieldLabel>
        ) : null}
        <input
          ref={ref}
          id={inputId}
          className={cn(
            "min-h-11 w-full rounded-md border border-border bg-card px-3 text-sm text-primary placeholder:text-muted disabled:cursor-not-allowed disabled:bg-slate-100",
            "focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20",
            error && "border-danger focus:border-danger focus:ring-danger/20",
            className,
          )}
          aria-invalid={Boolean(error) || undefined}
          aria-describedby={describedBy(inputId, helperText, error)}
          {...props}
        />
        {helperText ? <FieldHint id={`${inputId}-hint`}>{helperText}</FieldHint> : null}
        {error ? (
          <FieldHint id={`${inputId}-error`} error>
            {error}
          </FieldHint>
        ) : null}
      </FormField>
    );
  },
);
Input.displayName = "Input";

export interface TextareaProps
  extends React.TextareaHTMLAttributes<HTMLTextAreaElement>, ControlProps {}

export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ id, label, required, helperText, error, className, ...props }, ref) => {
    const generatedId = React.useId();
    const textareaId = id ?? generatedId;
    return (
      <FormField>
        {label ? (
          <FieldLabel htmlFor={textareaId} required={required}>
            {label}
          </FieldLabel>
        ) : null}
        <textarea
          ref={ref}
          id={textareaId}
          className={cn(
            "min-h-28 w-full resize-y rounded-md border border-border bg-card px-3 py-2.5 text-sm text-primary placeholder:text-muted disabled:cursor-not-allowed disabled:bg-slate-100",
            "focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20",
            error && "border-danger focus:border-danger focus:ring-danger/20",
            className,
          )}
          aria-invalid={Boolean(error) || undefined}
          aria-describedby={describedBy(textareaId, helperText, error)}
          {...props}
        />
        {helperText ? <FieldHint id={`${textareaId}-hint`}>{helperText}</FieldHint> : null}
        {error ? (
          <FieldHint id={`${textareaId}-error`} error>
            {error}
          </FieldHint>
        ) : null}
      </FormField>
    );
  },
);
Textarea.displayName = "Textarea";

export function DateField(props: InputProps) {
  return <Input type="date" {...props} />;
}

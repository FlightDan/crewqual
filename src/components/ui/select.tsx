import * as React from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { FieldHint, FieldLabel, FormField } from "@/components/ui/form-field";

export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: React.ReactNode;
  required?: boolean;
  helperText?: React.ReactNode;
  error?: React.ReactNode;
  options: Array<{ label: string; value: string }>;
}

export const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  ({ id, label, required, helperText, error, options, className, children, ...props }, ref) => {
    const generatedId = React.useId();
    const selectId = id ?? generatedId;
    const hintId = helperText ? `${selectId}-hint` : undefined;
    const errorId = error ? `${selectId}-error` : undefined;
    return (
      <FormField>
        {label ? (
          <FieldLabel htmlFor={selectId} required={required}>
            {label}
          </FieldLabel>
        ) : null}
        <div className="relative">
          <select
            ref={ref}
            id={selectId}
            className={cn(
              "min-h-11 w-full appearance-none rounded-md border border-border bg-card px-3 pr-10 text-sm text-primary focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20 disabled:cursor-not-allowed disabled:bg-slate-100",
              error && "border-danger",
              className,
            )}
            aria-invalid={Boolean(error) || undefined}
            aria-describedby={[hintId, errorId].filter(Boolean).join(" ") || undefined}
            {...props}
          >
            {children ??
              options.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
          </select>
          <ChevronDown
            aria-hidden="true"
            className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted"
          />
        </div>
        {helperText ? <FieldHint id={hintId}>{helperText}</FieldHint> : null}
        {error ? (
          <FieldHint id={errorId} error>
            {error}
          </FieldHint>
        ) : null}
      </FormField>
    );
  },
);
Select.displayName = "Select";

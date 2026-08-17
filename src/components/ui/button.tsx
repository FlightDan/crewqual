"use client";

import * as React from "react";
import { Loader2 } from "lucide-react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-md px-4 py-2 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        primary: "bg-brand text-white hover:bg-blue-600",
        secondary: "border border-border bg-card text-primary hover:bg-slate-50",
        danger: "bg-danger text-white hover:bg-red-600",
        ghost: "text-secondary hover:bg-slate-100 hover:text-primary",
        link: "min-h-0 px-0 py-1 text-brand underline-offset-4 hover:underline",
      },
      size: {
        sm: "min-h-10 px-3 text-xs",
        md: "min-h-11 px-4 text-sm",
        lg: "min-h-12 px-5 text-base",
        icon: "h-11 w-11 p-0",
      },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  loading?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, loading = false, disabled, children, ...props }, ref) => (
    <button
      ref={ref}
      className={cn(buttonVariants({ variant, size, className }))}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading ? <Loader2 aria-hidden="true" className="size-4 animate-spin" /> : null}
      {children}
    </button>
  ),
);
Button.displayName = "Button";

export function IconButton({
  label,
  size = "icon",
  className,
  children,
  ...props
}: ButtonProps & { label: string }) {
  return (
    <Button {...props} size={size} className={className} aria-label={label}>
      {children}
    </Button>
  );
}

export { buttonVariants };

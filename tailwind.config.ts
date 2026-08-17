import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        brand: "var(--color-brand-primary)",
        nav: "var(--color-nav)",
        surface: "var(--color-surface)",
        card: "var(--color-surface-card)",
        border: "var(--color-border)",
        primary: "var(--color-text-primary)",
        secondary: "var(--color-text-secondary)",
        muted: "var(--color-text-muted)",
        success: "var(--color-status-success)",
        warning: "var(--color-status-warning)",
        danger: "var(--color-status-danger)",
        info: "var(--color-status-info)",
      },
      boxShadow: {
        card: "var(--shadow-card)",
        popover: "var(--shadow-popover)",
      },
      borderRadius: {
        sm: "var(--radius-sm)",
        md: "var(--radius-md)",
        lg: "var(--radius-lg)",
        xl: "var(--radius-xl)",
      },
      spacing: {
        18: "var(--space-18)",
      },
    },
  },
  plugins: [],
};

export default config;

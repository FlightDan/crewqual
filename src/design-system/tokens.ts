export const breakpoints = {
  mobile: 768,
  desktop: 1024,
  pilotContentMax: 430,
} as const;

export const designTokens = {
  colors: {
    brandPrimary: "#3b82f6",
    nav: "#0f172a",
    surface: "#f8fafc",
    card: "#ffffff",
    border: "#e2e8f0",
    textPrimary: "#0f172a",
    textSecondary: "#475569",
    textMuted: "#94a3b8",
    success: "#10b981",
    warning: "#f97316",
    danger: "#ef4444",
    info: "#3b82f6",
  },
  spacing: { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 },
  radius: { sm: 4, md: 8, lg: 12, xl: 16 },
} as const;

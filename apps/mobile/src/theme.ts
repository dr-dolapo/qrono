/** Qrono's dark theme, shared by every screen. */
export const colors = {
  background: "#000000",
  surface: "#0e0f13",
  border: "#2a3040",
  text: "#f4f5f7",
  muted: "#a3a9b6",
  accent: "#a44be9",
  onAccent: "#ffffff",
  danger: "#ff8a8a",
  warningSurface: "#2a2210",
  warningText: "#ffd57a",
  live: "#4ade80",
  liveSurface: "#123020",
  mineSurface: "#1f1838",
} as const;

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;
export const radius = { md: 12, lg: 16 } as const;

/**
 * The black-to-purple backdrop shared with the web app. It is painted once behind the
 * whole navigator, so screens keep a transparent background to let it show through.
 */
export const backdrop = {
  flex: 1,
  backgroundColor: colors.background,
  experimental_backgroundImage: "linear-gradient(180deg, #000000 0%, #020003 30%, #040106 60%, #050108 100%)",
} as const;

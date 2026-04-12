import { useEffect, useState } from "react";

export type ResolvedTheme = "light" | "dark";

export function useTheme(setting: "system" | "light" | "dark"): ResolvedTheme {
  const [systemTheme, setSystemTheme] = useState<ResolvedTheme>(
    window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"
  );

  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = (e: MediaQueryListEvent) =>
      setSystemTheme(e.matches ? "dark" : "light");
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  if (setting === "system") return systemTheme;
  return setting;
}

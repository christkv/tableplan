import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { cachedRequest, Preferences } from "./api";
import { useSession } from "./session";

export type Appearance = "system" | "light" | "dark";
export type ResolvedTheme = "light" | "dark";

const STORAGE_KEY = "tableplan.appearance";
const DARK_QUERY = "(prefers-color-scheme: dark)";

interface ThemeState {
  appearance: Appearance;
  resolvedTheme: ResolvedTheme;
  setAppearance(value: Appearance): void;
}

const ThemeContext = createContext<ThemeState | null>(null);

function normalizeAppearance(value: unknown): Appearance {
  return value === "light" || value === "dark" || value === "system" ? value : "system";
}

function prefersDark(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(DARK_QUERY).matches;
}

export function resolveTheme(appearance: Appearance, systemIsDark = prefersDark()): ResolvedTheme {
  return appearance === "system" ? (systemIsDark ? "dark" : "light") : appearance;
}

export function storedAppearance(): Appearance {
  if (typeof window === "undefined") return "system";
  try {
    return normalizeAppearance(window.localStorage.getItem(STORAGE_KEY));
  } catch {
    return "system";
  }
}

export function applyAppearance(appearance: Appearance): ResolvedTheme {
  const resolved = resolveTheme(appearance);
  if (typeof document !== "undefined") {
    document.documentElement.dataset.theme = resolved;
    document.documentElement.style.colorScheme = resolved;
    document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
      ?.setAttribute("content", resolved === "dark" ? "#101612" : "#173f35");
  }
  return resolved;
}

export function initializeTheme(): Appearance {
  const appearance = storedAppearance();
  applyAppearance(appearance);
  return appearance;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const { session } = useSession();
  const [appearance, setAppearanceState] = useState<Appearance>(storedAppearance);
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>(() => applyAppearance(storedAppearance()));

  const setAppearance = useCallback((value: Appearance) => {
    setAppearanceState(value);
    try {
      window.localStorage.setItem(STORAGE_KEY, value);
    } catch {
      // Theme selection still works for this page when storage is unavailable.
    }
    setResolvedTheme(applyAppearance(value));
  }, []);

  useEffect(() => {
    if (!session) return;
    let active = true;
    void cachedRequest<Preferences>("/api/v1/preferences")
      .then((preferences) => {
        if (active) setAppearance(normalizeAppearance(preferences.appearance));
      })
      .catch(() => undefined);
    return () => { active = false; };
  }, [session, setAppearance]);

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const query = window.matchMedia(DARK_QUERY);
    const update = () => {
      if (appearance === "system") setResolvedTheme(applyAppearance("system"));
    };
    if (query.addEventListener) {
      query.addEventListener("change", update);
      return () => query.removeEventListener("change", update);
    }
    query.addListener?.(update);
    return () => query.removeListener?.(update);
  }, [appearance]);

  const value = useMemo(() => ({ appearance, resolvedTheme, setAppearance }), [appearance, resolvedTheme, setAppearance]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const value = useContext(ThemeContext);
  if (!value) throw new Error("ThemeProvider is missing");
  return value;
}

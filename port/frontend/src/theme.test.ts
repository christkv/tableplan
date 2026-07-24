import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applyAppearance, initializeTheme, resolveTheme, storedAppearance } from "./theme";

function systemTheme(dark: boolean) {
  vi.stubGlobal("matchMedia", vi.fn(() => ({
    matches: dark,
    media: "(prefers-color-scheme: dark)",
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })));
}

describe("appearance theme", () => {
  beforeEach(() => {
    const values = new Map<string, string>();
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: {
        clear: () => values.clear(),
        getItem: (key: string) => values.get(key) ?? null,
        key: (index: number) => [...values.keys()][index] ?? null,
        get length() { return values.size; },
        removeItem: (key: string) => values.delete(key),
        setItem: (key: string, value: string) => values.set(key, value),
      } satisfies Storage,
    });
    delete document.documentElement.dataset.theme;
    document.documentElement.style.colorScheme = "";
  });

  afterEach(() => vi.unstubAllGlobals());

  it("resolves system, light, and dark preferences", () => {
    expect(resolveTheme("system", false)).toBe("light");
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
  });

  it("restores a saved manual preference before the app renders", () => {
    systemTheme(false);
    window.localStorage.setItem("tableplan.appearance", "dark");

    expect(initializeTheme()).toBe("dark");
    expect(storedAppearance()).toBe("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(document.documentElement.style.colorScheme).toBe("dark");
  });

  it("uses the current OS preference for system mode", () => {
    systemTheme(true);

    expect(applyAppearance("system")).toBe("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  it("ignores invalid cached values", () => {
    window.localStorage.setItem("tableplan.appearance", "midnight");
    expect(storedAppearance()).toBe("system");
  });
});

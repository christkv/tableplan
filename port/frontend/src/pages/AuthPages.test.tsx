import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router";
import { ResetPasswordPage, SignInPage } from "./AuthPages";
import { SessionProvider } from "../session";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("Google sign-in", () => {
  it("keeps OAuth on the frontend origin so Vite can proxy the callback and cookie", () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 200 })));

    render(
      <SessionProvider>
        <MemoryRouter initialEntries={["/sign-in?returnTo=%2Frecipes"]}>
          <SignInPage />
        </MemoryRouter>
      </SessionProvider>,
    );

    const link = screen.getByRole("link", { name: "Continue with Google" });
    const href = link.getAttribute("href") ?? "";
    expect(href).toMatch(/^\/oauth2\/authorization\/google\?/);
    expect(href).toContain("returnTo=%2Frecipes");
    expect(href).not.toContain(":9090");
    expect(href).not.toContain("return_origin");
  });

  it("marks the application as an alpha release", () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 200 })));

    render(
      <SessionProvider>
        <MemoryRouter initialEntries={["/sign-in"]}>
          <SignInPage />
        </MemoryRouter>
      </SessionProvider>,
    );

    expect(screen.getByLabelText("Alpha release")).toBeTruthy();
  });
});

describe("password reset", () => {
  it("submits the fragment token with the new password", async () => {
    history.replaceState(null, "", "/reset-password#token=secure-reset-token-that-is-long-enough");
    let submitted: Record<string, string> | undefined;
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path.endsWith("/api/auth/csrf")) {
        return Response.json({ headerName: "X-CSRF-TOKEN", token: "csrf-token" });
      }
      if (path.endsWith("/api/auth/password-reset/confirm")) {
        submitted = JSON.parse(String(init?.body));
        return Response.json({ message: "Your password has been reset." });
      }
      return Response.json({ code: "not_found", message: "Not found" }, { status: 404 });
    }));

    render(
      <SessionProvider>
        <MemoryRouter initialEntries={["/reset-password"]}>
          <ResetPasswordPage />
        </MemoryRouter>
      </SessionProvider>,
    );

    fireEvent.change(screen.getByLabelText("New password"), { target: { value: "a-secure-new-password" } });
    fireEvent.change(screen.getByLabelText("Confirm new password"), { target: { value: "a-secure-new-password" } });
    fireEvent.click(screen.getByRole("button", { name: "Reset password" }));

    await waitFor(() => expect(submitted).toEqual({
      token: "secure-reset-token-that-is-long-enough",
      password: "a-secure-new-password",
    }));
    expect(await screen.findByText("Your password has been reset.")).toBeTruthy();
  });
});

import { createContext, ReactNode, useContext, useEffect, useMemo, useState } from "react";
import { request, Session } from "./api";

interface SessionState {
  session: Session | null | undefined;
  refresh(): Promise<Session | null>;
  setSession(session: Session | null): void;
}

const SessionContext = createContext<SessionState | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null | undefined>();
  async function refresh() {
    const next = await request<Session | null>("/api/auth/session").catch(() => null);
    setSession(next);
    return next;
  }
  useEffect(() => { void refresh(); }, []);
  const value = useMemo(() => ({ session, setSession, refresh }), [session]);
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const value = useContext(SessionContext);
  if (!value) throw new Error("SessionProvider is missing");
  return value;
}

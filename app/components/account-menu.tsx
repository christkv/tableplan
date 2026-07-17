import { LogOut } from "lucide-react";
import { useState } from "react";

import { authClient } from "~/lib/auth-client";

export function AccountMenu({ name, email }: { name: string; email: string }) {
  const [pending, setPending] = useState(false);
  async function signOut() {
    setPending(true);
    await authClient.signOut();
    window.location.assign("/sign-in");
  }
  return (
    <div className="sidebar-footer">
      <span className="avatar">{name.slice(0, 2).toUpperCase()}</span>
      <div className="account-copy"><strong>{name}</strong><small>{email}</small></div>
      <button type="button" className="signout-button" onClick={signOut} disabled={pending} title="Sign out" aria-label="Sign out"><LogOut size={16} /></button>
    </div>
  );
}

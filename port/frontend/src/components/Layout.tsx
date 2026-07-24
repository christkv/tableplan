import { CalendarDays, Heart, ListChecks, LogOut, Search, Settings } from "lucide-react";
import { NavLink, Navigate, Outlet, useLocation } from "react-router";
import { request, json } from "../api";
import { useSession } from "../session";
import { BrandMark, BrandName, PRODUCT_NAME } from "./Brand";
import { Button } from "./ui";

const navigation = [
  { to: "/plan", label: "Plan", icon: CalendarDays },
  { to: "/recipes", label: "Recipes", icon: Search },
  { to: "/favorites", label: "Favorites", icon: Heart },
  { to: "/shopping", label: "Shopping", icon: ListChecks },
  { to: "/settings", label: "Settings", icon: Settings },
];

export function ProtectedLayout() {
  const { session, setSession } = useSession();
  const location = useLocation();
  if (session === undefined) return <main className="shared-loading"><div><BrandMark /><h1>Opening {PRODUCT_NAME}</h1><p>Bringing your household plan together.</p></div></main>;
  if (!session) return <Navigate replace to={`/sign-in?returnTo=${encodeURIComponent(location.pathname + location.search)}`} />;
  async function signOut() {
    await request("/api/auth/logout", json({}));
    setSession(null);
  }
  return <div className="app-frame">
    <aside className="sidebar">
      <NavLink to="/recipes" className="brand" aria-label={`${PRODUCT_NAME} recipes`}><BrandMark /><BrandName /></NavLink>
      <nav className="side-nav" aria-label="Primary navigation">{navigation.map(({ to, label, icon: Icon }) =>
        <NavLink key={to} to={to} className={({ isActive }) => `nav-link${isActive ? " active" : ""}`}><Icon size={18} /><span>{label}</span></NavLink>)}</nav>
      <div className="sidebar-footer"><span className="avatar">{session.user.name.slice(0, 2).toUpperCase()}</span><div className="account-copy"><strong>{session.user.name}</strong><small>{session.user.email}</small></div><Button variant="ghost" size="icon" onClick={signOut} title="Sign out" aria-label="Sign out"><LogOut size={16} /></Button></div>
    </aside>
    <main className="main-content"><Outlet /></main>
    <nav className="bottom-nav" aria-label="Primary navigation">{navigation.slice(0, 4).map(({ to, label, icon: Icon }) =>
      <NavLink key={to} to={to} className={({ isActive }) => `bottom-link${isActive ? " active" : ""}`}><Icon size={19} /><span>{label}</span></NavLink>)}</nav>
  </div>;
}

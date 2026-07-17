import {
  CalendarDays,
  ChefHat,
  Heart,
  ListChecks,
  Search,
  Settings,
} from "lucide-react";
import { NavLink, Outlet } from "react-router";
import { redirect } from "react-router";

import type { Route } from "./+types/app-layout";
import { AccountMenu } from "~/components/account-menu";
import { cloudflareContext } from "../context";
import { getRequestSession } from "../../src/auth/server";

const navigation = [
  { to: "/plan", label: "Plan", icon: CalendarDays },
  { to: "/recipes", label: "Recipes", icon: Search },
  { to: "/favorites", label: "Favorites", icon: Heart },
  { to: "/shopping", label: "Shopping", icon: ListChecks },
  { to: "/settings", label: "Settings", icon: Settings },
];

export async function loader({ request, context }: Route.LoaderArgs) {
  const { env, ctx } = context.get(cloudflareContext);
  const session = await getRequestSession(request, env, ctx);
  if (!session) throw redirect("/sign-in");
  return { user: { name: session.user.name, email: session.user.email } };
}

export default function AppLayout({ loaderData }: Route.ComponentProps) {
  return (
    <div className="app-frame">
      <aside className="sidebar">
        <NavLink to="/recipes" className="brand" aria-label="Tableplan recipes">
          <span className="brand-mark"><ChefHat size={20} /></span>
          <span>Tableplan</span>
        </NavLink>
        <nav className="side-nav" aria-label="Primary navigation">
          {navigation.map(({ to, label, icon: Icon }) => (
            <NavLink key={to} to={to} className={({ isActive }) => `nav-link${isActive ? " active" : ""}`}>
              <Icon size={18} aria-hidden="true" />
              <span>{label}</span>
            </NavLink>
          ))}
        </nav>
        <AccountMenu name={loaderData.user.name} email={loaderData.user.email} />
      </aside>
      <main className="main-content"><Outlet /></main>
      <nav className="bottom-nav" aria-label="Primary navigation">
        {navigation.slice(0, 4).map(({ to, label, icon: Icon }) => (
          <NavLink key={to} to={to} className={({ isActive }) => `bottom-link${isActive ? " active" : ""}`}>
            <Icon size={19} aria-hidden="true" /><span>{label}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  );
}

import {
  isRouteErrorResponse,
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
} from "react-router";

import type { Route } from "./+types/root";
import "./app.css";

export const meta: Route.MetaFunction = () => [
  { title: "Tableplan" },
  { name: "description", content: "Family meal planning and combined shopping lists." },
];

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <Meta />
        <Links />
      </head>
      <body>
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function App() {
  return <Outlet />;
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  let title = "Something went wrong";
  let detail = "The request could not be completed.";
  if (isRouteErrorResponse(error)) {
    title = error.status === 404 ? "Page not found" : `Request failed (${error.status})`;
    detail = error.statusText || detail;
  } else if (import.meta.env.DEV && error instanceof Error) {
    detail = error.message;
  }
  return (
    <main className="error-page">
      <div>
        <p className="eyebrow">Tableplan</p>
        <h1>{title}</h1>
        <p>{detail}</p>
        <a href="/recipes">Return to recipes</a>
      </div>
    </main>
  );
}

import { Heart, Users } from "lucide-react";
import { Link } from "react-router";

import type { Route } from "./+types/favorites";
import { Badge } from "~/components/ui/badge";
import { cloudflareContext } from "../context";
import { requireRequestSession } from "../../src/auth/server";
import { listFavorites } from "../../src/db/favorites";

export async function loader({ request, context }: Route.LoaderArgs) {
  const { env, ctx } = context.get(cloudflareContext);
  const session = await requireRequestSession(request, env, ctx);
  return { recipes: await listFavorites(env.DB, session.user.id) };
}

export default function Favorites({ loaderData }: Route.ComponentProps) {
  return (
    <div className="page-shell"><header className="page-header"><div><p className="eyebrow">Saved recipes</p><h1>Favorites</h1><p className="page-subtitle">Reliable choices for a busy week.</p></div></header>
      {loaderData.recipes.length ? <div className="recipe-grid">{loaderData.recipes.map((recipe) => <Link key={recipe.id} to={`/recipes/${recipe.id}`} className="recipe-card"><div className="recipe-card-top"><div className="recipe-initial">{recipe.name[0]}</div><Heart size={18} fill="currentColor" /></div><div className="recipe-card-body"><h2>{recipe.name}</h2><p>{recipe.description || recipe.ingredients.slice(0, 4).join(", ")}</p></div><div className="recipe-meta"><span><Users size={15} /> {recipe.servings ?? "?"} servings</span><div className="tag-row">{recipe.tags.slice(0, 2).map((tag) => <Badge key={tag}>{tag}</Badge>)}</div></div></Link>)}</div>
      : <section className="empty-state"><Heart size={24} /><h2>No favorites yet</h2><p>Use the heart on a recipe to keep it here.</p></section>}
    </div>
  );
}

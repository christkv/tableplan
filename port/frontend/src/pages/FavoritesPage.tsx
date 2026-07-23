import { Heart, LoaderCircle, Users } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router";
import { cachedRequest, errorMessage, RecipeSummary } from "../api";
import { Badge } from "../components/ui";

export function FavoritesPage() {
  const [recipes, setRecipes] = useState<RecipeSummary[]>();
  const [error, setError] = useState("");
  useEffect(() => {
    cachedRequest<RecipeSummary[]>("/api/v1/favourites", 10_000).then(setRecipes).catch((cause) => setError(errorMessage(cause, "Favorites could not be loaded.")));
  }, []);
  return <div className="page-shell">
    <header className="page-header"><div><p className="eyebrow">Saved recipes</p><h1>Favorites</h1><p className="page-subtitle">Reliable choices for a busy week.</p></div></header>
    {error && <p className="form-error" role="alert">{error}</p>}
    {!recipes && !error && <p className="recipe-load-sentinel"><LoaderCircle className="spin" size={18} /> Loading favorites</p>}
    {recipes?.length ? <div className="recipe-grid">{recipes.map((recipe) => <Link key={recipe.id} to={`/recipes/${recipe.id}`} className="recipe-card"><div className="recipe-card-top"><h2>{recipe.name}</h2><Heart size={18} fill="currentColor" /></div><div className="recipe-card-body"><p>{recipe.description || recipe.ingredients.slice(0, 4).join(", ")}</p></div><div className="recipe-meta"><span><Users size={15} /> {recipe.servings ?? "?"} servings</span><div className="tag-row">{recipe.tags.slice(0, 2).map((tag) => <Badge key={tag}>{tag}</Badge>)}</div></div></Link>)}</div>
      : recipes && <section className="empty-state"><Heart size={24} /><h2>No favorites yet</h2><p>Use the heart on a recipe to keep it here.</p><Link className="button button-primary button-default" to="/recipes">Browse recipes</Link></section>}
  </div>;
}

import { ArrowLeft, CalendarPlus, Heart, Scale, Users } from "lucide-react";
import { Form, Link, redirect } from "react-router";

import type { Route } from "./+types/recipe-detail";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { cloudflareContext } from "../context";
import { isFavorite, setFavorite } from "../../src/db/favorites";
import { getRecipe } from "../../src/db/recipes";
import { requireRequestSession } from "../../src/auth/server";
import { getMeasurementSystem } from "../../src/db/preferences";
import { displayIngredientLine } from "../../src/domain/quantity/display";

export async function loader({ params, context, request }: Route.LoaderArgs) {
  const { env, ctx } = context.get(cloudflareContext);
  const session = await requireRequestSession(request, env, ctx);
  const recipe = await getRecipe(env.DB, params.recipeId);
  if (!recipe) throw new Response("Recipe not found", { status: 404 });
  const [favorite, measurementSystem] = await Promise.all([
    isFavorite(env.DB, session.user.id, recipe.id),
    getMeasurementSystem(env.DB, session.user.id, session.householdId),
  ]);
  return { recipe, favorite, measurementSystem };
}

export async function action({ params, context, request }: Route.ActionArgs) {
  const { env, ctx } = context.get(cloudflareContext);
  const session = await requireRequestSession(request, env, ctx);
  const data = await request.formData();
  await setFavorite(env.DB, session.user.id, params.recipeId, data.get("favorite") === "true");
  return redirect(`/recipes/${params.recipeId}`);
}

export default function RecipeDetail({ loaderData }: Route.ComponentProps) {
  const { recipe, favorite, measurementSystem } = loaderData;
  return (
    <div className="page-shell detail-page">
      <Link to="/recipes" className="back-link"><ArrowLeft size={17} /> Back to recipes</Link>
      <header className="detail-header">
        <div>
          <div className="tag-row">{recipe.tags.slice(0, 5).map((tag) => <Badge key={tag}>{tag}</Badge>)}</div>
          <h1>{recipe.name}</h1>
          <p>{recipe.description || "A recipe from the family catalog."}</p>
          <div className="detail-meta">
            <span><Users size={17} /> {recipe.servings ?? "Unknown"} servings</span>
            <span><Scale size={17} /> {measurementSystem === "original" ? "Original units" : measurementSystem === "metric" ? "Metric units" : "US customary units"}</span>
          </div>
        </div>
        <div className="detail-actions">
          <Form method="post"><input type="hidden" name="favorite" value={favorite ? "false" : "true"} /><Button variant="secondary" size="icon" title={favorite ? "Remove favorite" : "Save favorite"} aria-label={favorite ? "Remove favorite" : "Save favorite"}><Heart size={18} fill={favorite ? "currentColor" : "none"} /></Button></Form>
          <Link className="button button-primary button-default" to={`/plan?add=${recipe.id}`}><CalendarPlus size={18} /> Add to plan</Link>
        </div>
      </header>

      <div className="detail-columns">
        <section className="ingredients-panel">
          <div className="section-heading"><div><p className="eyebrow">For the table</p><h2>Ingredients</h2></div><span>{recipe.recipeIngredients.length} items</span></div>
          <ul className="ingredient-list">
            {recipe.recipeIngredients.map((item) => (
              <li key={item.id}>
                <span className={`parse-dot ${item.parseStatus}`} title={`Parse status: ${item.parseStatus}`} />
                <span>{displayIngredientLine(item, measurementSystem)}</span>
              </li>
            ))}
          </ul>
        </section>
        <section className="steps-panel">
          <div className="section-heading"><div><p className="eyebrow">Method</p><h2>Steps</h2></div><span>{recipe.steps.length} steps</span></div>
          <ol className="step-list">
            {recipe.steps.map((step) => <li key={step.position}><span>{step.position + 1}</span><p>{step.instruction}</p></li>)}
          </ol>
        </section>
      </div>
    </div>
  );
}

import { ArrowLeft, Save } from "lucide-react";
import { Form, Link, redirect, useNavigation } from "react-router";

import type { Route } from "./+types/recipe-edit";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { cloudflareContext } from "../context";
import { requireRequestSession } from "../../src/auth/server";
import { createStorageClient } from "../../src/storage";

const lines = (value: FormDataEntryValue | null) => String(value ?? "").split("\n").map((item) => item.trim()).filter(Boolean);

export async function loader({ params, request, context }: Route.LoaderArgs) {
  const { env, ctx } = context.get(cloudflareContext);
  const session = await requireRequestSession(request, env, ctx);
  const recipe = await createStorageClient(env).getRecipe(params.recipeId, { userId: session.user.id, householdId: session.householdId });
  if (!recipe?.isOwner) throw new Response("Recipe not found", { status: 404 });
  return { recipe };
}

export async function action({ params, request, context }: Route.ActionArgs) {
  const { env, ctx } = context.get(cloudflareContext);
  const session = await requireRequestSession(request, env, ctx);
  const data = await request.formData();
  const storage = createStorageClient(env);
  try {
    await storage.updateOwnedRecipe({
      recipeId: params.recipeId, access: { userId: session.user.id, householdId: session.householdId },
      draft: { title: String(data.get("title") ?? ""), description: String(data.get("description") ?? ""), servings: Number(data.get("servings")) || null,
        servingSize: String(data.get("servingSize") ?? "") || null, ingredients: lines(data.get("ingredients")), steps: lines(data.get("steps")),
        tags: String(data.get("tags") ?? "").split(",").map((tag) => tag.trim()).filter(Boolean), warnings: [] },
    });
    await storage.refreshShoppingListsForRecipe({ userId: session.user.id, householdId: session.householdId }, params.recipeId);
    return redirect(`/recipes/${params.recipeId}`);
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Recipe could not be saved" };
  }
}

export default function RecipeEdit({ loaderData, actionData }: Route.ComponentProps) {
  const { recipe } = loaderData;
  const navigation = useNavigation();
  return <div className="page-shell recipe-review-page"><Link className="back-link" to={`/recipes/${recipe.id}`}><ArrowLeft size={17} /> Back to recipe</Link><header className="page-header"><div><p className="eyebrow">My recipe</p><h1>Edit recipe</h1><p className="page-subtitle">Saving rechecks ingredient mappings and refreshes recipe search.</p></div></header>
    <Form method="post" className="recipe-review-form"><section className="review-section"><div className="review-fields"><label className="field-label full">Title<Input name="title" required defaultValue={recipe.name} /></label><label className="field-label full">Description<textarea name="description" rows={3} defaultValue={recipe.description} /></label><label className="field-label">Servings<Input name="servings" type="number" min="0.1" step="0.1" defaultValue={recipe.servings ?? ""} /></label><label className="field-label">Serving size<Input name="servingSize" defaultValue={recipe.servingSize ?? ""} /></label><label className="field-label full">Tags<Input name="tags" defaultValue={recipe.tags.join(", ")} /></label></div></section><section className="review-section"><div className="section-heading"><h2>Ingredients</h2><span>{recipe.recipeIngredients.length} lines</span></div><label className="field-label">One ingredient per line<textarea name="ingredients" required rows={Math.max(7, recipe.recipeIngredients.length + 1)} defaultValue={recipe.recipeIngredients.map((item) => item.rawLine).join("\n")} /></label></section><section className="review-section"><div className="section-heading"><h2>Instructions</h2><span>{recipe.steps.length} steps</span></div><label className="field-label">One step per line<textarea name="steps" required rows={Math.max(7, recipe.steps.length + 2)} defaultValue={recipe.steps.map((step) => step.instruction).join("\n")} /></label></section>{actionData?.error ? <p className="form-error" role="alert">{actionData.error}</p> : null}<div className="review-command-row"><Link className="button button-ghost button-default" to={`/recipes/${recipe.id}`}>Cancel</Link><Button type="submit" disabled={navigation.state === "submitting"}><Save size={17} /> {navigation.state === "submitting" ? "Saving..." : "Save changes"}</Button></div></Form></div>;
}

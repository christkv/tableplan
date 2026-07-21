import { AlertCircle, ArrowLeft, Check, LoaderCircle, LockKeyhole, Users } from "lucide-react";
import { useEffect } from "react";
import { Form, Link, redirect, useNavigation, useRevalidator } from "react-router";

import type { Route } from "./+types/recipe-import-review";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { cloudflareContext } from "../context";
import { requireRequestSession } from "../../src/auth/server";
import { createStorageClient } from "../../src/storage";
import type { RecipeDraft } from "../../src/ingestion/types";

export async function loader({ params, request, context }: Route.LoaderArgs) {
  const { env, ctx } = context.get(cloudflareContext);
  const session = await requireRequestSession(request, env, ctx);
  const storage = createStorageClient(env);
  const ingestion = await storage.getRecipeIngestion(params.ingestionId, { userId: session.user.id, householdId: session.householdId });
  if (!ingestion) throw new Response("Recipe import not found", { status: 404 });
  const candidates = ingestion.ingredientReviews.length ? await Promise.all(ingestion.ingredientReviews.map((item) => storage.listIngredientCandidates(item.parsedName))) : [];
  return { ingestion, candidates };
}

function lines(value: FormDataEntryValue | null): string[] {
  return String(value ?? "").split("\n").map((item) => item.trim()).filter(Boolean);
}

export async function action({ params, request, context }: Route.ActionArgs) {
  const { env, ctx } = context.get(cloudflareContext);
  const session = await requireRequestSession(request, env, ctx);
  const data = await request.formData();
  const access = { userId: session.user.id, householdId: session.householdId };
  const storage = createStorageClient(env);
  const ingestion = await storage.getRecipeIngestion(params.ingestionId, access);
  if (!ingestion) throw new Response("Recipe import not found", { status: 404 });
  if (data.get("intent") === "cancel") {
    await storage.updateRecipeIngestionStatus(ingestion.id, "cancelled", "Import cancelled");
    return redirect("/recipes?scope=mine");
  }
  const draft: RecipeDraft = {
    title: String(data.get("title") ?? ""), description: String(data.get("description") ?? ""),
    servings: Number(data.get("servings")) || null, servingSize: String(data.get("servingSize") ?? "") || null,
    ingredients: lines(data.get("ingredients")), steps: lines(data.get("steps")),
    tags: String(data.get("tags") ?? "").split(",").map((item) => item.trim()).filter(Boolean), warnings: ingestion.draft?.warnings ?? [],
  };
  try {
    const recipeId = await storage.publishRecipeDraft({
      ingestionId: ingestion.id, userId: session.user.id, householdId: session.householdId,
      visibility: data.get("visibility") === "household" ? "household" : "user_private", draft,
      ingredientSelections: draft.ingredients.map((_, position) => ({
        position, ingredientId: String(data.get(`ingredient_${position}`) ?? "") || null,
        rememberAlias: data.get(`remember_${position}`) === "on",
      })),
    });
    return redirect(`/recipes/${recipeId}`);
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Recipe could not be published" };
  }
}

function PendingImport({ status, message }: { status: string; message: string }) {
  const revalidator = useRevalidator();
  useEffect(() => {
    const timer = window.setInterval(() => revalidator.revalidate(), 2_000);
    return () => window.clearInterval(timer);
  }, [revalidator]);
  return <section className="ingestion-status"><LoaderCircle className="spin" size={24} /><div><h2>{status === "queued" ? "Waiting to start" : "Extracting recipe"}</h2><p>{message}</p></div></section>;
}

export default function RecipeImportReview({ loaderData, actionData }: Route.ComponentProps) {
  const { ingestion, candidates } = loaderData;
  const navigation = useNavigation();
  if (ingestion.status === "queued" || ingestion.status === "extracting") return <div className="page-shell"><Link className="back-link" to="/recipes"><ArrowLeft size={17} /> Back to recipes</Link><PendingImport status={ingestion.status} message={ingestion.progressMessage} /></div>;
  if (ingestion.status === "failed") return <div className="page-shell"><Link className="back-link" to="/recipes/new"><ArrowLeft size={17} /> Try another source</Link><section className="ingestion-status error"><AlertCircle size={24} /><div><h2>Extraction could not finish</h2><p>{ingestion.errorMessage}</p><code>{ingestion.errorCode}</code></div></section></div>;
  if (!ingestion.draft) return <div className="page-shell"><section className="ingestion-status error"><AlertCircle size={24} /><div><h2>No draft is available</h2><p>The source needs to be extracted again.</p></div></section></div>;
  const draft = ingestion.draft;
  return (
    <div className="page-shell recipe-review-page">
      <Link className="back-link" to="/recipes/new"><ArrowLeft size={17} /> Back to source</Link>
      <header className="page-header"><div><p className="eyebrow">Review extracted recipe</p><h1>Check before publishing</h1><p className="page-subtitle">Correct the fields and confirm ingredient matches. Nothing is added until you publish.</p></div><Badge>{ingestion.origin}</Badge></header>
      <Form method="post" className="recipe-review-form">
        <section className="review-section"><div className="section-heading"><div><p className="eyebrow">Recipe</p><h2>Basics</h2></div></div>
          <div className="review-fields"><label className="field-label full">Title<Input name="title" required maxLength={240} defaultValue={draft.title} /></label><label className="field-label full">Description<textarea name="description" rows={3} defaultValue={draft.description} /></label><label className="field-label">Servings<Input name="servings" type="number" min="0.1" max="1000" step="0.1" defaultValue={draft.servings ?? ""} /></label><label className="field-label">Serving size<Input name="servingSize" maxLength={120} defaultValue={draft.servingSize ?? ""} /></label><label className="field-label full">Tags<Input name="tags" defaultValue={draft.tags.join(", ")} placeholder="weeknight, vegetarian" /></label></div>
        </section>
        <section className="review-section"><div className="section-heading"><div><p className="eyebrow">Canonical mapping</p><h2>Ingredients</h2></div><span>{draft.ingredients.length} lines</span></div>
          <label className="field-label">Ingredient lines<textarea name="ingredients" rows={Math.max(6, Math.min(18, draft.ingredients.length + 1))} required defaultValue={draft.ingredients.join("\n")} /></label>
          <div className="mapping-list">{ingestion.ingredientReviews.map((review, index) => <div className="mapping-row" key={`${review.position}-${review.rawLine}`}><div><strong>{review.rawLine}</strong><span>Detected as {review.parsedName}</span></div><label>Ingredient<select name={`ingredient_${index}`} defaultValue={review.ingredientId ?? ""}><option value="">Keep unmapped</option>{candidates[index]?.map((candidate) => <option value={candidate.id} key={candidate.id}>{candidate.name}{candidate.category ? ` · ${candidate.category}` : ""}</option>)}</select></label><label className="remember-alias"><input type="checkbox" name={`remember_${index}`} /> Remember this match</label></div>)}</div>
        </section>
        <section className="review-section"><div className="section-heading"><div><p className="eyebrow">Method</p><h2>Instructions</h2></div><span>{draft.steps.length} steps</span></div><label className="field-label">One step per line<textarea name="steps" rows={Math.max(7, Math.min(20, draft.steps.length + 2))} required defaultValue={draft.steps.join("\n")} /></label></section>
        <section className="visibility-control"><label className="active"><input type="radio" name="visibility" value="user_private" defaultChecked /><LockKeyhole size={18} /><span><strong>Only me</strong><small>Private until you choose to share it.</small></span></label><label><input type="radio" name="visibility" value="household" /><Users size={18} /><span><strong>Household</strong><small>Available in shared plans and shopping lists.</small></span></label></section>
        {actionData?.error ? <p className="form-error" role="alert">{actionData.error}</p> : null}
        <div className="review-command-row"><Button type="submit" variant="ghost" name="intent" value="cancel">Cancel import</Button><Button type="submit" disabled={navigation.state === "submitting"}><Check size={17} /> {navigation.state === "submitting" ? "Publishing..." : "Publish recipe"}</Button></div>
      </Form>
    </div>
  );
}

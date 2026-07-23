import {
  AlertCircle,
  ArrowLeft,
  Bookmark,
  BookmarkPlus,
  CalendarDays,
  CalendarPlus,
  Check,
  ChevronDown,
  ChevronRight,
  FileCheck2,
  FileDown,
  FileImage,
  FileText,
  Heart,
  LoaderCircle,
  LockKeyhole,
  Minus,
  Pencil,
  Plus,
  Save,
  Scale,
  Search,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  Upload,
  Users,
  X,
} from "lucide-react";
import { ChangeEvent, DragEvent, FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import {
  cachedRequest,
  errorMessage,
  Invitation,
  json,
  lines,
  MealPlan,
  MealPlanItemContext,
  patch,
  Preferences,
  RecipeDetail,
  RecipeDraft,
  RecipeIngestion,
  RecipeSearchResult,
  RecipeSummary,
  remove,
  request,
  SavedSearch,
  put,
} from "../api";
import { Badge, Button, Input, Select } from "../components/ui";
import { displayIngredientLine, plannedServings, readMealPlanSelection } from "../lib/domain";

type Scope = "all" | "catalog" | "mine" | "household";
type TagMatch = "all" | "any";
interface Facet { name: string; recipeCount: number }

function recipeParams(params: URLSearchParams, cursor?: string | null) {
  const result = new URLSearchParams();
  for (const key of ["q", "ingredient", "tag", "tagMatch", "scope"]) {
    params.getAll(key).forEach((value) => value && result.append(key, value));
  }
  result.set("limit", "24");
  if (cursor) result.set("cursor", cursor);
  return result;
}

function selectionSuffix(params: URLSearchParams) {
  const next = new URLSearchParams();
  for (const key of ["planWeek", "planDate", "planSlot"]) {
    const value = params.get(key);
    if (value) next.set(key, value);
  }
  return next.toString();
}

function RecipeCard({ recipe, suffix = "" }: { recipe: RecipeSummary; suffix?: string }) {
  return <Link to={`/recipes/${recipe.id}${suffix ? `?${suffix}` : ""}`} className="recipe-card">
    <div className="recipe-card-top"><h2 title={recipe.name}>{recipe.name}</h2><ChevronRight size={18} /></div>
    <div className="recipe-card-body"><p>{recipe.description || recipe.ingredients.slice(0, 4).join(", ") || "Open for ingredients and instructions."}</p></div>
    <div className="recipe-meta"><span><Users size={15} /> {recipe.servings ?? "?"} servings</span><div className="tag-row">{recipe.tags.slice(0, 2).map((tag) => <Badge key={tag}>{tag}</Badge>)}</div></div>
  </Link>;
}

export function RecipesPage() {
  const [params, setParams] = useSearchParams();
  const [result, setResult] = useState<RecipeSearchResult>();
  const [facets, setFacets] = useState<Facet[]>([]);
  const [saved, setSaved] = useState<SavedSearch[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [showSave, setShowSave] = useState(false);
  const [showAllFacets, setShowAllFacets] = useState(false);
  const [facetsOpen, setFacetsOpen] = useState(false);
  const [facetQuery, setFacetQuery] = useState("");
  const queryKey = params.toString();
  const tags = params.getAll("tag");
  const scope = (params.get("scope") ?? "all") as Scope;
  const tagMatch = (params.get("tagMatch") === "any" ? "any" : "all") as TagMatch;
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    Promise.all([
      request<RecipeSearchResult>(`/api/v1/recipes/search?${recipeParams(params)}`, {}, controller.signal),
      cachedRequest<SavedSearch[]>("/api/v1/saved-searches"),
    ]).then(([recipes, searches]) => {
      setResult(recipes);
      setSaved(searches);
    }).catch((cause) => {
      if (!(cause instanceof DOMException && cause.name === "AbortError")) setError(errorMessage(cause, "The recipe catalog is unavailable."));
    }).finally(() => setLoading(false));
    return () => controller.abort();
  }, [queryKey]);
  useEffect(() => {
    if (!facetsOpen) return;
    void cachedRequest<Facet[]>(
      `/api/v1/recipes/facets?${new URLSearchParams({ q: params.get("q") ?? "", ingredient: params.get("ingredient") ?? "", scope })}`,
      15_000,
    ).then(setFacets).catch((cause) => setError(errorMessage(cause, "Recipe filters could not be loaded.")));
  }, [facetsOpen, params.get("q"), params.get("ingredient"), scope]);
  const visibleFacets = useMemo(() => {
    const normalized = facetQuery.trim().toLowerCase();
    const matching = normalized ? facets.filter((facet) => facet.name.toLowerCase().includes(normalized)) : facets;
    return [...new Map([...facets.filter((facet) => tags.includes(facet.name)), ...matching.slice(0, normalized || showAllFacets ? 48 : 16)].map((facet) => [facet.name, facet])).values()];
  }, [facetQuery, facets, tags.join("|"), showAllFacets]);
  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const next = new URLSearchParams();
    for (const key of ["q", "ingredient", "tag", "tagMatch", "scope", "planWeek", "planDate", "planSlot"]) {
      data.getAll(key).forEach((value) => String(value).trim() && next.append(key, String(value).trim()));
    }
    setParams(next);
  }
  async function saveSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = String(new FormData(event.currentTarget).get("name") ?? "");
    await request("/api/v1/saved-searches", json({
      name,
      query: params.get("q"),
      ingredient: params.get("ingredient"),
      tags,
      tagMatch,
      scope,
    }));
    setSaved(await request("/api/v1/saved-searches"));
    setShowSave(false);
  }
  async function deleteSaved(id: string) {
    await request(`/api/v1/saved-searches/${id}`, remove());
    setSaved((current) => current.filter((item) => item.id !== id));
  }
  async function loadMore() {
    if (!result?.hasMore || loadingMore) return;
    setLoadingMore(true);
    try {
      const page = await request<RecipeSearchResult>(`/api/v1/recipes/search?${recipeParams(params, result.nextCursor)}`);
      const existingIds = new Set(result.recipes.map((item) => item.id));
      const recipes = [...result.recipes, ...page.recipes.filter((item) => !existingIds.has(item.id))];
      setResult({
        ...page,
        recipes,
        total: { value: recipes.length + (page.hasMore ? 1 : 0), relation: page.hasMore ? "lowerBound" : "exact" },
      });
    } finally { setLoadingMore(false); }
  }
  const filterCount = Number(Boolean(params.get("q"))) + Number(Boolean(params.get("ingredient"))) + tags.length + Number(scope !== "all");
  const planSuffix = selectionSuffix(params);
  return <div className="page-shell recipes-page">
    <header className="page-header"><div><p className="eyebrow">Family recipe library</p><h1>Find dinner without the debate</h1><p className="page-subtitle">{params.get("planDate") ? `Choose a recipe for ${params.get("planDate")} ${params.get("planSlot")}.` : "Search the catalog, combine tag filters, and keep useful searches close."}</p></div><div className="header-actions"><Button variant="secondary" onClick={() => setShowSave(!showSave)} disabled={!filterCount}><BookmarkPlus size={17} /> Save search</Button><Link className="button button-primary button-default" to="/recipes/new"><Plus size={17} /> Add recipe</Link></div></header>
    {showSave && <form className="save-search-form" onSubmit={saveSearch}><Input name="name" maxLength={80} required placeholder="Name this search" autoFocus /><Button><BookmarkPlus size={16} /> Save</Button><Button type="button" variant="ghost" size="icon" onClick={() => setShowSave(false)}><X size={17} /></Button></form>}
    {!!saved.length && <section className="saved-searches"><div className="saved-searches-heading"><Bookmark size={16} /><h2>Saved searches</h2></div><div className="saved-search-list">{saved.map((item) => {
      const target = new URLSearchParams();
      if (item.query) target.set("q", item.query);
      if (item.ingredient) target.set("ingredient", item.ingredient);
      item.tags.forEach((tag) => target.append("tag", tag));
      target.set("tagMatch", item.tagMatch);
      target.set("scope", item.scope);
      return <div className="saved-search-item" key={item.id}><Link to={`/recipes?${target}`}>{item.name}<span>{item.tags.length ? `${item.tags.length} tags` : item.query || item.ingredient}</span></Link><Button variant="ghost" size="icon" onClick={() => deleteSaved(item.id)} aria-label={`Delete ${item.name}`}><Trash2 size={15} /></Button></div>;
    })}</div></section>}
    <nav className="recipe-scope-tabs" aria-label="Recipe library">{([["all", "All recipes"], ["catalog", "Catalog"], ["mine", "My recipes"], ["household", "Household"]] as const).map(([value, label]) => {
      const next = new URLSearchParams(params);
      next.set("scope", value);
      return <Link key={value} className={scope === value ? "active" : ""} to={`/recipes?${next}`}>{label}</Link>;
    })}</nav>
    <form className="recipe-search" role="search" onSubmit={submitSearch} key={queryKey}>
      <input type="hidden" name="scope" value={scope} />{["planWeek", "planDate", "planSlot"].map((key) => params.get(key) && <input key={key} type="hidden" name={key} value={params.get(key)!} />)}
      <div className="search-bar"><Search size={20} /><Input className="search-query" name="q" defaultValue={params.get("q") ?? ""} placeholder="Try quick chickpea dinners" /><Input className="search-ingredient" name="ingredient" defaultValue={params.get("ingredient") ?? ""} placeholder="Ingredient" /><Button>Search</Button></div>
      <details className="facet-panel" onToggle={(event) => setFacetsOpen(event.currentTarget.open)}><summary><span><SlidersHorizontal size={17} /> Tag filters {tags.length > 0 && <Badge>{tags.length}</Badge>}</span><ChevronDown size={17} /></summary><div className="facet-panel-body">
        <div className="facet-toolbar"><Input value={facetQuery} onChange={(event) => setFacetQuery(event.target.value)} placeholder="Find a tag" /><fieldset className="tag-match-control"><legend>Match selected tags</legend><label className={tagMatch === "all" ? "active" : ""}><input type="radio" name="tagMatch" value="all" defaultChecked={tagMatch === "all"} />All</label><label className={tagMatch === "any" ? "active" : ""}><input type="radio" name="tagMatch" value="any" defaultChecked={tagMatch === "any"} />Any</label></fieldset></div>
        <div className="facet-options">{visibleFacets.map((facet) => <label className="facet-option" key={facet.name}><input type="checkbox" name="tag" value={facet.name} defaultChecked={tags.includes(facet.name)} /><span>{facet.name}</span><strong>{facet.recipeCount.toLocaleString()}</strong></label>)}</div>
        <div className="facet-actions">{!facetQuery && facets.length > 16 ? <Button type="button" variant="ghost" size="sm" onClick={() => setShowAllFacets(!showAllFacets)}>{showAllFacets ? "Show fewer" : "Show more tags"}</Button> : <span />}<Button size="sm">Apply filters</Button></div>
      </div></details>
    </form>
    {(tags.length > 0 || params.get("q") || params.get("ingredient")) && <div className="active-filters">{tags.map((tag) => {
      const next = new URLSearchParams(params);
      next.delete("tag");
      tags.filter((value) => value !== tag).forEach((value) => next.append("tag", value));
      return <Link className="filter-chip" key={tag} to={`/recipes?${next}`}>{tag}<X size={13} /></Link>;
    })}<Link className="clear-filters" to={`/recipes?scope=${scope}`}>Clear filters</Link></div>}
    {error && <section className="setup-state"><AlertCircle size={22} /><div><h2>The recipe catalog is temporarily unavailable</h2><p>{error}</p></div></section>}
    {loading && <p className="recipe-load-sentinel"><LoaderCircle className="spin" size={18} /> Loading recipes</p>}
    {result && !loading && <><div className="result-heading"><div><strong>{result.total ? `${result.total.value.toLocaleString()}${result.total.relation === "lowerBound" ? "+" : ""}` : `${result.recipes.length}+`}</strong> recipes</div><span>{tags.length ? `Matching ${tagMatch} selected tags` : params.get("q") ? `Results for “${params.get("q")}”` : "Browse the recipe catalog"}</span></div>
      {result.recipes.length ? <><div className="recipe-grid">{result.recipes.map((recipe) => <RecipeCard recipe={recipe} suffix={planSuffix} key={recipe.id} />)}</div><div className="recipe-load-sentinel">{result.hasMore ? <Button variant="secondary" onClick={loadMore} disabled={loadingMore}>{loadingMore && <LoaderCircle className="spin" size={17} />}Load more</Button> : <span>All {result.recipes.length.toLocaleString()} recipes loaded</span>}</div></> : <section className="empty-state"><Search size={24} /><h2>No matching recipes</h2><p>Try fewer tags or switch from All to Any.</p></section>}
    </>}
  </div>;
}

function draftFromRecipe(recipe: RecipeDetail): RecipeDraft {
  return {
    title: recipe.name,
    description: recipe.description,
    servings: recipe.servings,
    servingSize: recipe.servingSize,
    ingredients: recipe.recipeIngredients.map((item) => item.rawLine),
    steps: recipe.steps.map((step) => step.instruction),
    tags: recipe.tags,
    warnings: recipe.qualityFlags,
  };
}

function RecipeForm({ draft, submitLabel, pending, error, onSubmit }: { draft: RecipeDraft; submitLabel: string; pending: boolean; error: string; onSubmit(event: FormEvent<HTMLFormElement>): void }) {
  return <form className="recipe-review-form" onSubmit={onSubmit}>
    <section className="review-section"><div className="review-fields"><label className="field-label full">Title<Input name="title" required maxLength={240} defaultValue={draft.title} /></label><label className="field-label full">Description<textarea name="description" rows={3} maxLength={4000} defaultValue={draft.description} /></label><label className="field-label">Servings<Input name="servings" type="number" min=".25" max="1000" step=".25" defaultValue={draft.servings ?? ""} /></label><label className="field-label">Serving size<Input name="servingSize" maxLength={120} defaultValue={draft.servingSize ?? ""} /></label><label className="field-label full">Tags<Input name="tags" defaultValue={draft.tags.join(", ")} /></label></div></section>
    <section className="review-section"><div className="section-heading"><h2>Ingredients</h2><span>{draft.ingredients.length} lines</span></div><label className="field-label">One ingredient per line<textarea name="ingredients" required rows={Math.max(7, draft.ingredients.length + 1)} defaultValue={draft.ingredients.join("\n")} /></label></section>
    <section className="review-section"><div className="section-heading"><h2>Instructions</h2><span>{draft.steps.length} steps</span></div><label className="field-label">One step per line<textarea name="steps" required rows={Math.max(7, draft.steps.length + 2)} defaultValue={draft.steps.join("\n")} /></label></section>
    {error && <p className="form-error" role="alert">{error}</p>}<div className="review-command-row"><Link className="button button-ghost button-default" to="/recipes">Cancel</Link><Button disabled={pending}><Save size={17} /> {pending ? "Saving…" : submitLabel}</Button></div>
  </form>;
}

function draftFromForm(data: FormData): RecipeDraft {
  return {
    title: String(data.get("title") ?? ""),
    description: String(data.get("description") ?? ""),
    servings: Number(data.get("servings")) || null,
    servingSize: String(data.get("servingSize") ?? "") || null,
    ingredients: lines(data.get("ingredients")),
    steps: lines(data.get("steps")),
    tags: String(data.get("tags") ?? "").split(",").map((tag) => tag.trim()).filter(Boolean),
    warnings: [],
  };
}

export function RecipeDetailPage() {
  const { recipeId = "" } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [recipe, setRecipe] = useState<RecipeDetail>();
  const [preferences, setPreferences] = useState<Preferences>();
  const [favorite, setFavorite] = useState(false);
  const [servings, setServings] = useState<number | null>(null);
  const [planContext, setPlanContext] = useState<MealPlanItemContext | null>(null);
  const [error, setError] = useState("");
  const [planError, setPlanError] = useState("");
  const [addingToPlan, setAddingToPlan] = useState(false);
  useEffect(() => {
    const planItem = params.get("planItem");
    Promise.all([
      request<RecipeDetail>(`/api/v1/recipes/${encodeURIComponent(recipeId)}`),
      cachedRequest<Preferences>("/api/v1/preferences"),
      request<{ favourite: boolean }>(`/api/v1/recipes/${encodeURIComponent(recipeId)}/favourite`),
      planItem ? request<MealPlanItemContext>(`/api/v1/meal-plan-items/${encodeURIComponent(planItem)}`) : Promise.resolve(null),
    ]).then(([detail, prefs, favouriteState, context]) => {
      if (context && context.recipeId !== detail.id) throw new Error("Meal-plan entry does not match this recipe.");
      setRecipe(detail);
      setPreferences(prefs);
      const requested = Number(params.get("servings"));
      setPlanContext(context);
      setServings(context?.servings ?? (Number.isFinite(requested) && requested > 0 ? requested : detail.servings));
      setFavorite(favouriteState.favourite);
    }).catch((cause) => setError(errorMessage(cause, "Recipe could not be loaded.")));
  }, [recipeId, params.get("planItem")]);
  async function toggleFavorite() {
    await request(`/api/v1/recipes/${recipeId}/favourite`, put({ favourite: !favorite }));
    setFavorite(!favorite);
  }
  async function toggleVisibility() {
    if (!recipe) return;
    const visibility = recipe.visibility === "user_private" ? "household" : "user_private";
    await request(`/api/v1/recipes/${recipe.id}`, put({ visibility, draft: draftFromRecipe(recipe) }));
    setRecipe({ ...recipe, visibility });
  }
  async function updatePlannedServings(next: number) {
    if (!planContext) return;
    const updated = await request<MealPlan>(`/api/v1/meal-plan-items/${planContext.itemId}`, patch({ servings: next }));
    const item = updated.items.find((candidate) => candidate.id === planContext.itemId);
    if (!item) return;
    setServings(item.servings);
    setPlanContext({ ...planContext, servings: item.servings });
  }
  async function addToSelectedPlan() {
    if (!recipe) return;
    const selection = readMealPlanSelection(params);
    if (!selection) return;
    setAddingToPlan(true);
    setPlanError("");
    try {
      await request<MealPlan>("/api/v1/meal-plans", json({
        week: selection.week,
        recipeId: recipe.id,
        date: selection.date,
        slot: selection.slot,
        servings: plannedServings(servings ?? recipe.servings),
        notes: null,
      }));
      navigate(`/plan?week=${selection.week}`);
    } catch (cause) {
      setPlanError(errorMessage(cause, "Meal could not be added."));
    } finally {
      setAddingToPlan(false);
    }
  }
  if (error) return <div className="page-shell"><section className="setup-state"><AlertCircle size={22} /><p>{error}</p></section></div>;
  if (!recipe || !preferences) return <div className="page-shell"><p className="recipe-load-sentinel"><LoaderCircle className="spin" /> Loading recipe</p></div>;
  const scale = servings && recipe.servings ? servings / recipe.servings : 1;
  const planSelection = readMealPlanSelection(params);
  const servingsForPlan = plannedServings(servings ?? recipe.servings);
  const selectedSlotLabel = preferences.mealSlots.find((slot) => slot.id === planSelection?.slot)?.label;
  return <div className="page-shell detail-page">
    <Link to={planContext ? `/plan?week=${planContext.startsOn}` : "/recipes"} className="back-link"><ArrowLeft size={17} /> {planContext ? "Back to meal plan" : "Back to recipes"}</Link>
    {planContext && <section className="recipe-plan-context"><CalendarDays size={20} /><div><p className="eyebrow">Viewing from meal plan</p><strong>{planContext.planName}</strong><span>{planContext.plannedDate} · {planContext.mealSlot} · {planContext.servings} servings</span></div><Link to={`/plan?week=${planContext.startsOn}`}>View week</Link></section>}
    <header className="detail-header"><div><div className="tag-row">{recipe.visibility !== "catalog" && <Badge>{recipe.visibility === "user_private" ? "Only me" : "Household"}</Badge>}{recipe.tags.slice(0, 5).map((tag) => <Badge key={tag}>{tag}</Badge>)}</div><h1>{recipe.name}</h1><p>{recipe.description || "A recipe from the family catalog."}</p><div className="detail-meta"><span><Users size={17} /> {servings ?? "Unknown"} servings</span><span><Scale size={17} /> {preferences.measurementSystem === "original" ? "Original units" : preferences.measurementSystem === "metric" ? "Metric units" : "US customary units"}</span></div></div>
      <div className="detail-actions"><a className="button button-secondary button-default" target="_blank" rel="noreferrer" href={`/api/v1/recipes/${recipe.id}/pdf`}><FileDown size={17} /> PDF</a><Button variant="secondary" size="icon" onClick={toggleFavorite} title={favorite ? "Remove favorite" : "Save favorite"}><Heart size={18} fill={favorite ? "currentColor" : "none"} /></Button>{recipe.isOwner && <Link className="button button-secondary button-icon" to={`/recipes/${recipe.id}/edit`}><Pencil size={17} /></Link>}{recipe.isOwner && <Button variant="secondary" onClick={toggleVisibility}>{recipe.visibility === "user_private" ? <Users size={17} /> : <LockKeyhole size={17} />}{recipe.visibility === "user_private" ? "Share" : "Make private"}</Button>}{planContext ? <Link className="button button-primary button-default" to={`/plan?week=${planContext.startsOn}`}><CalendarDays size={18} /> View meal plan</Link> : recipe.visibility !== "user_private" && (planSelection ? <Button onClick={addToSelectedPlan} disabled={addingToPlan}><CalendarPlus size={18} /> {addingToPlan ? "Adding…" : `Add to ${selectedSlotLabel ?? planSelection.slot}`}</Button> : <Link className="button button-primary button-default" to={`/plan?add=${recipe.id}&servings=${servingsForPlan}`}><CalendarPlus size={18} /> Add to plan</Link>)}</div>
    </header>
    {planError && <p className="form-error" role="alert">{planError}</p>}
    <div className="detail-columns"><section className="ingredients-panel"><div className="section-heading ingredient-heading"><div><p className="eyebrow">For the table</p><h2>Ingredients</h2></div>{servings !== null && (planContext ? <div className="serving-adjuster planned-serving-adjuster"><button className="serving-step" onClick={() => updatePlannedServings(Math.max(.25, servings - (servings < 1 ? .25 : 1)))}><Minus size={15} /></button><label>Planned servings<Input value={servings} type="number" min=".25" max="100" step=".25" onChange={(event) => setServings(Number(event.target.value))} onBlur={() => updatePlannedServings(servings)} /></label><button className="serving-step" onClick={() => updatePlannedServings(Math.min(100, servings + (servings < 1 ? .25 : 1)))}><Plus size={15} /></button></div> : <div className="serving-adjuster"><button className="serving-step" onClick={() => setServings(Math.max(.25, servings - (servings < 1 ? .25 : 1)))}><Minus size={15} /></button><label>Servings<Input value={servings} type="number" min=".25" max="1000" step=".25" onChange={(event) => setServings(Number(event.target.value))} /></label><button className="serving-step" onClick={() => setServings(Math.min(1000, servings + (servings < 1 ? .25 : 1)))}><Plus size={15} /></button></div>)}</div><ul className="ingredient-list">{recipe.recipeIngredients.map((item) =>
      <li key={item.id}><span className={`parse-dot ${item.parseStatus}`} /><span>{displayIngredientLine(item, preferences.measurementSystem, scale)}</span></li>
    )}</ul></section><section className="steps-panel"><div className="section-heading"><div><p className="eyebrow">Method</p><h2>Steps</h2></div><span>{recipe.steps.length} steps</span></div><ol className="step-list">{recipe.steps.map((step) => <li key={step.position}><span>{step.position + 1}</span><p>{step.instruction}</p></li>)}</ol></section></div>
  </div>;
}

export function RecipeCreatePage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<"paste" | "upload">("paste");
  const [file, setFile] = useState<File | null>(null);
  const [drag, setDrag] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const input = useRef<HTMLInputElement>(null);
  function accept(next: File) {
    const allowed = ["text/plain", "text/markdown", "application/pdf", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "application/vnd.oasis.opendocument.text", "image/jpeg", "image/png", "image/webp"];
    if (!allowed.includes(next.type) && !/\.(txt|md|pdf|docx|odt|jpe?g|png|webp)$/i.test(next.name)) { setError("Use TXT, Markdown, PDF, DOCX, ODT, JPEG, PNG, or WebP."); return; }
    setFile(next);
    setError("");
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError("");
    const data = new FormData(event.currentTarget);
    try {
      const ingestion = mode === "paste"
        ? await request<RecipeIngestion>("/api/v1/recipe-ingestions", json({ text: String(data.get("recipeText") ?? ""), filename: null }))
        : await request<RecipeIngestion>("/api/v1/recipe-ingestions", { method: "POST", body: (() => { const body = new FormData(); if (file) body.set("file", file); return body; })() });
      navigate(`/recipes/import/${ingestion.id}`);
    } catch (cause) { setError(errorMessage(cause, "Recipe extraction could not be started.")); }
    finally { setPending(false); }
  }
  return <div className="page-shell recipe-create-page"><header className="page-header"><div><p className="eyebrow">Private recipe</p><h1>Add a recipe</h1><p className="page-subtitle">Import the source, review every field, then publish it to your library.</p></div></header>
    <div className="source-mode-tabs" role="tablist"><button type="button" className={mode === "paste" ? "active" : ""} onClick={() => setMode("paste")}><FileText size={17} /> Paste text</button><button type="button" className={mode === "upload" ? "active" : ""} onClick={() => setMode("upload")}><Upload size={17} /> Upload file or image</button></div>
    <form className="recipe-source-form" onSubmit={submit}>{mode === "paste" ? <label className="field-label">Recipe text<textarea name="recipeText" rows={18} maxLength={102400} required placeholder={"Weeknight lentil soup\nServes 4\n\nIngredients\n1 cup lentils\n\nInstructions\nRinse the lentils"} /></label> : <div className="file-upload-field"><div className={`file-drop${drag ? " drag-active" : ""}`} onDragOver={(event) => { event.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)} onDrop={(event: DragEvent) => { event.preventDefault(); setDrag(false); if (event.dataTransfer.files[0]) accept(event.dataTransfer.files[0]); }}><input ref={input} className="file-input-overlay" type="file" accept=".txt,.md,.pdf,.docx,.odt,.jpg,.jpeg,.png,.webp" onChange={(event: ChangeEvent<HTMLInputElement>) => event.target.files?.[0] && accept(event.target.files[0])} /><FileImage size={30} /><strong>{drag ? "Drop recipe file" : "Choose or drop a recipe file"}</strong><span>TXT, Markdown, PDF, DOCX, ODT, JPEG, PNG, or WebP</span></div>{file && <div className="selected-upload"><FileCheck2 size={20} /><span><strong>{file.name}</strong><small>{Math.max(1, Math.round(file.size / 1024))} KB</small></span><Button type="button" variant="ghost" size="icon" onClick={() => setFile(null)}><X size={17} /></Button></div>}</div>}
      {error && <p className="form-error" role="alert">{error}</p>}<p className="ai-processing-notice">When cloud extraction is enabled, the source is sent to the configured model provider. Do not include unrelated personal or confidential information.</p><div className="form-command-row"><Button disabled={pending || (mode === "upload" && !file)}><Sparkles size={17} /> {pending ? "Preparing recipe…" : "Extract recipe"}</Button></div>
    </form>
  </div>;
}

export function RecipeReviewPage() {
  const { ingestionId = "" } = useParams();
  const navigate = useNavigate();
  const [ingestion, setIngestion] = useState<RecipeIngestion>();
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  useEffect(() => {
    let timer = 0;
    let attempt = 0;
    let stopped = false;
    let controller: AbortController | null = null;
    const load = async () => {
      if (stopped) return;
      if (document.hidden) {
        timer = window.setTimeout(load, 5_000);
        return;
      }
      controller = new AbortController();
      try {
        const next = await request<RecipeIngestion>(`/api/v1/recipe-ingestions/${ingestionId}`, {}, controller.signal);
        setIngestion(next);
        if (next.status === "queued" || next.status === "extracting") {
          const delay = Math.min(2_000 * 2 ** attempt++, 10_000);
          timer = window.setTimeout(load, delay);
        }
      } catch (cause) {
        if (!(cause instanceof DOMException && cause.name === "AbortError")) setError(errorMessage(cause, "Recipe import could not be loaded."));
      }
    };
    const resume = () => {
      if (!document.hidden) {
        window.clearTimeout(timer);
        void load();
      }
    };
    document.addEventListener("visibilitychange", resume);
    void load();
    return () => {
      stopped = true;
      window.clearTimeout(timer);
      controller?.abort();
      document.removeEventListener("visibilitychange", resume);
    };
  }, [ingestionId]);
  async function publish(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    try {
      const data = new FormData(event.currentTarget);
      const ingredientSelections = (ingestion?.ingredientReviews ?? []).map((review) => ({
        position: review.position,
        ingredientId: String(data.get(`ingredient_${review.position}`) ?? "") || null,
        rememberAlias: data.get(`remember_${review.position}`) === "on",
      }));
      const result = await request<{ recipeId: string }>(`/api/v1/recipe-ingestions/${ingestionId}`, json({
        visibility: data.get("visibility"),
        draft: draftFromForm(data),
        ingredientSelections,
      }));
      navigate(`/recipes/${result.recipeId}`);
    } catch (cause) { setError(errorMessage(cause, "Recipe could not be published.")); }
    finally { setPending(false); }
  }
  if (error && !ingestion) return <div className="page-shell"><section className="ingestion-status error"><AlertCircle size={24} /><div><h2>Import unavailable</h2><p>{error}</p></div></section></div>;
  if (!ingestion || ingestion.status === "queued" || ingestion.status === "extracting") return <div className="page-shell"><Link className="back-link" to="/recipes"><ArrowLeft size={17} /> Back to recipes</Link><section className="ingestion-status"><LoaderCircle className="spin" size={24} /><div><h2>{ingestion?.status === "extracting" ? "Extracting recipe" : "Waiting to start"}</h2><p>{ingestion?.message ?? "Loading import status."}</p></div></section></div>;
  if (ingestion.status === "failed" || !ingestion.draft) return <div className="page-shell"><Link className="back-link" to="/recipes/new"><ArrowLeft size={17} /> Try another source</Link><section className="ingestion-status error"><AlertCircle size={24} /><div><h2>Extraction could not finish</h2><p>{ingestion.message}</p></div></section></div>;
  return <div className="page-shell recipe-review-page"><Link className="back-link" to="/recipes/new"><ArrowLeft size={17} /> Back to source</Link><header className="page-header"><div><p className="eyebrow">Review extracted recipe</p><h1>Check before publishing</h1><p className="page-subtitle">Correct every field before adding it to the library.</p></div><Badge>{ingestion.filename ? "upload" : "paste"}</Badge></header>
    <form className="recipe-review-form" onSubmit={publish}><section className="review-section"><div className="review-fields"><label className="field-label full">Title<Input name="title" required defaultValue={ingestion.draft.title} /></label><label className="field-label full">Description<textarea name="description" rows={3} defaultValue={ingestion.draft.description} /></label><label className="field-label">Servings<Input name="servings" type="number" min=".25" step=".25" defaultValue={ingestion.draft.servings ?? ""} /></label><label className="field-label">Serving size<Input name="servingSize" defaultValue={ingestion.draft.servingSize ?? ""} /></label><label className="field-label full">Tags<Input name="tags" defaultValue={ingestion.draft.tags.join(", ")} /></label></div></section><section className="review-section"><div className="section-heading"><h2>Ingredients</h2><span>{ingestion.draft.ingredients.length} lines</span></div><label className="field-label">One ingredient per line<textarea name="ingredients" required rows={Math.max(7, ingestion.draft.ingredients.length + 1)} defaultValue={ingestion.draft.ingredients.join("\n")} /></label>
      {!!ingestion.ingredientReviews.length && <div className="mapping-list">{ingestion.ingredientReviews.map((review) => <div className="mapping-row" key={`${review.position}-${review.rawLine}`}><div><strong>{review.rawLine}</strong><span>Detected as {review.parsedName}</span></div><label>Ingredient<Select name={`ingredient_${review.position}`} defaultValue={review.ingredientId ?? ""}><option value="">Keep unmapped</option>{review.candidates.map((candidate) => <option value={candidate.id} key={candidate.id}>{candidate.name}{candidate.category ? ` · ${candidate.category}` : ""}</option>)}</Select></label><label className="remember-alias"><input type="checkbox" name={`remember_${review.position}`} /> Remember this match</label></div>)}</div>}
    </section><section className="review-section"><div className="section-heading"><h2>Instructions</h2><span>{ingestion.draft.steps.length} steps</span></div><label className="field-label">One step per line<textarea name="steps" required rows={Math.max(7, ingestion.draft.steps.length + 2)} defaultValue={ingestion.draft.steps.join("\n")} /></label></section><section className="visibility-control"><label className="active"><input type="radio" name="visibility" value="user_private" defaultChecked /><LockKeyhole size={18} /><span><strong>Only me</strong><small>Private until you choose to share it.</small></span></label><label><input type="radio" name="visibility" value="household" /><Users size={18} /><span><strong>Household</strong><small>Available in shared plans.</small></span></label></section>{error && <p className="form-error">{error}</p>}<div className="review-command-row"><Link className="button button-ghost button-default" to="/recipes">Cancel import</Link><Button disabled={pending}><Check size={17} /> {pending ? "Publishing…" : "Publish recipe"}</Button></div></form>
  </div>;
}

export function RecipeEditPage() {
  const { recipeId = "" } = useParams();
  const navigate = useNavigate();
  const [recipe, setRecipe] = useState<RecipeDetail>();
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  useEffect(() => { request<RecipeDetail>(`/api/v1/recipes/${recipeId}`).then((value) => value.isOwner ? setRecipe(value) : setError("Recipe not found.")).catch((cause) => setError(errorMessage(cause, "Recipe not found."))); }, [recipeId]);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!recipe) return;
    setPending(true);
    try {
      await request(`/api/v1/recipes/${recipe.id}`, put({ visibility: recipe.visibility, draft: draftFromForm(new FormData(event.currentTarget)) }));
      navigate(`/recipes/${recipe.id}`);
    } catch (cause) { setError(errorMessage(cause, "Recipe could not be saved.")); }
    finally { setPending(false); }
  }
  if (!recipe) return <div className="page-shell">{error ? <p className="form-error">{error}</p> : <p className="recipe-load-sentinel">Loading recipe…</p>}</div>;
  return <div className="page-shell recipe-review-page"><Link className="back-link" to={`/recipes/${recipe.id}`}><ArrowLeft size={17} /> Back to recipe</Link><header className="page-header"><div><p className="eyebrow">My recipe</p><h1>Edit recipe</h1><p className="page-subtitle">Saving rechecks the recipe and refreshes search.</p></div></header><RecipeForm draft={draftFromRecipe(recipe)} submitLabel="Save changes" pending={pending} error={error} onSubmit={submit} /></div>;
}

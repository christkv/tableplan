import { AlertCircle, Bookmark, BookmarkPlus, ChevronDown, ChevronRight, LoaderCircle, Plus, Search, SlidersHorizontal, Trash2, Users, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Form, Link, redirect } from "react-router";

import type { Route } from "./+types/recipes";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { cloudflareContext } from "../context";
import { requireRequestSession } from "../../src/auth/server";
import { createStorageClient } from "../../src/storage";
import { savedRecipeSearchUrl, type SavedRecipeSearch } from "../../src/domain/saved-searches";
import { normalizeRecipeScope, normalizeRecipeTags, normalizeTagMatch, recipeSearchApiUrl, recipeSearchUrl } from "../../src/domain/recipe-search";
import type { RecipeSearchResult, RecipeSearchScope, RecipeSummary, RecipeTagMatch, RecipeTagOption } from "../../src/domain/recipes";
import { readMealPlanSelection, withMealPlanSelection, type MealPlanSelection } from "../../src/domain/planning/selection";

interface LoaderData {
  result: RecipeSearchResult;
  query: string;
  ingredient: string;
  selectedTags: string[];
  tagMatch: RecipeTagMatch;
  scope: RecipeSearchScope;
  facets: RecipeTagOption[];
  savedSearches: SavedRecipeSearch[];
  planSelection: MealPlanSelection | null;
  planSlotLabel: string | null;
  unavailable?: string;
}

function readFilters(url: URL) {
  return {
    query: url.searchParams.get("q") ?? "",
    ingredient: url.searchParams.get("ingredient") ?? "",
    tags: normalizeRecipeTags(url.searchParams.getAll("tag")),
    tagMatch: normalizeTagMatch(url.searchParams.get("tagMatch")),
    scope: normalizeRecipeScope(url.searchParams.get("scope")),
  };
}

function formFilters(data: FormData) {
  return {
    query: String(data.get("q") ?? ""),
    ingredient: String(data.get("ingredient") ?? ""),
    tags: normalizeRecipeTags(data.getAll("tag")),
    tagMatch: normalizeTagMatch(data.get("tagMatch")),
    scope: normalizeRecipeScope(data.get("scope")),
  };
}

export async function loader({ request, context }: Route.LoaderArgs): Promise<LoaderData> {
  const url = new URL(request.url);
  const filters = readFilters(url);
  const planSelection = readMealPlanSelection(url.searchParams);
  const empty: RecipeSearchResult = { recipes: [], total: 0, limit: 24, offset: 0 };
  const { env, ctx } = context.get(cloudflareContext);
  const session = await requireRequestSession(request, env, ctx);
  const storage = createStorageClient(env);
  const access = { userId: session.user.id, householdId: session.householdId };
  try {
    const [result, facets, savedSearches, mealSlots] = await Promise.all([
      storage.searchRecipes(filters, access), storage.listRecipeTagFacets(filters, access),
      storage.listSavedRecipeSearches(access), storage.getMealPlanSlots(access),
    ]);
    return { result, query: filters.query, ingredient: filters.ingredient, selectedTags: filters.tags, tagMatch: filters.tagMatch, scope: filters.scope, facets, savedSearches, planSelection, planSlotLabel: mealSlots.find((slot) => slot.id === planSelection?.slot)?.label ?? null };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Database unavailable";
    return { result: empty, query: filters.query, ingredient: filters.ingredient, selectedTags: filters.tags, tagMatch: filters.tagMatch, scope: filters.scope, facets: [], savedSearches: [], planSelection, planSlotLabel: null, unavailable: message };
  }
}

export async function action({ request, context }: Route.ActionArgs) {
  const { env, ctx } = context.get(cloudflareContext);
  const session = await requireRequestSession(request, env, ctx);
  const data = await request.formData();
  const filters = formFilters(data);
  const planSelection = readMealPlanSelection(data);
  const storage = createStorageClient(env);
  const access = { userId: session.user.id, householdId: session.householdId };
  try {
    if (data.get("intent") === "delete-search") {
      await storage.deleteSavedRecipeSearch(access, String(data.get("searchId") ?? ""));
    } else {
      await storage.createSavedRecipeSearch({
        householdId: session.householdId,
        userId: session.user.id,
        name: data.get("name"),
        filters,
      });
    }
    return redirect(withMealPlanSelection(recipeSearchUrl(filters), planSelection));
  } catch (error) {
    return { error: error instanceof Error ? error.message : "The saved search could not be updated" };
  }
}

function PlanSelectionFields({ selection }: { selection: MealPlanSelection | null }) {
  if (!selection) return null;
  return <><input type="hidden" name="planWeek" value={selection.week} /><input type="hidden" name="planDate" value={selection.date} /><input type="hidden" name="planSlot" value={selection.slot} /></>;
}

function SearchHiddenFields({ query, ingredient, selectedTags, tagMatch, scope, planSelection }: Pick<LoaderData, "query" | "ingredient" | "selectedTags" | "tagMatch" | "scope" | "planSelection">) {
  return <>
    <input type="hidden" name="q" value={query} />
    <input type="hidden" name="ingredient" value={ingredient} />
    {selectedTags.map((tag) => <input key={tag} type="hidden" name="tag" value={tag} />)}
    <input type="hidden" name="tagMatch" value={tagMatch} />
    <input type="hidden" name="scope" value={scope} />
    <PlanSelectionFields selection={planSelection} />
  </>;
}

function RecipeCard({ recipe, planSelection }: { recipe: RecipeSummary; planSelection: MealPlanSelection | null }) {
  return <Link to={withMealPlanSelection(`/recipes/${recipe.id}`, planSelection)} className="recipe-card">
    <div className="recipe-card-top"><h2 title={recipe.name}>{recipe.name}</h2><ChevronRight size={18} aria-hidden="true" /></div>
    <div className="recipe-card-body"><p>{recipe.description || recipe.ingredients.slice(0, 4).join(", ") || "Open for ingredients and instructions."}</p></div>
    <div className="recipe-meta">
      {recipe.servings ? <span><Users size={15} /> {recipe.servings} servings</span> : <span>Servings unknown</span>}
      <div className="tag-row">{recipe.tags.slice(0, 2).map((tag) => <Badge key={tag}>{tag}</Badge>)}</div>
    </div>
  </Link>;
}

function InfiniteRecipeGrid({ initialResult, query, ingredient, selectedTags, tagMatch, scope, planSelection }: {
  initialResult: RecipeSearchResult;
  query: string;
  ingredient: string;
  selectedTags: string[];
  tagMatch: RecipeTagMatch;
  scope: RecipeSearchScope;
  planSelection: MealPlanSelection | null;
}) {
  const [recipes, setRecipes] = useState(initialResult.recipes);
  const [hasMore, setHasMore] = useState(initialResult.offset + initialResult.recipes.length < initialResult.total);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const loadingRef = useRef(false);
  const requestRef = useRef<AbortController | null>(null);

  useEffect(() => () => requestRef.current?.abort(), []);

  const loadMore = useCallback(async () => {
    if (!hasMore || loadingRef.current) return;
    loadingRef.current = true;
    setLoading(true);
    const controller = new AbortController();
    requestRef.current = controller;
    try {
      const response = await fetch(recipeSearchApiUrl({ query, ingredient, tags: selectedTags, tagMatch, scope }, initialResult.limit, recipes.length), {
        headers: { accept: "application/json" },
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`Recipe page returned ${response.status}`);
      const page = await response.json() as RecipeSearchResult;
      setRecipes((current) => {
        const existing = new Set(current.map((recipe) => recipe.id));
        return [...current, ...page.recipes.filter((recipe) => !existing.has(recipe.id))];
      });
      setHasMore(page.offset + page.recipes.length < page.total);
      setError(null);
    } catch (cause) {
      if (!(cause instanceof DOMException && cause.name === "AbortError")) setError("More recipes could not be loaded");
    } finally {
      loadingRef.current = false;
      setLoading(false);
    }
  }, [hasMore, ingredient, initialResult.limit, query, recipes.length, scope, selectedTags, tagMatch]);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || !hasMore || error) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) void loadMore();
    }, { rootMargin: "360px 0px" });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [error, hasMore, loadMore]);

  return <>
    <div className="recipe-grid">{recipes.map((recipe) => <RecipeCard key={recipe.id} recipe={recipe} planSelection={planSelection} />)}</div>
    <div className="recipe-load-sentinel" ref={sentinelRef} aria-live="polite">
      {loading ? <span><LoaderCircle className="spin" size={18} /> Loading recipes</span> : error ? <><span>{error}</span><Button type="button" variant="secondary" size="sm" onClick={() => { setError(null); void loadMore(); }}>Try again</Button></> : hasMore ? <span className="sr-only">More recipes load while scrolling</span> : <span>All {initialResult.total.toLocaleString()} recipes loaded</span>}
    </div>
  </>;
}

export default function Recipes({ loaderData, actionData }: Route.ComponentProps) {
  const { result, query, ingredient, selectedTags, tagMatch, scope, facets, savedSearches, planSelection, planSlotLabel, unavailable } = loaderData;
  const selectionUrl = (path: string) => withMealPlanSelection(path, planSelection);
  const [facetQuery, setFacetQuery] = useState("");
  const [showAllFacets, setShowAllFacets] = useState(false);
  const [showSaveForm, setShowSaveForm] = useState(Boolean(actionData?.error));
  const visibleFacets = useMemo(() => {
    const normalizedQuery = facetQuery.trim().toLocaleLowerCase();
    const matching = normalizedQuery ? facets.filter((facet) => facet.name.toLocaleLowerCase().includes(normalizedQuery)) : facets;
    const selected = facets.filter((facet) => selectedTags.includes(facet.name));
    const limit = normalizedQuery || showAllFacets ? 48 : 12;
    return [...new Map([...selected, ...matching.slice(0, limit)].map((facet) => [facet.name, facet])).values()];
  }, [facetQuery, facets, selectedTags, showAllFacets]);
  const activeFilterCount = Number(Boolean(query)) + Number(Boolean(ingredient)) + selectedTags.length + Number(scope !== "all");

  return (
    <div className="page-shell recipes-page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Family recipe library</p>
          <h1>Find dinner without the debate</h1>
          <p className="page-subtitle">{planSelection ? `Choose a recipe for ${planSelection.date} ${planSlotLabel ?? planSelection.slot}.` : "Search the catalog, combine tag filters, and keep useful searches close."}</p>
        </div>
        <div className="header-actions"><Button type="button" variant="secondary" onClick={() => setShowSaveForm((value) => !value)} disabled={activeFilterCount === 0}><BookmarkPlus size={17} /> Save search</Button><Link className="button button-primary button-default" to="/recipes/new"><Plus size={17} /> Add recipe</Link></div>
      </header>

      {showSaveForm ? <Form method="post" className="save-search-form">
        <SearchHiddenFields query={query} ingredient={ingredient} selectedTags={selectedTags} tagMatch={tagMatch} scope={scope} planSelection={planSelection} />
        <Input name="name" maxLength={80} required placeholder="Name this search" aria-label="Saved search name" autoFocus />
        <Button type="submit"><BookmarkPlus size={16} /> Save</Button>
        <Button type="button" variant="ghost" size="icon" aria-label="Close save search" onClick={() => setShowSaveForm(false)}><X size={17} /></Button>
        {actionData?.error ? <p className="form-error" role="alert">{actionData.error}</p> : null}
      </Form> : null}

      {savedSearches.length ? <section className="saved-searches" aria-labelledby="saved-searches-heading">
        <div className="saved-searches-heading"><Bookmark size={16} /><h2 id="saved-searches-heading">Saved searches</h2></div>
        <div className="saved-search-list">
          {savedSearches.map((saved) => <div className="saved-search-item" key={saved.id}>
            <Link to={selectionUrl(savedRecipeSearchUrl(saved))}>{saved.name}<span>{saved.tags.length ? `${saved.tags.length} tag${saved.tags.length === 1 ? "" : "s"}` : saved.query || saved.ingredient}</span></Link>
            <Form method="post">
              <SearchHiddenFields query={query} ingredient={ingredient} selectedTags={selectedTags} tagMatch={tagMatch} scope={scope} planSelection={planSelection} />
              <input type="hidden" name="searchId" value={saved.id} />
              <Button name="intent" value="delete-search" variant="ghost" size="icon" aria-label={`Delete saved search ${saved.name}`} title="Delete saved search"><Trash2 size={15} /></Button>
            </Form>
          </div>)}
        </div>
      </section> : null}

      <nav className="recipe-scope-tabs" aria-label="Recipe library">
        {([['all', 'All recipes'], ['catalog', 'Catalog'], ['mine', 'My recipes'], ['household', 'Household']] as const).map(([value, label]) => (
          <Link key={value} className={scope === value ? "active" : ""} to={selectionUrl(recipeSearchUrl({ query, ingredient, tags: selectedTags, tagMatch, scope: value }))}>{label}</Link>
        ))}
      </nav>

      <Form key={selectionUrl(recipeSearchUrl({ query, ingredient, tags: selectedTags, tagMatch, scope }))} method="get" className="recipe-search" role="search">
        <input type="hidden" name="scope" value={scope} />
        <PlanSelectionFields selection={planSelection} />
        <div className="search-bar">
          <Search size={20} aria-hidden="true" />
          <Input className="search-query" name="q" defaultValue={query} placeholder="Try quick chickpea dinners" aria-label="Search recipes" />
          <Input className="search-ingredient" name="ingredient" defaultValue={ingredient} placeholder="Ingredient" aria-label="Filter by ingredient" />
          <Button type="submit">Search</Button>
        </div>

        <details className="facet-panel" open>
          <summary><span><SlidersHorizontal size={17} /> Tag filters {selectedTags.length ? <Badge>{selectedTags.length}</Badge> : null}</span><ChevronDown size={17} /></summary>
          <div className="facet-panel-body">
            <div className="facet-toolbar">
              <Input value={facetQuery} onChange={(event) => setFacetQuery(event.target.value)} placeholder="Find a tag" aria-label="Find a tag" />
              <fieldset className="tag-match-control">
                <legend>Match selected tags</legend>
                <label className={tagMatch === "all" ? "active" : ""}><input type="radio" name="tagMatch" value="all" defaultChecked={tagMatch === "all"} />All</label>
                <label className={tagMatch === "any" ? "active" : ""}><input type="radio" name="tagMatch" value="any" defaultChecked={tagMatch === "any"} />Any</label>
              </fieldset>
            </div>
            <div className="facet-options">
              {visibleFacets.map((facet) => <label className="facet-option" key={facet.name}>
                <input type="checkbox" name="tag" value={facet.name} defaultChecked={selectedTags.includes(facet.name)} />
                <span>{facet.name}</span><strong>{facet.recipeCount.toLocaleString()}</strong>
              </label>)}
              {!visibleFacets.length ? <p className="facet-empty">No tags match that name.</p> : null}
            </div>
            <div className="facet-actions">
              {!facetQuery && facets.length > 12 ? <Button type="button" variant="ghost" size="sm" onClick={() => setShowAllFacets((value) => !value)}>{showAllFacets ? "Show fewer" : "Show more tags"}</Button> : <span />}
              <Button type="submit" size="sm">Apply filters</Button>
            </div>
          </div>
        </details>
      </Form>

      {selectedTags.length || query || ingredient ? <div className="active-filters" aria-label="Active recipe filters">
        {selectedTags.map((selectedTag) => <Link key={selectedTag} className="filter-chip" to={selectionUrl(recipeSearchUrl({ query, ingredient, tags: selectedTags.filter((tag) => tag !== selectedTag), tagMatch, scope }))}>{selectedTag}<X size={13} aria-hidden="true" /></Link>)}
        <Link className="clear-filters" to={selectionUrl(recipeSearchUrl({ scope }))}>Clear filters</Link>
      </div> : null}

      {unavailable ? (
        <section className="setup-state" aria-live="polite">
          <AlertCircle size={22} />
          <div>
            <h2>The local catalog is not loaded yet</h2>
            <p>Start the MongoDB gateway, run <code>npm run gateway:migrate</code>, then run <code>npm run import:sample</code>.</p>
            {import.meta.env.DEV ? <details><summary>Database detail</summary><pre>{unavailable}</pre></details> : null}
          </div>
        </section>
      ) : (
        <>
          <div className="result-heading">
            <div><strong>{result.total.toLocaleString()}</strong> recipes</div>
            <span>{selectedTags.length ? `Matching ${tagMatch === "all" ? "all" : "any"} selected tags` : query ? `Results for “${query}”` : "Browse the sample catalog"}</span>
          </div>
          {result.recipes.length ? (
            <InfiniteRecipeGrid key={selectionUrl(recipeSearchUrl({ query, ingredient, tags: selectedTags, tagMatch, scope }))} initialResult={result} query={query} ingredient={ingredient} selectedTags={selectedTags} tagMatch={tagMatch} scope={scope} planSelection={planSelection} />
          ) : (
            <section className="empty-state"><Search size={24} /><h2>No matching recipes</h2><p>Try fewer tags or switch from All to Any.</p></section>
          )}
        </>
      )}
    </div>
  );
}

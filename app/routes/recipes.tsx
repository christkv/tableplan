import { AlertCircle, Bookmark, BookmarkPlus, ChevronDown, ChevronRight, Search, SlidersHorizontal, Trash2, Users, X } from "lucide-react";
import { useMemo, useState } from "react";
import { Form, Link, redirect } from "react-router";

import type { Route } from "./+types/recipes";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { cloudflareContext } from "../context";
import { requireRequestSession } from "../../src/auth/server";
import { listRecipeTagFacets, searchRecipes } from "../../src/db/recipes";
import { createSavedRecipeSearch, deleteSavedRecipeSearch, listSavedRecipeSearches, savedRecipeSearchUrl, type SavedRecipeSearch } from "../../src/db/saved-searches";
import { normalizeRecipeTags, normalizeTagMatch, recipeSearchUrl } from "../../src/domain/recipe-search";
import type { RecipeSearchResult, RecipeTagMatch, RecipeTagOption } from "../../src/domain/recipes";

interface LoaderData {
  result: RecipeSearchResult;
  query: string;
  ingredient: string;
  selectedTags: string[];
  tagMatch: RecipeTagMatch;
  facets: RecipeTagOption[];
  savedSearches: SavedRecipeSearch[];
  unavailable?: string;
}

function readFilters(url: URL) {
  return {
    query: url.searchParams.get("q") ?? "",
    ingredient: url.searchParams.get("ingredient") ?? "",
    tags: normalizeRecipeTags(url.searchParams.getAll("tag")),
    tagMatch: normalizeTagMatch(url.searchParams.get("tagMatch")),
  };
}

function formFilters(data: FormData) {
  return {
    query: String(data.get("q") ?? ""),
    ingredient: String(data.get("ingredient") ?? ""),
    tags: normalizeRecipeTags(data.getAll("tag")),
    tagMatch: normalizeTagMatch(data.get("tagMatch")),
  };
}

export async function loader({ request, context }: Route.LoaderArgs): Promise<LoaderData> {
  const url = new URL(request.url);
  const filters = readFilters(url);
  const empty: RecipeSearchResult = { recipes: [], total: 0, limit: 24, offset: 0 };
  const { env, ctx } = context.get(cloudflareContext);
  const session = await requireRequestSession(request, env, ctx);
  try {
    const [result, facets, savedSearches] = await Promise.all([
      searchRecipes(env.DB, filters),
      listRecipeTagFacets(env.DB, filters),
      listSavedRecipeSearches(env.DB, session.householdId),
    ]);
    return { result, query: filters.query, ingredient: filters.ingredient, selectedTags: filters.tags, tagMatch: filters.tagMatch, facets, savedSearches };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Database unavailable";
    return { result: empty, query: filters.query, ingredient: filters.ingredient, selectedTags: filters.tags, tagMatch: filters.tagMatch, facets: [], savedSearches: [], unavailable: message };
  }
}

export async function action({ request, context }: Route.ActionArgs) {
  const { env, ctx } = context.get(cloudflareContext);
  const session = await requireRequestSession(request, env, ctx);
  const data = await request.formData();
  const filters = formFilters(data);
  try {
    if (data.get("intent") === "delete-search") {
      await deleteSavedRecipeSearch(env.DB, session.householdId, String(data.get("searchId") ?? ""));
    } else {
      await createSavedRecipeSearch(env.DB, {
        householdId: session.householdId,
        userId: session.user.id,
        name: data.get("name"),
        filters,
      });
    }
    return redirect(recipeSearchUrl(filters));
  } catch (error) {
    return { error: error instanceof Error ? error.message : "The saved search could not be updated" };
  }
}

function SearchHiddenFields({ query, ingredient, selectedTags, tagMatch }: Pick<LoaderData, "query" | "ingredient" | "selectedTags" | "tagMatch">) {
  return <>
    <input type="hidden" name="q" value={query} />
    <input type="hidden" name="ingredient" value={ingredient} />
    {selectedTags.map((tag) => <input key={tag} type="hidden" name="tag" value={tag} />)}
    <input type="hidden" name="tagMatch" value={tagMatch} />
  </>;
}

export default function Recipes({ loaderData, actionData }: Route.ComponentProps) {
  const { result, query, ingredient, selectedTags, tagMatch, facets, savedSearches, unavailable } = loaderData;
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
  const activeFilterCount = Number(Boolean(query)) + Number(Boolean(ingredient)) + selectedTags.length;

  return (
    <div className="page-shell recipes-page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Family recipe library</p>
          <h1>Find dinner without the debate</h1>
          <p className="page-subtitle">Search the catalog, combine tag filters, and keep useful searches close.</p>
        </div>
        <Button type="button" variant="secondary" onClick={() => setShowSaveForm((value) => !value)} disabled={activeFilterCount === 0}>
          <BookmarkPlus size={17} /> Save search
        </Button>
      </header>

      {showSaveForm ? <Form method="post" className="save-search-form">
        <SearchHiddenFields query={query} ingredient={ingredient} selectedTags={selectedTags} tagMatch={tagMatch} />
        <Input name="name" maxLength={80} required placeholder="Name this search" aria-label="Saved search name" autoFocus />
        <Button type="submit"><BookmarkPlus size={16} /> Save</Button>
        <Button type="button" variant="ghost" size="icon" aria-label="Close save search" onClick={() => setShowSaveForm(false)}><X size={17} /></Button>
        {actionData?.error ? <p className="form-error" role="alert">{actionData.error}</p> : null}
      </Form> : null}

      {savedSearches.length ? <section className="saved-searches" aria-labelledby="saved-searches-heading">
        <div className="saved-searches-heading"><Bookmark size={16} /><h2 id="saved-searches-heading">Saved searches</h2></div>
        <div className="saved-search-list">
          {savedSearches.map((saved) => <div className="saved-search-item" key={saved.id}>
            <Link to={savedRecipeSearchUrl(saved)}>{saved.name}<span>{saved.tags.length ? `${saved.tags.length} tag${saved.tags.length === 1 ? "" : "s"}` : saved.query || saved.ingredient}</span></Link>
            <Form method="post">
              <SearchHiddenFields query={query} ingredient={ingredient} selectedTags={selectedTags} tagMatch={tagMatch} />
              <input type="hidden" name="searchId" value={saved.id} />
              <Button name="intent" value="delete-search" variant="ghost" size="icon" aria-label={`Delete saved search ${saved.name}`} title="Delete saved search"><Trash2 size={15} /></Button>
            </Form>
          </div>)}
        </div>
      </section> : null}

      <Form key={recipeSearchUrl({ query, ingredient, tags: selectedTags, tagMatch })} method="get" className="recipe-search" role="search">
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
        {selectedTags.map((selectedTag) => <Link key={selectedTag} className="filter-chip" to={recipeSearchUrl({ query, ingredient, tags: selectedTags.filter((tag) => tag !== selectedTag), tagMatch })}>{selectedTag}<X size={13} aria-hidden="true" /></Link>)}
        <Link className="clear-filters" to="/recipes">Clear all</Link>
      </div> : null}

      {unavailable ? (
        <section className="setup-state" aria-live="polite">
          <AlertCircle size={22} />
          <div>
            <h2>The local catalog is not loaded yet</h2>
            <p>Run <code>npm run db:migrate:local</code> followed by <code>npm run import:sample</code>.</p>
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
            <div className="recipe-grid">
              {result.recipes.map((recipe) => (
                <Link key={recipe.id} to={`/recipes/${recipe.id}`} className="recipe-card">
                  <div className="recipe-card-top">
                    <div className="recipe-initial" aria-hidden="true">{recipe.name.slice(0, 1).toUpperCase()}</div>
                    <ChevronRight size={18} aria-hidden="true" />
                  </div>
                  <div className="recipe-card-body">
                    <h2>{recipe.name}</h2>
                    <p>{recipe.description || recipe.ingredients.slice(0, 4).join(", ") || "Open for ingredients and instructions."}</p>
                  </div>
                  <div className="recipe-meta">
                    {recipe.servings ? <span><Users size={15} /> {recipe.servings} servings</span> : <span>Servings unknown</span>}
                    <div className="tag-row">{recipe.tags.slice(0, 2).map((tag) => <Badge key={tag}>{tag}</Badge>)}</div>
                  </div>
                </Link>
              ))}
            </div>
          ) : (
            <section className="empty-state"><Search size={24} /><h2>No matching recipes</h2><p>Try fewer tags or switch from All to Any.</p></section>
          )}
        </>
      )}
    </div>
  );
}

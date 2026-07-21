import type { Db, Document } from "mongodb";

import { aggregateIngredients } from "../src/domain/quantity/aggregate";
import { displayQuantity } from "../src/domain/quantity/display";
import type { MeasurementSystem } from "../src/domain/quantity/types";
import { findUnit } from "../src/domain/quantity/units";
import type { RecipeAccessContext } from "../src/domain/recipes";
import type { ShoppingListView } from "../src/domain/shopping";
import type { PublicShoppingList } from "../src/domain/shopping-share";
import type { MongoPlanStore } from "./plans";
import type { MongoRecipeStore } from "./recipes";

interface StoredItem { id: string; canonicalIngredientId?: string; name: string; quantityMin: string | null; quantityMax: string | null; baseUnitId: string | null; preparation?: string; checked: boolean; unresolved: boolean; sources: Array<{ recipeId: string; recipeName: string; rawLine: string }> }
interface ShoppingDocument extends Document { _id: string; householdId: string; planId: string; name: string; startsOn: string; endsOn: string; measurementSystem: MeasurementSystem; items: StoredItem[]; createdAt: Date; updatedAt: Date }

export interface MongoShoppingStore {
  generate(input: { householdId: string; planId: string; startsOn: string; endsOn: string; userId: string; measurementSystem: MeasurementSystem }): Promise<string>;
  refreshPlan(access: RecipeAccessContext, planId: string): Promise<string | null>;
  refreshRecipe(access: RecipeAccessContext, recipeId: string): Promise<void>;
  getLatest(access: RecipeAccessContext, displaySystem?: MeasurementSystem): Promise<ShoppingListView | null>;
  getById(access: RecipeAccessContext, listId: string, displaySystem?: MeasurementSystem): Promise<ShoppingListView | null>;
  getForPlan(access: RecipeAccessContext, planId: string, listId?: string, displaySystem?: MeasurementSystem): Promise<ShoppingListView | null>;
  toggle(access: RecipeAccessContext, itemId: string, checked: boolean): Promise<boolean>;
  getPublic(householdId: string, listId: string): Promise<PublicShoppingList | null>;
  togglePublic(householdId: string, listId: string, itemId: string, checked: boolean): Promise<boolean>;
}

export function createMongoShoppingStore(database: Db, plans: MongoPlanStore, recipes: MongoRecipeStore): MongoShoppingStore {
  const lists = database.collection<ShoppingDocument>("shopping_lists");
  const memberships = database.collection("household_memberships");
  const requireMember = async (access: RecipeAccessContext) => { if (!await memberships.findOne({ userId: access.userId, householdId: access.householdId }, { projection: { _id: 1 } })) throw new Error("household_access_denied"); };
  const itemKey = (item: Pick<StoredItem, "canonicalIngredientId" | "name" | "preparation">) => `${item.canonicalIngredientId ?? ""}:${item.name.toLowerCase()}:${item.preparation?.toLowerCase() ?? ""}`;
  const iso = (value: Date | string) => value instanceof Date ? value.toISOString() : new Date(value).toISOString();
  const aggregatePlan = async (access: RecipeAccessContext, planId: string) => {
    const plan = await plans.getById(access, planId); if (!plan) throw new Error("plan_not_found");
    const values = [];
    for (const item of plan.items) {
      const recipe = await recipes.get(item.recipeId, access); if (!recipe) continue;
      for (const ingredient of recipe.recipeIngredients) values.push({
        raw: ingredient.rawLine,
        quantity: ingredient.quantityMin === null ? undefined : { min: Number(ingredient.quantityMin), ...(ingredient.quantityMax === null ? {} : { max: Number(ingredient.quantityMax) }) },
        unit: ingredient.unitId ? findUnit(ingredient.unitId) : undefined,
        ingredient: ingredient.ingredient, preparation: ingredient.preparation ?? undefined, status: ingredient.parseStatus,
        scale: item.servings / (recipe.servings && recipe.servings > 0 ? recipe.servings : item.servings),
        source: { recipeId: recipe.id, recipeName: recipe.name, rawLine: ingredient.rawLine },
      });
    }
    return { plan, aggregates: aggregateIngredients(values) };
  };
  const storedItems = (aggregates: Awaited<ReturnType<typeof aggregatePlan>>["aggregates"], checked = new Map<string, boolean>()): StoredItem[] => aggregates.map((item) => {
    const value = { canonicalIngredientId: item.canonicalIngredientId, name: item.name, preparation: item.preparation };
    return { id: crypto.randomUUID(), ...value, quantityMin: item.quantity ? String(item.quantity.min) : null, quantityMax: item.quantity?.max === undefined ? null : String(item.quantity.max), baseUnitId: item.unit?.id ?? null, checked: checked.get(itemKey(value)) ?? false, unresolved: item.unresolved, sources: item.sources };
  });
  const view = async (document: ShoppingDocument, access: RecipeAccessContext, displaySystem?: MeasurementSystem): Promise<ShoppingListView> => {
    const plan = await plans.getById(access, document.planId); const system = displaySystem ?? document.measurementSystem;
    return { id: document._id, name: document.name, measurementSystem: system, generatedAt: iso(document.createdAt), updatedAt: iso(document.updatedAt),
      plan: plan ? { id: plan.id, name: plan.name, startsOn: plan.startsOn, endsOn: plan.endsOn, mealCount: plan.items.length } : null,
      items: document.items.map((item) => { const unit = item.baseUnitId ? findUnit(item.baseUnitId) : undefined; const displayed = item.quantityMin !== null && unit ? displayQuantity({ min: Number(item.quantityMin), ...(item.quantityMax === null ? {} : { max: Number(item.quantityMax) }) }, unit, system) : null; return { id: item.id, name: item.name, quantityMin: displayed ? String(displayed.quantity.min) : item.quantityMin, quantityMax: displayed?.quantity.max === undefined ? null : String(displayed.quantity.max), unitId: displayed?.unit.symbol ?? item.baseUnitId, checked: item.checked, unresolved: item.unresolved, sources: item.sources }; }),
    };
  };
  return {
    async generate(input) {
      const access = { userId: input.userId, householdId: input.householdId }; await requireMember(access); const { plan, aggregates } = await aggregatePlan(access, input.planId);
      if (plan.startsOn !== input.startsOn || plan.endsOn !== input.endsOn) throw new Error("plan_week_mismatch"); const id = crypto.randomUUID(); const now = new Date();
      await lists.insertOne({ _id: id, householdId: input.householdId, planId: input.planId, name: `Shopping for ${plan.name}`, startsOn: input.startsOn, endsOn: input.endsOn, measurementSystem: input.measurementSystem, items: storedItems(aggregates), createdAt: now, updatedAt: now }); return id;
    },
    async refreshPlan(access, planId) {
      await requireMember(access); const list = await lists.find({ householdId: access.householdId, planId }).sort({ createdAt: -1 }).limit(1).next(); if (!list) return null;
      const { aggregates } = await aggregatePlan(access, planId); const checks = new Map(list.items.map((item) => [itemKey(item), item.checked]));
      await lists.updateOne({ _id: list._id, householdId: access.householdId }, { $set: { items: storedItems(aggregates, checks), updatedAt: new Date() } }); return list._id;
    },
    async refreshRecipe(access, recipeId) {
      await requireMember(access); const planDocs = await database.collection("meal_plans").find({ householdId: access.householdId, "items.recipeId": recipeId }, { projection: { _id: 1 } }).toArray();
      for (const plan of planDocs) await this.refreshPlan(access, String(plan._id));
    },
    async getLatest(access, system) { await requireMember(access); const document = await lists.find({ householdId: access.householdId }).sort({ createdAt: -1 }).limit(1).next(); return document ? view(document, access, system) : null; },
    async getById(access, listId, system) { await requireMember(access); const document = await lists.findOne({ _id: listId, householdId: access.householdId }); return document ? view(document, access, system) : null; },
    async getForPlan(access, planId, listId, system) { await requireMember(access); const document = await lists.find({ householdId: access.householdId, planId, ...(listId ? { _id: listId } : {}) }).sort({ createdAt: -1 }).limit(1).next(); return document ? view(document, access, system) : null; },
    async toggle(access, itemId, checked) { await requireMember(access); const result = await lists.updateOne({ householdId: access.householdId, "items.id": itemId }, { $set: { "items.$[item].checked": checked, "items.$[item].updatedAt": new Date(), updatedAt: new Date() } }, { arrayFilters: [{ "item.id": itemId }] }); return Boolean(result.modifiedCount); },
    async getPublic(householdId, listId) {
      const document = await lists.findOne({ _id: listId, householdId }); if (!document) return null;
      const plan = await database.collection<Document & { _id: string }>("meal_plans").findOne({ _id: document.planId, householdId }, { projection: { name: 1, startsOn: 1, endsOn: 1 } });
      return { id: document._id, name: document.name, measurementSystem: document.measurementSystem, updatedAt: iso(document.updatedAt), plan: plan ? { name: String(plan.name), startsOn: String(plan.startsOn), endsOn: String(plan.endsOn) } : null, items: document.items.map((item) => ({ id: item.id, name: item.name, quantityMin: item.quantityMin, quantityMax: item.quantityMax, unitId: item.baseUnitId, checked: item.checked, unresolved: item.unresolved, sources: [] })) };
    },
    async togglePublic(householdId, listId, itemId, checked) { const result = await lists.updateOne({ _id: listId, householdId, "items.id": itemId }, { $set: { "items.$[item].checked": checked, updatedAt: new Date() } }, { arrayFilters: [{ "item.id": itemId }] }); return Boolean(result.modifiedCount); },
  };
}

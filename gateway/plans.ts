import type { ClientSession, Db, Document } from "mongodb";

import { addDays } from "../src/domain/planning/dates";
import { MealPlanCopyError, parsePlannedServings, shiftPlannedDate, type MealPlanItemContext, type MealPlanView } from "../src/domain/planning/meal-plans";
import type { RecipeAccessContext } from "../src/domain/recipes";
import type { MongoRecipeStore } from "./recipes";

interface PlanItem { id: string; recipeId: string; recipeName: string; plannedDate: string; mealSlot: string; servings: number; notes: string | null; leftovers?: boolean; createdAt: Date }
interface PlanDocument extends Document { _id: string; householdId: string; name: string; startsOn: string; endsOn: string; timezone: string; createdByUserId: string; items: PlanItem[]; createdAt: Date; updatedAt: Date }
interface PlanWriteDocument { _id: string; householdId: string; items: PlanItem[]; updatedAt: Date }
type TransactionRunner = <T>(operation: (session: ClientSession) => Promise<T>) => Promise<T>;

export interface MongoPlanStore {
  get(access: RecipeAccessContext, startsOn: string, endsOn: string): Promise<MealPlanView | null>;
  getById(access: RecipeAccessContext, planId: string): Promise<MealPlanView | null>;
  getItemContext(access: RecipeAccessContext, itemId: string, recipeId: string): Promise<MealPlanItemContext | null>;
  ensure(input: { householdId: string; startsOn: string; endsOn: string; timezone: string; userId: string }): Promise<string>;
  addItem(input: { householdId: string; userId: string; planId: string; recipeId: string; date: string; slot: string; servings: number; notes?: string }): Promise<string>;
  removeItem(access: RecipeAccessContext, itemId: string): Promise<string | null>;
  updateServings(input: { householdId: string; userId: string; itemId: string; servings: number }): Promise<string>;
  copyWeek(input: { householdId: string; userId: string; sourceStartsOn: string; targetStartsOn: string; timezone: string }): Promise<{ planId: string; itemCount: number }>;
}

export function createMongoPlanStore(database: Db, recipes: MongoRecipeStore, withTransaction: TransactionRunner): MongoPlanStore {
  const plans = database.collection<PlanDocument>("meal_plans");
  const planWrites = database.collection<PlanWriteDocument>("meal_plans");
  const memberships = database.collection("household_memberships");
  const requireMember = async (userId: string, householdId: string, session?: ClientSession) => {
    if (!await memberships.findOne({ userId, householdId }, { projection: { _id: 1 }, session })) throw new Error("household_access_denied");
  };
  const view = (plan: PlanDocument): MealPlanView => ({
    id: plan._id, name: plan.name, startsOn: plan.startsOn, endsOn: plan.endsOn,
    items: (plan.items ?? []).map((item) => ({ id: item.id, recipeId: item.recipeId, recipeName: item.recipeName || "Recipe", plannedDate: item.plannedDate, mealSlot: item.mealSlot, servings: Number(item.servings), notes: item.notes ?? null })),
  });
  const ensureInSession = async (input: Parameters<MongoPlanStore["ensure"]>[0], session?: ClientSession) => {
    await requireMember(input.userId, input.householdId, session);
    const id = crypto.randomUUID(); const now = new Date();
    await plans.updateOne({ householdId: input.householdId, startsOn: input.startsOn, endsOn: input.endsOn }, { $setOnInsert: { _id: id, householdId: input.householdId, name: `Week of ${input.startsOn}`, startsOn: input.startsOn, endsOn: input.endsOn, timezone: input.timezone, createdByUserId: input.userId, items: [], createdAt: now, updatedAt: now } }, { upsert: true, session });
    const plan = await plans.findOne({ householdId: input.householdId, startsOn: input.startsOn, endsOn: input.endsOn }, { projection: { _id: 1 }, session });
    if (!plan) throw new Error("plan_create_failed"); return plan._id;
  };

  return {
    async get(access, startsOn, endsOn) { await requireMember(access.userId, access.householdId); const plan = await plans.findOne({ householdId: access.householdId, startsOn, endsOn }); return plan ? view(plan) : null; },
    async getById(access, planId) { await requireMember(access.userId, access.householdId); const plan = await plans.findOne({ _id: planId, householdId: access.householdId }); return plan ? view(plan) : null; },
    async getItemContext(access, itemId, recipeId) {
      await requireMember(access.userId, access.householdId); if (!itemId || itemId.length > 128) return null;
      const plan = await plans.findOne({ householdId: access.householdId, items: { $elemMatch: { id: itemId, recipeId } } });
      const item = plan?.items.find((value) => value.id === itemId && value.recipeId === recipeId); if (!plan || !item) return null;
      return { itemId, planId: plan._id, planName: plan.name, startsOn: plan.startsOn, endsOn: plan.endsOn, recipeId, plannedDate: item.plannedDate, mealSlot: item.mealSlot, servings: parsePlannedServings(item.servings) };
    },
    ensure: ensureInSession,
    async addItem(input) {
      await requireMember(input.userId, input.householdId); const recipe = await recipes.get(input.recipeId, { userId: input.userId, householdId: input.householdId });
      if (!recipe || recipe.visibility === "user_private") throw new Error("recipe_not_shared_with_household");
      const id = crypto.randomUUID();
      const updated = await planWrites.updateOne({ _id: input.planId, householdId: input.householdId }, { $push: { items: { id, recipeId: input.recipeId, recipeName: recipe.name, plannedDate: input.date, mealSlot: input.slot, servings: parsePlannedServings(input.servings), notes: input.notes ?? null, createdAt: new Date() } }, $set: { updatedAt: new Date() } });
      if (!updated.modifiedCount) throw new Error("plan_not_found"); return id;
    },
    async removeItem(access, itemId) {
      await requireMember(access.userId, access.householdId); const plan = await plans.findOne({ householdId: access.householdId, "items.id": itemId }, { projection: { _id: 1 } }); if (!plan) return null;
      await planWrites.updateOne({ _id: plan._id, householdId: access.householdId }, { $pull: { items: { id: itemId } }, $set: { updatedAt: new Date() } }); return plan._id;
    },
    async updateServings(input) {
      await requireMember(input.userId, input.householdId); const servings = parsePlannedServings(input.servings);
      const result = await plans.findOneAndUpdate({ householdId: input.householdId, "items.id": input.itemId }, { $set: { "items.$[item].servings": servings, "items.$[item].updatedAt": new Date(), updatedAt: new Date() } }, { arrayFilters: [{ "item.id": input.itemId }], returnDocument: "after", projection: { _id: 1 } });
      if (!result) throw new Error("plan_item_not_found"); return result._id;
    },
    async copyWeek(input) {
      return withTransaction(async (session) => {
        await requireMember(input.userId, input.householdId, session); const sourceEndsOn = addDays(input.sourceStartsOn, 6); const targetEndsOn = addDays(input.targetStartsOn, 6);
        const source = await plans.findOne({ householdId: input.householdId, startsOn: input.sourceStartsOn, endsOn: sourceEndsOn }, { session });
        if (!source?.items.length) throw new MealPlanCopyError("source_empty", "The previous week has no meals to copy");
        const targetId = await ensureInSession({ householdId: input.householdId, userId: input.userId, startsOn: input.targetStartsOn, endsOn: targetEndsOn, timezone: input.timezone }, session);
        const target = await plans.findOne({ _id: targetId }, { session }); if (target?.items.length) throw new MealPlanCopyError("target_not_empty", "The target week already contains meals");
        const copied = source.items.map((item) => ({ ...item, id: crypto.randomUUID(), plannedDate: shiftPlannedDate(item.plannedDate, input.sourceStartsOn, input.targetStartsOn), createdAt: new Date() }));
        await plans.updateOne({ _id: targetId, items: { $size: 0 } }, { $set: { items: copied, updatedAt: new Date() } }, { session });
        return { planId: targetId, itemCount: copied.length };
      });
    },
  };
}

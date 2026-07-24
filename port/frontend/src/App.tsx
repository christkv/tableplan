import { lazy, Suspense } from "react";
import { Navigate, Route, Routes } from "react-router";
import { BrandMark, PRODUCT_NAME } from "./components/Brand";
import { ProtectedLayout } from "./components/Layout";

const SignInPage = lazy(() => import("./pages/AuthPages").then((module) => ({ default: module.SignInPage })));
const AuthErrorPage = lazy(() => import("./pages/AuthPages").then((module) => ({ default: module.AuthErrorPage })));
const VerifyEmailPage = lazy(() => import("./pages/AuthPages").then((module) => ({ default: module.VerifyEmailPage })));
const ForgotPasswordPage = lazy(() => import("./pages/AuthPages").then((module) => ({ default: module.ForgotPasswordPage })));
const ResetPasswordPage = lazy(() => import("./pages/AuthPages").then((module) => ({ default: module.ResetPasswordPage })));
const HouseholdJoinPage = lazy(() => import("./pages/AuthPages").then((module) => ({ default: module.HouseholdJoinPage })));
const FavoritesPage = lazy(() => import("./pages/FavoritesPage").then((module) => ({ default: module.FavoritesPage })));
const PlanPage = lazy(() => import("./pages/PlanPage").then((module) => ({ default: module.PlanPage })));
const RecipesPage = lazy(() => import("./pages/RecipePages").then((module) => ({ default: module.RecipesPage })));
const RecipeCreatePage = lazy(() => import("./pages/RecipePages").then((module) => ({ default: module.RecipeCreatePage })));
const RecipeReviewPage = lazy(() => import("./pages/RecipePages").then((module) => ({ default: module.RecipeReviewPage })));
const RecipeEditPage = lazy(() => import("./pages/RecipePages").then((module) => ({ default: module.RecipeEditPage })));
const RecipeDetailPage = lazy(() => import("./pages/RecipePages").then((module) => ({ default: module.RecipeDetailPage })));
const SettingsPage = lazy(() => import("./pages/SettingsPage").then((module) => ({ default: module.SettingsPage })));
const ShoppingPage = lazy(() => import("./pages/ShoppingPages").then((module) => ({ default: module.ShoppingPage })));
const SharedExchangePage = lazy(() => import("./pages/ShoppingPages").then((module) => ({ default: module.SharedExchangePage })));
const SharedShoppingPage = lazy(() => import("./pages/ShoppingPages").then((module) => ({ default: module.SharedShoppingPage })));

export const FRONTEND_PAGE_ROUTES = [
  "/",
  "/sign-in",
  "/verify-email",
  "/forgot-password",
  "/reset-password",
  "/auth/error",
  "/household/join",
  "/shared/shopping",
  "/shared/shopping/:shareId",
  "/recipes",
  "/recipes/new",
  "/recipes/import/:ingestionId",
  "/recipes/:recipeId/edit",
  "/recipes/:recipeId",
  "/favorites",
  "/plan",
  "/shopping",
  "/settings",
] as const;

export function App() {
  return (
    <Suspense fallback={<main className="shared-loading"><div><BrandMark /><p>Loading {PRODUCT_NAME}…</p></div></main>}><Routes>
      <Route path="/" element={<Navigate replace to="/recipes" />} />
      <Route path="/sign-in" element={<SignInPage />} />
      <Route path="/login" element={<SignInPage />} />
      <Route path="/register" element={<SignInPage initialMode="sign-up" />} />
      <Route path="/verify-email" element={<VerifyEmailPage />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      <Route path="/auth/error" element={<AuthErrorPage />} />
      <Route path="/household/join" element={<HouseholdJoinPage />} />
      <Route path="/shared/shopping" element={<SharedExchangePage />} />
      <Route path="/shared/shopping/:shareId" element={<SharedShoppingPage />} />
      <Route element={<ProtectedLayout />}>
        <Route path="/recipes" element={<RecipesPage />} />
        <Route path="/recipes/new" element={<RecipeCreatePage />} />
        <Route path="/recipes/import/:ingestionId" element={<RecipeReviewPage />} />
        <Route path="/recipes/:recipeId/edit" element={<RecipeEditPage />} />
        <Route path="/recipes/:recipeId" element={<RecipeDetailPage />} />
        <Route path="/favorites" element={<FavoritesPage />} />
        <Route path="/plan" element={<PlanPage />} />
        <Route path="/shopping" element={<ShoppingPage />} />
        <Route path="/settings" element={<SettingsPage />} />
      </Route>
      <Route path="*" element={<main className="error-page"><div><BrandMark /><p className="eyebrow">{PRODUCT_NAME}</p><h1>That page is off the menu.</h1><p>The page you were looking for could not be found.</p><a href="/recipes">Return to recipes</a></div></main>} />
    </Routes></Suspense>
  );
}

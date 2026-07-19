import type { RecipeIngestionAgent } from "../../workers/recipe-ingestion";
import { assertRecipeExtractionAvailable } from "./config";
import { extractRecipeFromText } from "./extract";
import { attachSourceArtifact, createRecipeIngestion, saveIngestionDraft, updateIngestionStatus } from "./service";
import type { RecipeInputKind } from "./types";
import { createLogger } from "../observability/logger";

export async function sha256Hex(body: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", body);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function startTextRecipeIngestion(env: CloudflareEnvironment, input: { userId: string; householdId: string; text: string; origin?: "manual" | "paste"; filename?: string }) {
  const log = createLogger(env, "recipe-ingestion-request");
  assertRecipeExtractionAvailable(env, "text");
  const body = new TextEncoder().encode(input.text).buffer;
  const inputKind: RecipeInputKind = "text";
  const ingestionId = await createRecipeIngestion(env.DB, { userId: input.userId, householdId: input.householdId, inputKind, origin: input.origin ?? "paste", filename: input.filename, mediaType: "text/plain" });
  log.info("ingestion.created", {
    ingestionId,
    inputKind,
    origin: input.origin ?? "paste",
    provider: env.RECIPE_EXTRACTION_PROVIDER,
    byteSize: body.byteLength,
  });
  const key = `households/${input.householdId}/users/${input.userId}/recipe-ingestions/${ingestionId}/source`;
  await env.PRIVATE_RECIPE_ASSETS.put(key, body, { httpMetadata: { contentType: "text/plain" }, customMetadata: { ingestionId } });
  await attachSourceArtifact(env.DB, { ingestionId, key, filename: input.filename, mediaType: "text/plain", byteSize: body.byteLength, sha256: await sha256Hex(body) });
  log.debug("source.stored", { ingestionId, mediaType: "text/plain", byteSize: body.byteLength });
  if (env.RECIPE_EXTRACTION_PROVIDER === "local") {
    log.debug("local.extraction.started", { ingestionId });
    await updateIngestionStatus(env.DB, ingestionId, "extracting", "Parsing recipe text");
    const draft = extractRecipeFromText(input.text, input.filename);
    await saveIngestionDraft(env.DB, ingestionId, input.householdId, draft);
    log.info("local.extraction.complete", { ingestionId, ingredientCount: draft.ingredients.length, stepCount: draft.steps.length });
  } else {
    const { getAgentByName } = await import("agents");
    log.debug("agent.dispatch.started", { ingestionId });
    const agent = await getAgentByName<CloudflareEnvironment, RecipeIngestionAgent>(env.RECIPE_INGESTION_AGENT, ingestionId);
    const workflowId = await agent.start(ingestionId);
    log.info("agent.dispatched", { ingestionId, workflowId });
  }
  return ingestionId;
}

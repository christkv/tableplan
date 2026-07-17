import type { RecipeIngestionAgent } from "../../workers/recipe-ingestion";
import { extractRecipeFromText } from "./extract";
import { attachSourceArtifact, createRecipeIngestion, saveIngestionDraft, updateIngestionStatus } from "./service";
import type { RecipeInputKind } from "./types";

export async function sha256Hex(body: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", body);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function startTextRecipeIngestion(env: CloudflareEnvironment, input: { userId: string; householdId: string; text: string; origin?: "manual" | "paste"; filename?: string }) {
  const body = new TextEncoder().encode(input.text).buffer;
  const inputKind: RecipeInputKind = "text";
  const ingestionId = await createRecipeIngestion(env.DB, { userId: input.userId, householdId: input.householdId, inputKind, origin: input.origin ?? "paste", filename: input.filename, mediaType: "text/plain" });
  const key = `households/${input.householdId}/users/${input.userId}/recipe-ingestions/${ingestionId}/source`;
  await env.PRIVATE_RECIPE_ASSETS.put(key, body, { httpMetadata: { contentType: "text/plain" }, customMetadata: { ingestionId } });
  await attachSourceArtifact(env.DB, { ingestionId, key, filename: input.filename, mediaType: "text/plain", byteSize: body.byteLength, sha256: await sha256Hex(body) });
  if (env.RECIPE_EXTRACTION_MODE === "local") {
    await updateIngestionStatus(env.DB, ingestionId, "extracting", "Parsing recipe text");
    await saveIngestionDraft(env.DB, ingestionId, input.householdId, extractRecipeFromText(input.text, input.filename));
  } else {
    const { getAgentByName } = await import("agents");
    const agent = await getAgentByName<CloudflareEnvironment, RecipeIngestionAgent>(env.RECIPE_INGESTION_AGENT, ingestionId);
    await agent.start(ingestionId);
  }
  return ingestionId;
}

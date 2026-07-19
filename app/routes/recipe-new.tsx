import { FileImage, FileText, Sparkles, Upload } from "lucide-react";
import { useState } from "react";
import { Form, redirect, useNavigation } from "react-router";

import type { Route } from "./+types/recipe-new";
import { Button } from "~/components/ui/button";
import { cloudflareContext } from "../context";
import { requireRequestSession } from "../../src/auth/server";
import { extractRecipeFromText } from "../../src/ingestion/extract";
import { attachSourceArtifact, createRecipeIngestion, saveIngestionDraft, updateIngestionStatus } from "../../src/ingestion/service";
import type { RecipeInputKind } from "../../src/ingestion/types";
import type { RecipeIngestionAgent } from "../../workers/recipe-ingestion";

const TEXT_LIMIT = 100 * 1024;
const IMAGE_LIMIT = 12 * 1024 * 1024;
const DOCUMENT_LIMIT = 20 * 1024 * 1024;
const ALLOWED_TYPES = new Set(["text/plain", "text/markdown", "application/pdf", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "application/vnd.oasis.opendocument.text", "image/jpeg", "image/png", "image/webp"]);

export async function loader({ request, context }: Route.LoaderArgs) {
  const { env, ctx } = context.get(cloudflareContext);
  await requireRequestSession(request, env, ctx);
  return null;
}

function hex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function action({ request, context }: Route.ActionArgs) {
  const { env, ctx } = context.get(cloudflareContext);
  const session = await requireRequestSession(request, env, ctx);
  const data = await request.formData();
  const mode = data.get("mode") === "upload" ? "upload" : "paste";
  const submittedFile = data.get("file");
  const file = submittedFile instanceof File && submittedFile.size ? submittedFile : null;
  const text = String(data.get("recipeText") ?? "").trim();
  if (mode === "paste" && !text) return { error: "Paste the recipe text before continuing." };
  if (mode === "upload" && !file) return { error: "Choose a recipe file or image before continuing." };

  const body = file ? await file.arrayBuffer() : new TextEncoder().encode(text).buffer;
  const mediaType = file?.type || "text/plain";
  if (!ALLOWED_TYPES.has(mediaType)) return { error: "That file type is not supported. Use TXT, Markdown, PDF, DOCX, ODT, JPEG, PNG, or WebP." };
  const inputKind: RecipeInputKind = mediaType.startsWith("image/") ? "image" : mediaType.startsWith("text/") ? "text" : "document";
  const limit = inputKind === "text" ? TEXT_LIMIT : inputKind === "image" ? IMAGE_LIMIT : DOCUMENT_LIMIT;
  if (body.byteLength > limit) return { error: `The file is too large. The limit for this source is ${Math.round(limit / 1024 / 1024) || 0.1} MB.` };

  const ingestionId = await createRecipeIngestion(env.DB, {
    userId: session.user.id, householdId: session.householdId, inputKind, origin: mode, filename: file?.name, mediaType,
  });
  const key = `households/${session.householdId}/users/${session.user.id}/recipe-ingestions/${ingestionId}/source`;
  await env.PRIVATE_RECIPE_ASSETS.put(key, body, { httpMetadata: { contentType: mediaType }, customMetadata: { ingestionId } });
  await attachSourceArtifact(env.DB, { ingestionId, key, filename: file?.name, mediaType, byteSize: body.byteLength, sha256: hex(await crypto.subtle.digest("SHA-256", body)) });

  if (env.RECIPE_EXTRACTION_MODE === "local" && inputKind === "text") {
    await updateIngestionStatus(env.DB, ingestionId, "extracting", "Parsing recipe text");
    await saveIngestionDraft(env.DB, ingestionId, session.householdId, extractRecipeFromText(new TextDecoder().decode(body), file?.name));
  } else if (env.RECIPE_EXTRACTION_MODE === "local") {
    await updateIngestionStatus(env.DB, ingestionId, "failed", "Cloud extraction is required for this file", {
      code: "cloud_ai_required", message: "Image and document extraction requires cloud conversion. Set RECIPE_EXTRACTION_MODE=openrouter, configure OpenRouter, or test this source in preview.",
    });
  } else {
    const { getAgentByName } = await import("agents");
    const agent = await getAgentByName<CloudflareEnvironment, RecipeIngestionAgent>(env.RECIPE_INGESTION_AGENT, ingestionId);
    await agent.start(ingestionId);
  }
  return redirect(`/recipes/import/${ingestionId}`);
}

export default function RecipeNew({ actionData }: Route.ComponentProps) {
  const [mode, setMode] = useState<"paste" | "upload">("paste");
  const navigation = useNavigation();
  const busy = navigation.state === "submitting";
  return (
    <div className="page-shell recipe-create-page">
      <header className="page-header"><div><p className="eyebrow">Private recipe</p><h1>Add a recipe</h1><p className="page-subtitle">Import the source, review every field, then publish it to your library.</p></div></header>
      <div className="source-mode-tabs" role="tablist" aria-label="Recipe source">
        <button type="button" role="tab" aria-selected={mode === "paste"} className={mode === "paste" ? "active" : ""} onClick={() => setMode("paste")}><FileText size={17} /> Paste text</button>
        <button type="button" role="tab" aria-selected={mode === "upload"} className={mode === "upload" ? "active" : ""} onClick={() => setMode("upload")}><Upload size={17} /> Upload file or image</button>
      </div>
      <Form method="post" encType="multipart/form-data" className="recipe-source-form">
        <input type="hidden" name="mode" value={mode} />
        {mode === "paste" ? <label className="field-label">Recipe text<textarea name="recipeText" rows={18} maxLength={TEXT_LIMIT} required placeholder={'Weeknight lentil soup\nServes 4\n\nIngredients\n1 cup lentils\n...\n\nInstructions\n1. Rinse the lentils\n...'} /></label> :
          <label className="file-drop"><FileImage size={30} /><strong>Choose a recipe source</strong><span>TXT, Markdown, PDF, DOCX, ODT, JPEG, PNG, or WebP</span><input name="file" type="file" required accept=".txt,.md,.pdf,.docx,.odt,.jpg,.jpeg,.png,.webp,text/plain,text/markdown,application/pdf,image/jpeg,image/png,image/webp" /></label>}
        {actionData?.error ? <p className="form-error" role="alert">{actionData.error}</p> : null}
        <div className="form-command-row"><Button type="submit" disabled={busy}><Sparkles size={17} /> {busy ? "Preparing recipe..." : "Extract recipe"}</Button></div>
      </Form>
    </div>
  );
}

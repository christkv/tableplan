import { FileCheck2, FileImage, FileText, Sparkles, Upload, X } from "lucide-react";
import { type ChangeEvent, type DragEvent, type FormEvent, useRef, useState } from "react";
import { Form, redirect, useNavigation } from "react-router";

import type { Route } from "./+types/recipe-new";
import { Button } from "~/components/ui/button";
import { cloudflareContext } from "../context";
import { requireRequestSession } from "../../src/auth/server";
import { recipeExtractionAvailability } from "../../src/ingestion/config";
import { extractRecipeFromText } from "../../src/ingestion/extract";
import { createStorageClient } from "../../src/storage";
import type { RecipeInputKind } from "../../src/ingestion/types";
import { RECIPE_UPLOAD_ACCEPT, recipeInputKindForMediaType, resolveRecipeUploadMediaType } from "../../src/ingestion/upload";
import { createLogger } from "../../src/observability/logger";
import type { RecipeIngestionAgent } from "../../workers/recipe-ingestion";

const TEXT_LIMIT = 100 * 1024;
const IMAGE_LIMIT = 12 * 1024 * 1024;
const DOCUMENT_LIMIT = 20 * 1024 * 1024;

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
  const log = createLogger(env, "recipe-ingestion-request");
  const session = await requireRequestSession(request, env, ctx);
  const storage = createStorageClient(env);
  const data = await request.formData();
  const mode = data.get("mode") === "upload" ? "upload" : "paste";
  const submittedFile = data.get("file");
  const file = submittedFile instanceof File && submittedFile.size ? submittedFile : null;
  const text = String(data.get("recipeText") ?? "").trim();
  if (mode === "paste" && !text) return { error: "Paste the recipe text before continuing." };
  if (mode === "upload" && !file) return { error: "Choose a recipe file or image before continuing." };

  const body = file ? await file.arrayBuffer() : new TextEncoder().encode(text).buffer;
  const mediaType = file ? resolveRecipeUploadMediaType(file) : "text/plain";
  if (!mediaType) return { error: "That file type is not supported. Use TXT, Markdown, PDF, DOCX, ODT, JPEG, PNG, or WebP." };
  const inputKind: RecipeInputKind = recipeInputKindForMediaType(mediaType);
  const limit = inputKind === "text" ? TEXT_LIMIT : inputKind === "image" ? IMAGE_LIMIT : DOCUMENT_LIMIT;
  if (body.byteLength > limit) return { error: `The file is too large. The limit for this source is ${Math.round(limit / 1024 / 1024) || 0.1} MB.` };
  const availability = recipeExtractionAvailability(env, inputKind);
  if (!availability.available) return { error: availability.message };

  const ingestionId = await storage.createRecipeIngestion({
    userId: session.user.id, householdId: session.householdId, inputKind, origin: mode, filename: file?.name, mediaType,
  });
  log.info("ingestion.created", {
    ingestionId,
    inputKind,
    origin: mode,
    provider: env.RECIPE_EXTRACTION_PROVIDER,
    mediaType,
    byteSize: body.byteLength,
  });
  const key = `households/${session.householdId}/users/${session.user.id}/recipe-ingestions/${ingestionId}/source`;
  await env.PRIVATE_RECIPE_ASSETS.put(key, body, { httpMetadata: { contentType: mediaType }, customMetadata: { ingestionId } });
  await storage.attachRecipeSourceArtifact({ ingestionId, key, filename: file?.name, mediaType, byteSize: body.byteLength, sha256: hex(await crypto.subtle.digest("SHA-256", body)) });
  log.debug("source.stored", { ingestionId, mediaType, byteSize: body.byteLength });

  if (env.RECIPE_EXTRACTION_PROVIDER === "local") {
    log.debug("local.extraction.started", { ingestionId });
    await storage.updateRecipeIngestionStatus(ingestionId, "extracting", "Parsing recipe text");
    const draft = extractRecipeFromText(new TextDecoder().decode(body), file?.name);
    await storage.saveRecipeIngestionDraft(ingestionId, session.householdId, draft);
    log.info("local.extraction.complete", { ingestionId, ingredientCount: draft.ingredients.length, stepCount: draft.steps.length });
  } else {
    const { getAgentByName } = await import("agents");
    log.debug("agent.dispatch.started", { ingestionId });
    const agent = await getAgentByName<CloudflareEnvironment, RecipeIngestionAgent>(env.RECIPE_INGESTION_AGENT, ingestionId);
    const workflowId = await agent.start(ingestionId);
    log.info("agent.dispatched", { ingestionId, workflowId });
  }
  return redirect(`/recipes/import/${ingestionId}`);
}

export default function RecipeNew({ actionData }: Route.ComponentProps) {
  const [mode, setMode] = useState<"paste" | "upload">("paste");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const navigation = useNavigation();
  const busy = navigation.state === "submitting";

  function chooseMode(nextMode: "paste" | "upload") {
    if (nextMode === mode) return;
    setMode(nextMode);
    setSelectedFile(null);
    setUploadError(null);
    if (fileInput.current) fileInput.current.value = "";
  }

  function acceptFile(file: File, syncInput: boolean): boolean {
    if (!resolveRecipeUploadMediaType(file)) {
      setUploadError("That file type is not supported. Choose TXT, Markdown, PDF, DOCX, ODT, JPEG, PNG, or WebP.");
      return false;
    }
    if (syncInput && fileInput.current) {
      const transfer = new DataTransfer();
      transfer.items.add(file);
      fileInput.current.files = transfer.files;
    }
    setSelectedFile(file);
    setUploadError(null);
    return true;
  }

  function onFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (file && !acceptFile(file, false)) event.target.value = "";
  }

  function onFileDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragActive(false);
    if (event.dataTransfer.files.length !== 1) {
      setUploadError("Drop one recipe file at a time.");
      return;
    }
    acceptFile(event.dataTransfer.files[0], true);
  }

  function clearFile() {
    if (fileInput.current) fileInput.current.value = "";
    setSelectedFile(null);
    setUploadError(null);
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    if (mode === "upload" && !fileInput.current?.files?.length) {
      event.preventDefault();
      setUploadError("Choose or drop a recipe file before continuing.");
    }
  }

  return (
    <div className="page-shell recipe-create-page">
      <header className="page-header"><div><p className="eyebrow">Private recipe</p><h1>Add a recipe</h1><p className="page-subtitle">Import the source, review every field, then publish it to your library.</p></div></header>
      <div className="source-mode-tabs" role="tablist" aria-label="Recipe source">
        <button type="button" role="tab" aria-selected={mode === "paste"} className={mode === "paste" ? "active" : ""} onClick={() => chooseMode("paste")}><FileText size={17} /> Paste text</button>
        <button type="button" role="tab" aria-selected={mode === "upload"} className={mode === "upload" ? "active" : ""} onClick={() => chooseMode("upload")}><Upload size={17} /> Upload file or image</button>
      </div>
      <Form method="post" encType="multipart/form-data" className="recipe-source-form" onSubmit={onSubmit}>
        <input type="hidden" name="mode" value={mode} />
        {mode === "paste" ? <label className="field-label">Recipe text<textarea name="recipeText" rows={18} maxLength={TEXT_LIMIT} required placeholder={'Weeknight lentil soup\nServes 4\n\nIngredients\n1 cup lentils\n...\n\nInstructions\n1. Rinse the lentils\n...'} /></label> :
          <div className="file-upload-field">
            <div
              className={`file-drop${dragActive ? " drag-active" : ""}`}
              onDragEnter={(event) => { event.preventDefault(); setDragActive(true); }}
              onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = "copy"; setDragActive(true); }}
              onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragActive(false); }}
              onDrop={onFileDrop}
            >
              <input ref={fileInput} id="recipe-source-file" className="file-input-overlay" name="file" type="file" accept={RECIPE_UPLOAD_ACCEPT} aria-label="Choose recipe file" aria-describedby="recipe-source-formats" onChange={onFileChange} />
              <FileImage size={30} />
              <strong>{dragActive ? "Drop recipe file" : "Choose or drop a recipe file"}</strong>
              <span id="recipe-source-formats">TXT, Markdown, PDF, DOCX, ODT, JPEG, PNG, or WebP</span>
            </div>
            {selectedFile ? <div className="selected-upload" aria-live="polite"><FileCheck2 size={20} /><span><strong>{selectedFile.name}</strong><small>{selectedFile.size < 1024 * 1024 ? `${Math.max(1, Math.round(selectedFile.size / 1024))} KB` : `${(selectedFile.size / 1024 / 1024).toFixed(1)} MB`}</small></span><Button type="button" variant="ghost" size="icon" aria-label={`Remove ${selectedFile.name}`} title="Remove file" onClick={clearFile}><X size={17} /></Button></div> : null}
          </div>}
        {uploadError ? <p className="form-error" role="alert">{uploadError}</p> : null}
        {actionData?.error ? <p className="form-error" role="alert">{actionData.error}</p> : null}
        <p className="ai-processing-notice">When cloud AI extraction is enabled, recipe text and files are sent to OpenRouter and NVIDIA. The configured free models may log and use that content to improve their services, so do not include personal or confidential information.</p>
        <div className="form-command-row"><Button type="submit" disabled={busy}><Sparkles size={17} /> {busy ? "Preparing recipe..." : "Extract recipe"}</Button></div>
      </Form>
    </div>
  );
}

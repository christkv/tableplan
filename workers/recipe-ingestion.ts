import { Agent } from "agents";
import { AgentWorkflow, type AgentWorkflowStep } from "agents/workflows";
import type { WorkflowEvent } from "cloudflare:workers";

import { extractRecipeWithOpenRouter } from "../src/ingestion/openrouter";
import { saveIngestionDraft, updateIngestionStatus } from "../src/ingestion/service";
import type { RecipeDraft } from "../src/ingestion/types";

interface IngestionAgentState {
  ingestionId: string | null;
  workflowId: string | null;
  status: "idle" | "running" | "complete" | "error";
  message: string;
}

interface IngestionWorkflowParams { ingestionId: string }
interface IngestionProgress { step: string; status: "running" | "complete" | "error"; message: string; percent: number }
interface OpenRouterRuntimeEnvironment extends CloudflareEnvironment { OPENROUTER_API_KEY?: string }

export class RecipeIngestionAgent extends Agent<CloudflareEnvironment, IngestionAgentState> {
  initialState: IngestionAgentState = { ingestionId: null, workflowId: null, status: "idle", message: "Waiting" };

  async start(ingestionId: string): Promise<string> {
    const workflowId = await this.runWorkflow("RECIPE_INGESTION_WORKFLOW", { ingestionId });
    this.setState({ ingestionId, workflowId, status: "running", message: "Extraction started" });
    return workflowId;
  }

  override async onWorkflowProgress(_workflowName: string, workflowId: string, progress: unknown) {
    const value = progress as Partial<IngestionProgress>;
    this.setState({ ...this.state, workflowId, status: "running", message: value.message ?? "Extracting recipe" });
  }

  override async onWorkflowComplete(_workflowName: string, workflowId: string) {
    this.setState({ ...this.state, workflowId, status: "complete", message: "Ready for review" });
  }

  override async onWorkflowError(_workflowName: string, workflowId: string, error: string) {
    this.setState({ ...this.state, workflowId, status: "error", message: error });
    if (this.state.ingestionId) await updateIngestionStatus(this.env.DB, this.state.ingestionId, "failed", "Extraction failed", { code: "workflow_failed", message: error });
  }
}

async function extractWithOpenRouter(env: OpenRouterRuntimeEnvironment, ingestionId: string): Promise<{ draft: RecipeDraft; model: string }> {
  const artifact = await env.DB.prepare(`SELECT a.r2_key, a.filename, a.media_type, j.household_id FROM recipe_source_artifacts a
    JOIN recipe_ingestions j ON j.id=a.ingestion_id WHERE a.ingestion_id=?`).bind(ingestionId)
    .first<{ r2_key: string; filename: string | null; media_type: string; household_id: string }>();
  if (!artifact) throw new Error("Source artifact not found");
  const object = await env.PRIVATE_RECIPE_ASSETS.get(artifact.r2_key);
  if (!object) throw new Error("Source artifact is unavailable");
  const bytes = await object.arrayBuffer();
  const commonConfig = {
    apiKey: env.OPENROUTER_API_KEY ?? "",
    baseUrl: env.OPENROUTER_BASE_URL,
    appUrl: env.PUBLIC_APP_URL,
    appTitle: env.OPENROUTER_APP_TITLE,
  };
  const extraction = artifact.media_type.startsWith("image/")
    ? await extractRecipeWithOpenRouter({
      ...commonConfig,
      model: env.RECIPE_VISION_EXTRACTION_MODEL,
      fallbackModels: env.RECIPE_VISION_EXTRACTION_FALLBACK_MODELS,
    }, { kind: "image", bytes, mediaType: artifact.media_type })
    : await extractRecipeWithOpenRouter({
      ...commonConfig,
      model: env.RECIPE_TEXT_EXTRACTION_MODEL,
      fallbackModels: env.RECIPE_TEXT_EXTRACTION_FALLBACK_MODELS,
    }, { kind: "text", source: await sourceText(env, artifact, bytes) });
  return { draft: extraction.draft, model: extraction.resolvedModel };
}

async function sourceText(
  env: CloudflareEnvironment,
  artifact: { filename: string | null; media_type: string },
  bytes: ArrayBuffer,
): Promise<string> {
  const blob = new Blob([bytes], { type: artifact.media_type });
  if (artifact.media_type.startsWith("text/")) return blob.text();
  const converted = await env.AI.toMarkdown({ name: artifact.filename ?? "recipe", blob });
  if (converted.format === "error") throw new Error(converted.error);
  return converted.data;
}

export class RecipeIngestionWorkflow extends AgentWorkflow<RecipeIngestionAgent, IngestionWorkflowParams, IngestionProgress, CloudflareEnvironment> {
  override async run(event: WorkflowEvent<IngestionWorkflowParams>, step: AgentWorkflowStep) {
    const { ingestionId } = event.payload;
    await this.reportProgress({ step: "extract", status: "running", message: "Reading recipe source", percent: 0.1 });
    await step.do("mark extraction running", async () => updateIngestionStatus(this.env.DB, ingestionId, "extracting", "Reading recipe source"));
    const extraction = await step.do("extract recipe with OpenRouter", async () => extractWithOpenRouter(this.env, ingestionId));
    await this.reportProgress({ step: "map", status: "running", message: "Matching ingredients", percent: 0.75 });
    await step.do("save draft and ingredient mappings", async () => {
      const job = await this.env.DB.prepare("SELECT household_id FROM recipe_ingestions WHERE id=?").bind(ingestionId).first<{ household_id: string }>();
      if (!job) throw new Error("Ingestion job not found");
      await saveIngestionDraft(this.env.DB, ingestionId, job.household_id, extraction.draft, "openrouter", extraction.model);
    });
    await this.reportProgress({ step: "review", status: "complete", message: "Ready for review", percent: 1 });
    await step.reportComplete({ ingestionId });
    return { ingestionId };
  }
}

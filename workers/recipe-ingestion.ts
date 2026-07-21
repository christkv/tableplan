import { Agent } from "agents";
import { AgentWorkflow, type AgentWorkflowStep } from "agents/workflows";
import type { WorkflowEvent } from "cloudflare:workers";

import { extractRecipeWithOpenRouter } from "../src/ingestion/openrouter";
import { createStorageClient } from "../src/storage";
import type { RecipeDraft } from "../src/ingestion/types";
import { createLogger, errorLogContext, type Logger } from "../src/observability/logger";

interface IngestionAgentState {
  ingestionId: string | null;
  workflowId: string | null;
  status: "idle" | "running" | "complete" | "error";
  message: string;
}

interface IngestionWorkflowParams { ingestionId: string }
interface IngestionProgress { step: string; status: "running" | "complete" | "error"; message: string; percent: number }
interface OpenRouterSecrets { OPENROUTER_API_KEY?: string }

export class RecipeIngestionAgent extends Agent<CloudflareEnvironment, IngestionAgentState> {
  initialState: IngestionAgentState = { ingestionId: null, workflowId: null, status: "idle", message: "Waiting" };

  async start(ingestionId: string): Promise<string> {
    const log = createLogger(this.env, "recipe-ingestion-agent");
    log.debug("workflow.starting", { ingestionId });
    try {
      const workflowId = await this.runWorkflow("RECIPE_INGESTION_WORKFLOW", { ingestionId });
      this.setState({ ingestionId, workflowId, status: "running", message: "Extraction started" });
      log.info("workflow.started", { ingestionId, workflowId });
      return workflowId;
    } catch (error) {
      log.error("workflow.start.failed", { ingestionId, ...errorLogContext(error) });
      throw error;
    }
  }

  override async onWorkflowProgress(workflowName: string, workflowId: string, progress: unknown) {
    const value = progress as Partial<IngestionProgress>;
    this.setState({ ...this.state, workflowId, status: "running", message: value.message ?? "Extracting recipe" });
    createLogger(this.env, "recipe-ingestion-agent").debug("workflow.progress", {
      ingestionId: this.state.ingestionId,
      workflowName,
      workflowId,
      step: value.step,
      status: value.status,
      percent: value.percent,
      message: value.message,
    });
  }

  override async onWorkflowComplete(workflowName: string, workflowId: string) {
    this.setState({ ...this.state, workflowId, status: "complete", message: "Ready for review" });
    createLogger(this.env, "recipe-ingestion-agent").info("workflow.complete", {
      ingestionId: this.state.ingestionId,
      workflowName,
      workflowId,
    });
  }

  override async onWorkflowError(workflowName: string, workflowId: string, error: string) {
    this.setState({ ...this.state, workflowId, status: "error", message: error });
    createLogger(this.env, "recipe-ingestion-agent").error("workflow.error", {
      ingestionId: this.state.ingestionId,
      workflowName,
      workflowId,
      ...errorLogContext(error),
    });
    if (this.state.ingestionId) await createStorageClient(this.env).updateRecipeIngestionStatus(this.state.ingestionId, "failed", "Extraction failed", { code: "workflow_failed", message: error });
  }
}

async function extractWithOpenRouter(env: CloudflareEnvironment, ingestionId: string, log: Logger): Promise<{ draft: RecipeDraft; model: string }> {
  log.debug("source.lookup.started", { ingestionId });
  const artifact = await createStorageClient(env).getRecipeSourceArtifact(ingestionId);
  if (!artifact) throw new Error("Source artifact not found");
  const object = await env.PRIVATE_RECIPE_ASSETS.get(artifact.key);
  if (!object) throw new Error("Source artifact is unavailable");
  const bytes = await object.arrayBuffer();
  const operation = artifact.mediaType.startsWith("image/") ? "vision" : "text";
  log.debug("source.loaded", { ingestionId, mediaType: artifact.mediaType, byteSize: bytes.byteLength, operation });
  const secrets = env as unknown as OpenRouterSecrets;
  const commonConfig = {
    apiKey: secrets.OPENROUTER_API_KEY ?? "",
    baseUrl: env.OPENROUTER_BASE_URL,
    appUrl: env.PUBLIC_APP_URL,
    appTitle: env.OPENROUTER_APP_TITLE,
  };
  const model = operation === "vision" ? env.OPENROUTER_VISION_MODEL : env.OPENROUTER_TEXT_MODEL;
  const fallbackModels = operation === "vision" ? env.OPENROUTER_VISION_FALLBACK_MODELS : env.OPENROUTER_TEXT_FALLBACK_MODELS;
  const input = operation === "vision"
    ? { kind: "image" as const, bytes, mediaType: artifact.mediaType }
    : { kind: "text" as const, source: await sourceText(env, artifact, bytes, log, ingestionId) };
  log.info("model.extraction.started", {
    ingestionId,
    operation,
    requestedModel: model,
    fallbackModelCount: fallbackModels.split(",").filter((value) => value.trim()).length,
  });
  let extraction: Awaited<ReturnType<typeof extractRecipeWithOpenRouter>>;
  try {
    extraction = await extractRecipeWithOpenRouter({ ...commonConfig, model, fallbackModels }, input);
  } catch (error) {
    log.error("model.extraction.failed", { ingestionId, operation, requestedModel: model, ...errorLogContext(error) });
    throw error;
  }
  log.info("model.extraction.complete", {
    ingestionId,
    operation,
    requestedModel: extraction.requestedModel,
    resolvedModel: extraction.resolvedModel,
    ingredientCount: extraction.draft.ingredients.length,
    stepCount: extraction.draft.steps.length,
    warningCount: extraction.draft.warnings.length,
  });
  return { draft: extraction.draft, model: extraction.resolvedModel };
}

async function sourceText(
  env: CloudflareEnvironment,
  artifact: { filename: string | null; mediaType: string },
  bytes: ArrayBuffer,
  log: Logger,
  ingestionId: string,
): Promise<string> {
  const blob = new Blob([bytes], { type: artifact.mediaType });
  if (artifact.mediaType.startsWith("text/")) {
    const text = await blob.text();
    log.debug("source.text.ready", { ingestionId, characterCount: text.length });
    return text;
  }
  log.info("source.document.conversion.started", { ingestionId, mediaType: artifact.mediaType, byteSize: bytes.byteLength });
  const converted = await env.AI.toMarkdown({ name: artifact.filename ?? "recipe", blob });
  if (converted.format === "error") throw new Error(converted.error);
  log.info("source.document.conversion.complete", { ingestionId, characterCount: converted.data.length });
  return converted.data;
}

export class RecipeIngestionWorkflow extends AgentWorkflow<RecipeIngestionAgent, IngestionWorkflowParams, IngestionProgress, CloudflareEnvironment> {
  override async run(event: WorkflowEvent<IngestionWorkflowParams>, step: AgentWorkflowStep) {
    const { ingestionId } = event.payload;
    const log = createLogger(this.env, "recipe-ingestion-workflow");
    log.info("run.started", { ingestionId });
    try {
      await this.reportProgress({ step: "extract", status: "running", message: "Reading recipe source", percent: 0.1 });
      await step.do("mark extraction running", async () => {
        log.debug("status.extraction.started", { ingestionId });
        await createStorageClient(this.env).updateRecipeIngestionStatus(ingestionId, "extracting", "Reading recipe source");
      });
      const extraction = await step.do("extract recipe with OpenRouter", async () => extractWithOpenRouter(this.env, ingestionId, log));
      await this.reportProgress({ step: "map", status: "running", message: "Matching ingredients", percent: 0.75 });
      await step.do("save draft and ingredient mappings", async () => {
        log.debug("draft.save.started", { ingestionId });
        const job = await createStorageClient(this.env).getRecipeSourceArtifact(ingestionId);
        if (!job) throw new Error("Ingestion job not found");
        await createStorageClient(this.env).saveRecipeIngestionDraft(ingestionId, job.householdId, extraction.draft, "openrouter", extraction.model);
        log.debug("draft.save.complete", { ingestionId, model: extraction.model });
      });
      await this.reportProgress({ step: "review", status: "complete", message: "Ready for review", percent: 1 });
      await step.reportComplete({ ingestionId });
      log.info("run.complete", { ingestionId });
      return { ingestionId };
    } catch (error) {
      log.error("run.failed", { ingestionId, ...errorLogContext(error) });
      throw error;
    }
  }
}

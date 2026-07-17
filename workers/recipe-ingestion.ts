import { Agent } from "agents";
import { AgentWorkflow, type AgentWorkflowStep } from "agents/workflows";
import type { WorkflowEvent } from "cloudflare:workers";

import { normalizeRecipeDraft, recipeDraftJsonSchema } from "../src/ingestion/extract";
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

function parseAiResponse(value: unknown): RecipeDraft {
  const response = value && typeof value === "object" && "response" in value ? (value as { response: unknown }).response : value;
  const parsed = typeof response === "string" ? JSON.parse(response) as Partial<RecipeDraft> : response as Partial<RecipeDraft>;
  return normalizeRecipeDraft(parsed);
}

async function extractWithWorkersAi(env: CloudflareEnvironment, ingestionId: string): Promise<RecipeDraft> {
  const artifact = await env.DB.prepare(`SELECT a.r2_key, a.filename, a.media_type, j.household_id FROM recipe_source_artifacts a
    JOIN recipe_ingestions j ON j.id=a.ingestion_id WHERE a.ingestion_id=?`).bind(ingestionId)
    .first<{ r2_key: string; filename: string | null; media_type: string; household_id: string }>();
  if (!artifact) throw new Error("Source artifact not found");
  const object = await env.PRIVATE_RECIPE_ASSETS.get(artifact.r2_key);
  if (!object) throw new Error("Source artifact is unavailable");
  const blob = new Blob([await object.arrayBuffer()], { type: artifact.media_type });
  let source: string;
  if (artifact.media_type.startsWith("text/")) source = await blob.text();
  else {
    const converted = await env.AI.toMarkdown({ name: artifact.filename ?? "recipe", blob });
    if (converted.format === "error") throw new Error(converted.error);
    source = converted.data;
  }
  const model = env.RECIPE_EXTRACTION_MODEL;
  const output = await env.AI.run(model, {
    messages: [
      { role: "system", content: "Extract one recipe from the source. Preserve ingredient quantities and instruction order. Do not invent missing facts. Put uncertainty in warnings." },
      { role: "user", content: source.slice(0, 80_000) },
    ],
    temperature: 0,
    max_tokens: 4_096,
    response_format: { type: "json_schema", json_schema: { name: "recipe_draft", strict: true, schema: recipeDraftJsonSchema } },
  });
  return parseAiResponse(output);
}

export class RecipeIngestionWorkflow extends AgentWorkflow<RecipeIngestionAgent, IngestionWorkflowParams, IngestionProgress, CloudflareEnvironment> {
  override async run(event: WorkflowEvent<IngestionWorkflowParams>, step: AgentWorkflowStep) {
    const { ingestionId } = event.payload;
    await this.reportProgress({ step: "extract", status: "running", message: "Reading recipe source", percent: 0.1 });
    await step.do("mark extraction running", async () => updateIngestionStatus(this.env.DB, ingestionId, "extracting", "Reading recipe source"));
    const draft = await step.do("extract recipe with Workers AI", async () => extractWithWorkersAi(this.env, ingestionId));
    await this.reportProgress({ step: "map", status: "running", message: "Matching ingredients", percent: 0.75 });
    await step.do("save draft and ingredient mappings", async () => {
      const job = await this.env.DB.prepare("SELECT household_id FROM recipe_ingestions WHERE id=?").bind(ingestionId).first<{ household_id: string }>();
      if (!job) throw new Error("Ingestion job not found");
      await saveIngestionDraft(this.env.DB, ingestionId, job.household_id, draft, "workers-ai", this.env.RECIPE_EXTRACTION_MODEL);
    });
    await this.reportProgress({ step: "review", status: "complete", message: "Ready for review", percent: 1 });
    await step.reportComplete({ ingestionId });
    return { ingestionId };
  }
}

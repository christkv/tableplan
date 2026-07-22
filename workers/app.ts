import { createRequestHandler, RouterContextProvider } from "react-router";

import { cloudflareContext } from "../app/context";
import { processHouseholdInvitationEmail, type HouseholdInvitationEmailQueueMessage } from "../src/email/household-invitation-email";
import { processShoppingEmail, type ShoppingEmailQueueMessage } from "../src/email/shopping-email";

export { RecipeIngestionAgent, RecipeIngestionWorkflow } from "./recipe-ingestion";
export { AuthSessionStoreDO } from "./auth-session-store";

type EmailQueueMessage = ShoppingEmailQueueMessage | HouseholdInvitationEmailQueueMessage;

async function processEmailQueueMessage(env: CloudflareEnvironment, message: EmailQueueMessage) {
  if (message.kind === "household-invitation") return processHouseholdInvitationEmail(env, message);
  return processShoppingEmail(env, message);
}

const requestHandler = createRequestHandler(
  () => import("virtual:react-router/server-build"),
  import.meta.env.MODE,
);

export default {
  async fetch(request, env, ctx) {
    const context = new RouterContextProvider();
    context.set(cloudflareContext, { env, ctx });
    return requestHandler(request, context);
  },
  async queue(batch, env) {
    for (const message of batch.messages) {
      try {
        await processEmailQueueMessage(env, message.body);
        message.ack();
      } catch {
        if (message.attempts < 3) message.retry({ delaySeconds: Math.min(300, 30 * message.attempts) });
        else message.ack();
      }
    }
  },
} satisfies ExportedHandler<CloudflareEnvironment, EmailQueueMessage>;

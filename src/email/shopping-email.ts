import type { ShoppingListView } from "../domain/shopping";
import { createStorageClient } from "../storage";
import { formatNumber } from "../domain/quantity/format";
import { parseShareExpiryDays } from "../domain/shopping-share";
import { escapeHtml } from "../exports/render";

export interface ShoppingEmailQueueMessage {
  kind?: "shopping-list";
  deliveryId: string;
  rawToken: string;
}

type ShoppingEmailEnvironment = CloudflareEnvironment;

export interface ShoppingEmailContent {
  subject: string;
  html: string;
  text: string;
}

const quantityText = (min: string | null, max: string | null, unit: string | null) => min === null
  ? "" : `${formatNumber(Number(min))}${max === null ? "" : `-${formatNumber(Number(max))}`} ${unit ?? ""}`.trim();

export function renderShoppingEmail(list: ShoppingListView, shareUrl: string, expiresAt: string): ShoppingEmailContent {
  const dateRange = list.plan ? `${list.plan.startsOn} to ${list.plan.endsOn}` : "Current shopping list";
  const subject = `${list.name} - Tableplan`;
  const itemRows = list.items.map((item) => `<tr><td style="padding:8px 0;border-bottom:1px solid #e1e5e2;color:#17201b">${item.checked ? "&#9745;" : "&#9744;"} ${escapeHtml(item.name)}</td><td style="padding:8px 0 8px 16px;border-bottom:1px solid #e1e5e2;text-align:right;white-space:nowrap;font-weight:700;color:#17201b">${escapeHtml(quantityText(item.quantityMin, item.quantityMax, item.unitId))}</td></tr>`).join("");
  const html = `<!doctype html><html><body style="margin:0;background:#f3f5f2;font-family:Arial,sans-serif;color:#17201b"><div style="max-width:620px;margin:0 auto;padding:28px 18px"><div style="background:#fff;border:1px solid #d9ded9;padding:26px"><p style="margin:0 0 8px;color:#176b4d;font-size:11px;font-weight:700;text-transform:uppercase">Tableplan</p><h1 style="margin:0 0 8px;font-size:24px">${escapeHtml(list.name)}</h1><p style="margin:0 0 22px;color:#667069">${escapeHtml(dateRange)} &middot; ${list.items.length} items</p><p style="margin:0 0 22px"><a href="${escapeHtml(shareUrl)}" style="display:inline-block;padding:12px 17px;background:#176b4d;color:#fff;text-decoration:none;font-weight:700">Open checklist</a></p><table style="width:100%;border-collapse:collapse">${itemRows}</table><p style="margin:24px 0 0;color:#667069;font-size:12px">The checklist link works without signing in and expires ${escapeHtml(new Date(expiresAt).toUTCString())}. You can revoke it from Tableplan.</p></div></div></body></html>`;
  const lines = list.items.map((item) => `${item.checked ? "[x]" : "[ ]"} ${item.name}${quantityText(item.quantityMin, item.quantityMax, item.unitId) ? ` - ${quantityText(item.quantityMin, item.quantityMax, item.unitId)}` : ""}`);
  const text = `${list.name}\n${dateRange}\n\nOpen checklist: ${shareUrl}\n\n${lines.join("\n")}\n\nLink expires ${new Date(expiresAt).toUTCString()}.`;
  return { subject, html, text };
}

export async function queueShoppingListEmail(env: ShoppingEmailEnvironment, input: { householdId: string; userId: string; listId: string; recipientEmail: string; expiresInDays: number }) {
  const expiresInDays = parseShareExpiryDays(input.expiresInDays);
  const storage = createStorageClient(env);
  const share = await storage.createShoppingShare({ householdId: input.householdId, userId: input.userId, listId: input.listId, expiresInDays });
  let deliveryId: string;
  try {
    deliveryId = await storage.createEmailDelivery({ householdId: input.householdId, userId: input.userId, listId: input.listId, shareId: share.id, recipientEmail: input.recipientEmail });
  } catch (error) {
    await storage.revokeShoppingShare({ householdId: input.householdId, userId: input.userId }, input.listId, share.id).catch(() => undefined);
    throw error;
  }
  const message = { kind: "shopping-list", deliveryId, rawToken: share.token } satisfies ShoppingEmailQueueMessage;
  if (env.EMAIL_MODE === "cloud") {
    if (!env.EMAIL_DELIVERY_QUEUE) throw new Error("Email delivery queue is not configured");
    try {
      await env.EMAIL_DELIVERY_QUEUE.send(message);
      await storage.updateEmailDelivery(deliveryId, "queued");
    } catch (error) {
      await storage.updateEmailDelivery(deliveryId, "failed", { error: "Email could not be queued" }).catch(() => undefined);
      await storage.revokeShoppingShare({ householdId: input.householdId, userId: input.userId }, input.listId, share.id).catch(() => undefined);
      throw error;
    }
  } else {
    await processShoppingEmail(env, message);
  }
  const baseUrl = (env.PUBLIC_APP_URL ?? env.BETTER_AUTH_URL).replace(/\/$/, "");
  return { deliveryId, shareId: share.id, shareUrl: `${baseUrl}/shared/shopping#access=${encodeURIComponent(share.token)}`, expiresAt: share.expiresAt };
}

export async function processShoppingEmail(env: ShoppingEmailEnvironment, message: ShoppingEmailQueueMessage) {
  const storage = createStorageClient(env);
  const delivery = await storage.claimEmailDelivery(message.deliveryId);
  if (!delivery) return;
  try {
    const list = await storage.getShoppingListById({ userId: delivery.userId, householdId: delivery.householdId }, delivery.shoppingListId);
    if (!list) throw new Error("Shopping list not found");
    const baseUrl = (env.PUBLIC_APP_URL ?? env.BETTER_AUTH_URL).replace(/\/$/, "");
    const shareUrl = `${baseUrl}/shared/shopping#access=${encodeURIComponent(message.rawToken)}`;
    const content = renderShoppingEmail(list, shareUrl, delivery.expiresAt);
    let providerMessageId = `capture-${delivery.id}`;
    if (env.EMAIL_MODE === "cloud") {
      if (!env.EMAIL || !env.EMAIL_FROM) throw new Error("Cloudflare email binding is not configured");
      const sent = await env.EMAIL.send({
        from: env.EMAIL_FROM,
        to: delivery.recipientEmail,
        subject: content.subject,
        html: content.html,
        text: content.text,
        headers: { "Message-ID": `<tableplan-${delivery.id}@tableplan>` },
      });
      providerMessageId = sent.messageId;
    }
    await storage.updateEmailDelivery(delivery.id, "sent", { providerMessageId });
  } catch (error) {
    await storage.updateEmailDelivery(delivery.id, "failed", { error: error instanceof Error ? error.message.slice(0, 500) : "Email delivery failed" });
    throw error;
  }
}

export async function markEmailDeliveryFailed(db: D1Database, deliveryId: string, error: unknown) {
  const message = error instanceof Error ? error.message.slice(0, 500) : "Email delivery failed";
  await db.prepare(`UPDATE email_deliveries SET status='failed', last_error_code='delivery_failed', last_error_message=?,
    updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(message, deliveryId).run();
}

export async function getEmailDelivery(db: D1Database, householdId: string, userId: string, deliveryId: string) {
  const row = await db.prepare(`SELECT id, shopping_list_id, share_id, recipient_email, status, attempt_count, last_error_message,
    queued_at, sent_at, created_at FROM email_deliveries WHERE id=? AND household_id=? AND user_id=?`)
    .bind(deliveryId, householdId, userId).first<{
      id: string; shopping_list_id: string; share_id: string; recipient_email: string; status: string; attempt_count: number;
      last_error_message: string | null; queued_at: string | null; sent_at: string | null; created_at: string;
    }>();
  return row ? { id: row.id, shoppingListId: row.shopping_list_id, shareId: row.share_id, recipientEmail: row.recipient_email, status: row.status, attemptCount: row.attempt_count, lastError: row.last_error_message, queuedAt: row.queued_at, sentAt: row.sent_at, createdAt: row.created_at } : null;
}

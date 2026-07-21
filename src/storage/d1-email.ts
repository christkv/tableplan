export async function d1CreateEmailDelivery(db: D1Database, input: { householdId: string; userId: string; listId: string; shareId: string; recipientEmail: string }) {
  const [userRecent, householdRecent] = await Promise.all([db.prepare("SELECT COUNT(*) count FROM email_deliveries WHERE user_id=? AND created_at>=datetime('now','-1 hour')").bind(input.userId).first<{ count: number }>(), db.prepare("SELECT COUNT(*) count FROM email_deliveries WHERE household_id=? AND created_at>=datetime('now','-1 day')").bind(input.householdId).first<{ count: number }>()]);
  if ((userRecent?.count ?? 0) >= 5 || (householdRecent?.count ?? 0) >= 20) throw new Error("Email rate limit reached. Try again later.");
  const id = crypto.randomUUID(); await db.prepare("INSERT INTO email_deliveries (id, household_id, user_id, shopping_list_id, share_id, recipient_email, status) VALUES (?, ?, ?, ?, ?, ?, 'pending')").bind(id, input.householdId, input.userId, input.listId, input.shareId, input.recipientEmail).run(); return id;
}
export async function d1ClaimEmail(db: D1Database, id: string) {
  const claimed = await db.prepare(`UPDATE email_deliveries SET status='sending', attempt_count=attempt_count+1,
    last_error_code=NULL, last_error_message=NULL, updated_at=CURRENT_TIMESTAMP
    WHERE id=? AND status IN ('pending','queued','failed')`).bind(id).run();
  if (!claimed.meta.changes) return null;
  const r = await db.prepare(`SELECT ed.id, ed.user_id, ed.shopping_list_id, ed.recipient_email, ed.status,
    sl.household_id, ss.expires_at FROM email_deliveries ed
    JOIN shopping_lists sl ON sl.id=ed.shopping_list_id
    JOIN shopping_list_shares ss ON ss.id=ed.share_id WHERE ed.id=?`).bind(id)
    .first<{ id: string; user_id: string; shopping_list_id: string; recipient_email: string; status: string; household_id: string; expires_at: string }>();
  if (!r) {
    await d1UpdateEmail(db, id, "failed", { error: "Email delivery dependencies were not found" });
    throw new Error("Email delivery dependencies were not found");
  }
  return { id: r.id, userId: r.user_id, householdId: r.household_id, shoppingListId: r.shopping_list_id, recipientEmail: r.recipient_email, status: r.status, expiresAt: r.expires_at };
}
export async function d1UpdateEmail(db: D1Database, id: string, status: "queued" | "sending" | "sent" | "failed", details?: { providerMessageId?: string; error?: string }) {
  const allowedCurrent = status === "queued" ? ["pending"] : status === "failed" ? ["pending", "sending"] : status === "sent" ? ["sending"] : [];
  if (!allowedCurrent.length) return;
  await db.prepare(`UPDATE email_deliveries SET status=?,
    queued_at=CASE WHEN ?='queued' THEN CURRENT_TIMESTAMP ELSE queued_at END,
    sent_at=CASE WHEN ?='sent' THEN CURRENT_TIMESTAMP ELSE sent_at END,
    provider_message_id=COALESCE(?,provider_message_id),
    last_error_code=CASE WHEN ?='failed' THEN 'delivery_failed' ELSE NULL END,
    last_error_message=?, updated_at=CURRENT_TIMESTAMP WHERE id=? AND status IN (?,?)`)
    .bind(status, status, status, details?.providerMessageId ?? null, status, details?.error ?? null, id, allowedCurrent[0], allowedCurrent[1] ?? allowedCurrent[0]).run();
}
export async function d1GetEmail(db: D1Database, householdId: string, userId: string, id: string) { const r = await db.prepare("SELECT id, shopping_list_id, share_id, recipient_email, status, attempt_count, last_error_message, queued_at, sent_at, created_at FROM email_deliveries WHERE id=? AND household_id=? AND user_id=?").bind(id, householdId, userId).first<{ id: string; shopping_list_id: string; share_id: string; recipient_email: string; status: string; attempt_count: number; last_error_message: string | null; queued_at: string | null; sent_at: string | null; created_at: string }>(); return r ? { id: r.id, shoppingListId: r.shopping_list_id, shareId: r.share_id, recipientEmail: r.recipient_email, status: r.status, attemptCount: r.attempt_count, lastError: r.last_error_message, queuedAt: r.queued_at, sentAt: r.sent_at, createdAt: r.created_at } : null; }

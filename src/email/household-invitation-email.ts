import { escapeHtml } from "../exports/render";

export interface HouseholdInvitationEmailQueueMessage {
  kind: "household-invitation";
  invitationId: string;
  rawToken: string;
}

export interface HouseholdInvitationEmailContent {
  subject: string;
  html: string;
  text: string;
}

export function renderHouseholdInvitationEmail(input: {
  householdName: string;
  inviterName: string;
  relationship: string;
  invitationUrl: string;
  expiresAt: string;
}): HouseholdInvitationEmailContent {
  const subject = `${input.inviterName} invited you to ${input.householdName} - Tableplan`;
  const expiry = new Date(input.expiresAt).toUTCString();
  const html = `<!doctype html><html><body style="margin:0;background:#f3f5f2;font-family:Arial,sans-serif;color:#17201b"><div style="max-width:620px;margin:0 auto;padding:28px 18px"><div style="background:#fff;border:1px solid #d9ded9;padding:26px"><p style="margin:0 0 8px;color:#176b4d;font-size:11px;font-weight:700;text-transform:uppercase">Tableplan</p><h1 style="margin:0 0 12px;font-size:24px">Join ${escapeHtml(input.householdName)}</h1><p style="margin:0 0 22px;color:#4e5a53;line-height:1.55">${escapeHtml(input.inviterName)} invited you to join their household as ${escapeHtml(input.relationship)}. Set up your account to share meal plans, recipes, and shopping lists.</p><p style="margin:0 0 22px"><a href="${escapeHtml(input.invitationUrl)}" style="display:inline-block;padding:12px 17px;background:#176b4d;color:#fff;text-decoration:none;font-weight:700">Accept invitation</a></p><p style="margin:0;color:#667069;font-size:12px">This private, single-use link expires ${escapeHtml(expiry)}. If you did not expect this invitation, you can ignore this email.</p></div></div></body></html>`;
  const text = `${input.inviterName} invited you to join ${input.householdName} on Tableplan as ${input.relationship}.\n\nAccept the invitation and set up your account: ${input.invitationUrl}\n\nThis private, single-use link expires ${expiry}. If you did not expect this invitation, you can ignore this email.`;
  return { subject, html, text };
}

export async function processHouseholdInvitationEmail(env: CloudflareEnvironment, message: HouseholdInvitationEmailQueueMessage) {
  const invitation = await env.DB.prepare(`SELECT hi.id, hi.invited_email, hi.relationship, hi.expires_at, hi.delivery_status,
      hi.delivery_attempt_count, h.name household_name, u.name inviter_name
    FROM household_invitations hi JOIN households h ON h.id=hi.household_id JOIN "user" u ON u.id=hi.invited_by_user_id
    WHERE hi.id=?`).bind(message.invitationId).first<{
      id: string;
      invited_email: string;
      relationship: string;
      expires_at: string;
      delivery_status: string;
      delivery_attempt_count: number;
      household_name: string;
      inviter_name: string;
    }>();
  if (!invitation || invitation.delivery_status === "sent") return;
  await env.DB.prepare(`UPDATE household_invitations SET delivery_status='sending', delivery_attempt_count=delivery_attempt_count+1,
    updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(invitation.id).run();
  try {
    const baseUrl = (env.PUBLIC_APP_URL ?? env.BETTER_AUTH_URL).replace(/\/$/, "");
    const invitationUrl = `${baseUrl}/household/join#invite=${encodeURIComponent(message.rawToken)}`;
    const content = renderHouseholdInvitationEmail({
      householdName: invitation.household_name,
      inviterName: invitation.inviter_name,
      relationship: invitation.relationship,
      invitationUrl,
      expiresAt: invitation.expires_at,
    });
    let providerMessageId = `capture-${invitation.id}`;
    if (env.EMAIL_MODE === "cloud") {
      if (!env.EMAIL || !env.EMAIL_FROM) throw new Error("Cloudflare email binding is not configured");
      const sent = await env.EMAIL.send({
        from: env.EMAIL_FROM,
        to: invitation.invited_email,
        subject: content.subject,
        html: content.html,
        text: content.text,
        headers: { "Message-ID": `<tableplan-household-${invitation.id}@tableplan>` },
      });
      providerMessageId = sent.messageId;
    }
    await env.DB.prepare(`UPDATE household_invitations SET delivery_status='sent', provider_message_id=?, sent_at=CURRENT_TIMESTAMP,
      delivery_error=NULL, updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(providerMessageId, invitation.id).run();
  } catch (error) {
    const messageText = error instanceof Error ? error.message.slice(0, 500) : "Invitation email delivery failed";
    await env.DB.prepare(`UPDATE household_invitations SET delivery_status='failed', delivery_error=?,
      updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(messageText, invitation.id).run();
    throw error;
  }
}

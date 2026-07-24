package com.tableplan.email

import org.springframework.stereotype.Component

data class BrandedEmail(
    val html: String,
    val text: String,
)

data class BrandedEmailTemplate(
    val preheader: String,
    val eyebrow: String,
    val heading: String,
    val paragraphs: List<String>,
    val actionLabel: String,
    val actionUrl: String,
    val note: String,
    val checklist: BrandedEmailChecklist? = null,
)

data class BrandedEmailChecklist(
    val title: String,
    val summary: String,
    val items: List<BrandedEmailChecklistItem>,
)

data class BrandedEmailChecklistItem(
    val name: String,
    val quantity: String,
    val checked: Boolean,
    val detail: String? = null,
)

@Component
class BrandedEmailRenderer {
    fun render(template: BrandedEmailTemplate): BrandedEmail {
        val preheader = escape(template.preheader)
        val eyebrow = escape(template.eyebrow)
        val heading = escape(template.heading)
        val actionLabel = escape(template.actionLabel)
        val actionUrl = escape(template.actionUrl)
        val note = escape(template.note)
        val paragraphs =
            template.paragraphs.joinToString("\n") {
                """<p style="Margin:0 0 18px;color:#4f554c;font-size:16px;line-height:26px;">${escape(it)}</p>"""
            }
        val checklistHtml = template.checklist?.let(::renderChecklistHtml).orEmpty()

        val html =
            """
            <!doctype html>
            <html lang="en">
              <head>
                <meta charset="utf-8">
                <meta name="viewport" content="width=device-width, initial-scale=1">
                <meta name="color-scheme" content="light dark">
                <meta name="supported-color-schemes" content="light dark">
                <title>$heading</title>
                <style>
                  @media only screen and (max-width: 620px) {
                    .email-shell { width: 100% !important; }
                    .email-pad { padding-left: 24px !important; padding-right: 24px !important; }
                    .email-heading { font-size: 32px !important; line-height: 38px !important; }
                    .email-button { display: block !important; text-align: center !important; }
                  }
                  @media (prefers-color-scheme: dark) {
                    .email-page { background-color: #171b16 !important; }
                    .email-card { background-color: #242a22 !important; }
                    .email-heading { color: #fffaf2 !important; }
                    .email-copy, .email-copy p { color: #d9ddd5 !important; }
                    .email-note { background-color: #30362d !important; color: #c7cdc2 !important; }
                    .email-list { border-color: #424a3e !important; background-color: #242a22 !important; }
                    .email-list-row { border-color: #424a3e !important; }
                    .email-list-title, .email-list-name { color: #f0f2ed !important; }
                    .email-list-summary,
                    .email-list-detail, .email-list-quantity { color: #b9c0b5 !important; }
                    .email-footer { color: #9ea69a !important; }
                  }
                </style>
              </head>
              <body class="email-page" style="Margin:0;padding:0;background-color:#f4efe7;-webkit-text-size-adjust:100%;word-spacing:normal;">
                <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;mso-hide:all;">$preheader&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;</div>
                <table class="email-page" role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;background-color:#f4efe7;">
                  <tr>
                    <td align="center" style="padding:34px 12px;">
                      <table class="email-shell" role="presentation" width="600" cellspacing="0" cellpadding="0" border="0" style="width:600px;max-width:600px;">
                        <tr>
                          <td class="email-pad" style="padding:28px 42px;background-color:#344232;border-radius:20px 20px 0 0;">
                            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                              <tr>
                                <td width="48" valign="middle">
                                  <table role="presentation" width="42" height="42" cellspacing="0" cellpadding="0" border="0" style="width:42px;height:42px;background-color:#b95232;border-radius:12px;">
                                    <tr>
                                      <td align="center" valign="middle" style="color:#fffaf2;font-family:Arial,sans-serif;font-size:15px;font-weight:700;letter-spacing:-1px;">TR</td>
                                    </tr>
                                  </table>
                                </td>
                                <td valign="middle" style="padding-left:12px;color:#fffaf2;font-family:Arial,Helvetica,sans-serif;font-size:20px;font-weight:700;letter-spacing:-0.4px;">Table Rhythm</td>
                                <td align="right" valign="middle">
                                  <span style="display:inline-block;padding:5px 9px;border:1px solid #8e9a89;border-radius:999px;color:#ffe2d2;font-family:Arial,Helvetica,sans-serif;font-size:10px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;">Alpha</span>
                                </td>
                              </tr>
                            </table>
                          </td>
                        </tr>
                        <tr>
                          <td class="email-card email-pad" style="padding:46px 42px 42px;background-color:#fffdf9;border-radius:0 0 20px 20px;box-shadow:0 14px 36px rgba(62,45,31,0.09);">
                            <p style="Margin:0 0 12px;color:#b95232;font-family:Arial,Helvetica,sans-serif;font-size:12px;font-weight:700;letter-spacing:1.4px;text-transform:uppercase;">$eyebrow</p>
                            <h1 class="email-heading" style="Margin:0 0 24px;color:#2b3027;font-family:Georgia,'Times New Roman',serif;font-size:40px;font-weight:700;line-height:46px;letter-spacing:-0.7px;">$heading</h1>
                            <div class="email-copy" style="color:#4f554c;font-family:Arial,Helvetica,sans-serif;">
                              $paragraphs
                            </div>
                            $checklistHtml
                            <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="Margin:28px 0 30px;">
                              <tr>
                                <td style="border-radius:11px;background-color:#b95232;">
                                  <a class="email-button" href="$actionUrl" style="display:inline-block;padding:15px 24px;color:#ffffff;font-family:Arial,Helvetica,sans-serif;font-size:15px;font-weight:700;line-height:20px;text-decoration:none;">$actionLabel&nbsp;&rarr;</a>
                                </td>
                              </tr>
                            </table>
                            <div class="email-note" style="padding:16px 18px;border-left:3px solid #657b5d;border-radius:0 10px 10px 0;background-color:#eff5eb;color:#5d6559;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:20px;">$note</div>
                            <p style="Margin:30px 0 0;color:#777d73;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:19px;">
                              Button not working? Copy and paste this link into your browser:<br>
                              <a href="$actionUrl" style="color:#913b24;text-decoration:underline;word-break:break-all;">$actionUrl</a>
                            </p>
                          </td>
                        </tr>
                        <tr>
                          <td class="email-footer" align="center" style="padding:24px;color:#787b72;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:19px;">
                            Table Rhythm Alpha &middot; Your week, in rhythm
                          </td>
                        </tr>
                      </table>
                    </td>
                  </tr>
                </table>
              </body>
            </html>
            """.trimIndent()

        val text =
            buildString {
                appendLine("TABLE RHYTHM · ALPHA")
                appendLine()
                appendLine(template.heading)
                appendLine()
                template.paragraphs.forEach {
                    appendLine(it)
                    appendLine()
                }
                template.checklist?.let { checklist ->
                    appendLine(checklist.title.uppercase())
                    appendLine(checklist.summary)
                    appendLine()
                    checklist.items.forEach { item ->
                        append(if (item.checked) "[x] " else "[ ] ")
                        if (item.quantity.isNotBlank()) {
                            append(item.quantity)
                            append(" · ")
                        }
                        appendLine(item.name)
                        item.detail?.takeIf(String::isNotBlank)?.let {
                            appendLine("    $it")
                        }
                    }
                    appendLine()
                }
                appendLine("${template.actionLabel}: ${template.actionUrl}")
                appendLine()
                appendLine(template.note)
                appendLine()
                append("Table Rhythm Alpha · Your week, in rhythm")
            }

        return BrandedEmail(html = html, text = text)
    }

    private fun renderChecklistHtml(checklist: BrandedEmailChecklist): String {
        val rows =
            checklist.items.joinToString("\n") { item ->
                val nameDecoration = if (item.checked) "text-decoration:line-through;opacity:0.65;" else ""
                val detail =
                    item.detail?.takeIf(String::isNotBlank)?.let {
                        """<div class="email-list-detail" style="Margin-top:3px;color:#858a80;font-size:12px;line-height:17px;">${escape(it)}</div>"""
                    }.orEmpty()
                """
                <tr>
                  <td class="email-list-row" width="28" valign="top" style="padding:13px 0;border-bottom:1px solid #eee5da;color:#657b5d;font-family:Arial,Helvetica,sans-serif;font-size:17px;line-height:22px;">${if (item.checked) "&#10003;" else "&#9633;"}</td>
                  <td class="email-list-row" valign="top" style="padding:13px 10px 13px 0;border-bottom:1px solid #eee5da;font-family:Arial,Helvetica,sans-serif;">
                    <div class="email-list-name" style="${nameDecoration}color:#2b3027;font-size:14px;font-weight:700;line-height:21px;">${escape(item.name)}</div>
                    $detail
                  </td>
                  <td class="email-list-row email-list-quantity" align="right" valign="top" style="padding:13px 0;border-bottom:1px solid #eee5da;color:#5f655b;font-family:Arial,Helvetica,sans-serif;font-size:13px;font-weight:700;line-height:21px;white-space:nowrap;">${escape(item.quantity)}</td>
                </tr>
                """.trimIndent()
            }
        return """
            <div class="email-list" style="Margin:30px 0 6px;padding:22px 22px 6px;border:1px solid #e4dbcf;border-radius:14px;background-color:#fffdf9;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                <tr>
                  <td class="email-list-title" style="padding:0 0 5px;color:#2b3027;font-family:Georgia,'Times New Roman',serif;font-size:21px;font-weight:700;line-height:28px;">${escape(checklist.title)}</td>
                  <td class="email-list-summary" align="right" style="padding:0 0 5px;color:#777d73;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:20px;">${escape(checklist.summary)}</td>
                </tr>
              </table>
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                $rows
              </table>
            </div>
        """.trimIndent()
    }

    private fun escape(value: String): String =
        buildString(value.length) {
            value.forEach { character ->
                append(
                    when (character) {
                        '&' -> "&amp;"
                        '<' -> "&lt;"
                        '>' -> "&gt;"
                        '"' -> "&quot;"
                        '\'' -> "&#39;"
                        else -> character
                    },
                )
            }
        }
}

export interface PdfResponseOptions {
  filename: string;
  paper: "a4" | "letter";
  landscape?: boolean;
}

type PdfEnvironment = CloudflareEnvironment;

export async function renderPdfResponse(env: PdfEnvironment, html: string, options: PdfResponseOptions): Promise<Response> {
  if (env.PDF_MODE !== "cloud" || !env.BROWSER) {
    return new Response(html, { headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Disposition": `inline; filename="${options.filename.replace(/\.pdf$/, ".html")}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    } });
  }
  const rendered = await env.BROWSER.quickAction("pdf", {
    html,
    emulateMediaType: "print",
    setJavaScriptEnabled: false,
    pdfOptions: {
      format: options.paper,
      landscape: options.landscape ?? false,
      printBackground: true,
      tagged: true,
      preferCSSPageSize: false,
      margin: { top: "8mm", right: "8mm", bottom: "10mm", left: "8mm" },
    },
  });
  if (!rendered.ok) throw new Error(`PDF rendering failed (${rendered.status})`);
  return new Response(rendered.body, { headers: {
    "Content-Type": "application/pdf",
    "Content-Disposition": `attachment; filename="${options.filename}"`,
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
  } });
}

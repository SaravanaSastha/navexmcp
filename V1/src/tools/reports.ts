import { z } from "zod";
import type { RegisterFn } from "./context.js";
import { ok, wrap } from "./context.js";

export const registerReportTools: RegisterFn = (server, ctx) => {
  server.registerTool(
    "export_report",
    {
      title: "Export report",
      description:
        "Exports a NAVEX IRM report (by report ID from the My Reports tab) as CSV, PDF, or XLSX. Returns base64 file data. CSV exports are also returned as text for direct reading.",
      inputSchema: {
        reportId: z.number().int().min(1),
        format: z.enum(["csv", "pdf", "xlsx"]).default("csv"),
      },
    },
    wrap(ctx, "export_report", async ({ reportId, format }) => {
      const { base64, contentType } = await ctx.api.exportReport(reportId, format);
      const result: Record<string, unknown> = { reportId, format, contentType, fileBase64: base64 };
      if (format === "csv") {
        const text = Buffer.from(base64, "base64").toString("utf-8");
        // Keep the inline preview bounded so huge reports don't flood the context.
        result.preview = text.length > 50_000 ? `${text.slice(0, 50_000)}\n...[truncated]` : text;
      }
      return ok(result);
    }),
  );
};

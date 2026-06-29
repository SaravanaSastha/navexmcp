import { z } from "zod";
import type { RegisterFn } from "./context.js";
import { ok, wrap } from "./context.js";

export const registerAssessmentTools: RegisterFn = (server, ctx) => {
  server.registerTool(
    "issue_assessment",
    {
      title: "Issue assessment",
      description:
        "Issues a NAVEX IRM assessment. Common params: TableId, FieldId, ContentId (record), TemplateId, Name, ScheduleType (Immediate/Onetime/Recurring), UsersIds/GroupIds or VendorId+VendorContactId, ReviewerId, GenerateFindings (+FindingsOutputTableId/FieldId). Pass exactly the parameters your instance requires.",
      inputSchema: {
        params: z.record(z.unknown()).describe("IssueAssessment parameters object per the NAVEX API Reference Guide"),
      },
    },
    wrap(ctx, "issue_assessment", async ({ params }) => ok(await ctx.api.issueAssessment(params))),
  );
};

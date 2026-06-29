import { z } from "zod";
import type { RegisterFn } from "./context.js";
import { ok, wrap } from "./context.js";

export const registerWorkflowTools: RegisterFn = (server, ctx) => {
  server.registerTool(
    "get_workflows",
    {
      title: "List workflows",
      description: "Lists all workflows for a component by its alias.",
      inputSchema: { componentAlias: z.string().min(1) },
    },
    wrap(ctx, "get_workflows", async ({ componentAlias }) => ok(await ctx.api.getWorkflows(componentAlias))),
  );

  server.registerTool(
    "get_workflow",
    {
      title: "Get workflow",
      description: "Returns workflow details including all stages and transition IDs (needed for transition_record / vote_record).",
      inputSchema: { workflowId: z.number().int().min(1) },
    },
    wrap(ctx, "get_workflow", async ({ workflowId }) => ok(await ctx.api.getWorkflow(workflowId))),
  );

  server.registerTool(
    "transition_record",
    {
      title: "Transition record",
      description: "Moves a record to another workflow stage. Find transitionId via get_workflow.",
      inputSchema: {
        tableAlias: z.string().min(1),
        recordId: z.number().int().min(1),
        transitionId: z.number().int().min(1),
      },
    },
    wrap(ctx, "transition_record", async (args) => ok({ transitioned: await ctx.api.transitionRecord(args) })),
  );

  server.registerTool(
    "vote_record",
    {
      title: "Vote on record",
      description: "Casts a vote for a record in a voting workflow stage.",
      inputSchema: {
        tableAlias: z.string().min(1),
        recordId: z.number().int().min(1),
        transitionId: z.number().int().min(1),
        votingComments: z.string().optional(),
      },
    },
    wrap(ctx, "vote_record", async (args) => ok({ voted: await ctx.api.voteRecord(args) })),
  );
};

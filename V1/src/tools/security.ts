import { z } from "zod";
import type { RegisterFn } from "./context.js";
import { ok, wrap } from "./context.js";
import { paging, confirmFlag, requireConfirm } from "../schemas.js";

const userFilter = z.object({
  shortName: z.enum(["Active", "Deleted", "AccountType", "Vendor"]),
  filterType: z.enum(["EqualTo", "NotEqualTo", "ContainsAny"]).default("EqualTo"),
  value: z.string(),
});
const FILTER_IDS: Record<string, number> = { EqualTo: 5, NotEqualTo: 6, ContainsAny: 10002 };

function toNavexUserFilters(filters?: Array<z.infer<typeof userFilter>>) {
  return filters?.map((f) => ({
    Field: { ShortName: f.shortName },
    FilterType: String(FILTER_IDS[f.filterType]),
    Value: f.value,
  }));
}

export const registerSecurityTools: RegisterFn = (server, ctx) => {
  /* ---- Users ---- */
  server.registerTool(
    "get_user",
    { title: "Get user", description: "Returns all fields for a NAVEX IRM user by ID.", inputSchema: { userId: z.number().int().min(1) } },
    wrap(ctx, "get_user", async ({ userId }) => ok(await ctx.api.getUser(userId))),
  );

  server.registerTool(
    "list_users",
    {
      title: "List users",
      description: "Lists NAVEX IRM users with optional filters (Active, Deleted, AccountType 1=Full 2=Vendor 4=Awareness, Vendor profile ID).",
      inputSchema: { ...paging, filters: z.array(userFilter).optional() },
    },
    wrap(ctx, "list_users", async ({ pageIndex, pageSize, filters }) =>
      ok(await ctx.api.getUsers({ pageIndex, pageSize, filters: toNavexUserFilters(filters) }))),
  );

  server.registerTool(
    "get_user_count",
    {
      title: "Count users",
      description: "Returns the count of users matching optional filters.",
      inputSchema: { filters: z.array(userFilter).optional() },
    },
    wrap(ctx, "get_user_count", async ({ filters }) =>
      ok({ count: await ctx.api.getUserCount({ filters: toNavexUserFilters(filters) }) })),
  );

  server.registerTool(
    "create_user",
    {
      title: "Create user",
      description: "Creates a NAVEX IRM user account. Pass the user object fields per your instance (Username, FirstName, LastName, EmailAddress, AccountType, SecurityConfiguration, etc.).",
      inputSchema: { user: z.record(z.unknown()).describe("NAVEX user fields object") },
    },
    wrap(ctx, "create_user", async ({ user }) => ok(await ctx.api.createUser(user))),
  );

  server.registerTool(
    "update_user",
    {
      title: "Update user",
      description: "Updates a NAVEX IRM user. The user object must include Id.",
      inputSchema: { user: z.record(z.unknown()).refine((u) => "Id" in u, "user.Id is required") },
    },
    wrap(ctx, "update_user", async ({ user }) => ok(await ctx.api.updateUser(user))),
  );

  server.registerTool(
    "delete_user",
    {
      title: "Delete user",
      description: "DESTRUCTIVE: Deletes a NAVEX IRM user account by ID. Confirm with a human before calling.",
      inputSchema: { userId: z.number().int().min(1), confirm: confirmFlag },
    },
    wrap(ctx, "delete_user", async ({ userId, confirm }) => {
      requireConfirm(confirm);
      return ok({ deleted: await ctx.api.deleteUser(userId) });
    }),
  );

  /* ---- Groups ---- */
  server.registerTool(
    "get_group",
    { title: "Get group", description: "Returns all fields for a NAVEX IRM group by ID, including members.", inputSchema: { groupId: z.number().int().min(1) } },
    wrap(ctx, "get_group", async ({ groupId }) => ok(await ctx.api.getGroup(groupId))),
  );

  server.registerTool(
    "list_groups",
    { title: "List groups", description: "Lists NAVEX IRM groups (ID and Name).", inputSchema: { ...paging } },
    wrap(ctx, "list_groups", async ({ pageIndex, pageSize }) => ok(await ctx.api.getGroups({ pageIndex, pageSize }))),
  );

  server.registerTool(
    "create_group",
    {
      title: "Create group",
      description: "Creates a NAVEX IRM group. Provide Name, optional Description, BusinessUnit flag, and Users [{Id}].",
      inputSchema: { group: z.record(z.unknown()) },
    },
    wrap(ctx, "create_group", async ({ group }) => ok(await ctx.api.createGroup(group))),
  );

  server.registerTool(
    "update_group",
    {
      title: "Update group",
      description: "Updates a NAVEX IRM group. The group object must include Id.",
      inputSchema: { group: z.record(z.unknown()).refine((g) => "Id" in g, "group.Id is required") },
    },
    wrap(ctx, "update_group", async ({ group }) => ok(await ctx.api.updateGroup(group))),
  );

  server.registerTool(
    "delete_group",
    {
      title: "Delete group",
      description: "DESTRUCTIVE: Deletes a NAVEX IRM group by ID. Confirm with a human before calling.",
      inputSchema: { groupId: z.number().int().min(1), confirm: confirmFlag },
    },
    wrap(ctx, "delete_group", async ({ groupId, confirm }) => {
      requireConfirm(confirm);
      return ok({ deleted: await ctx.api.deleteGroup(groupId) });
    }),
  );
};

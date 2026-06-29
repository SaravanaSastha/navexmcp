import { z } from "zod";
import type { RegisterFn } from "./context.js";
import { ok, wrap } from "./context.js";

export const registerAuthTools: RegisterFn = (server, ctx) => {
  server.registerTool(
    "ping",
    {
      title: "Ping NAVEX session",
      description: "Verifies and refreshes the NAVEX IRM session for the current credentials. Returns true when the session is valid.",
      inputSchema: {},
    },
    wrap(ctx, "ping", async () => ok({ alive: await ctx.api.ping() })),
  );

  server.registerTool(
    "logout",
    {
      title: "Logout from NAVEX",
      description: "Terminates the current NAVEX IRM session. A new session is created automatically on the next call.",
      inputSchema: {},
    },
    wrap(ctx, "logout", async () => {
      await ctx.api.logout();
      return ok({ loggedOut: true });
    }),
  );

  server.registerTool(
    "refresh_metadata",
    {
      title: "Refresh metadata cache",
      description: "Clears the cached component/field metadata. Use after an admin changes DCF table structures.",
      inputSchema: { confirm: z.boolean().default(true) },
    },
    wrap(ctx, "refresh_metadata", async () => {
      ctx.metadata.invalidate();
      return ok({ invalidated: true });
    }),
  );
};

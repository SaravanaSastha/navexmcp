import { z } from "zod";
import type { RegisterFn } from "./context.js";
import { ok, wrap } from "./context.js";
import { componentRef, fieldRef, paging } from "../schemas.js";
import { FIELD_TYPES } from "../services/navex-api.js";

export const registerMetadataTools: RegisterFn = (server, ctx) => {
  server.registerTool(
    "list_components",
    {
      title: "List components",
      description: "Lists all DCF components (tables) visible to the current account. Start here to discover what data exists.",
      inputSchema: {},
    },
    wrap(ctx, "list_components", async () => ok(await ctx.metadata.listComponents())),
  );

  server.registerTool(
    "get_component",
    {
      title: "Get component",
      description: "Returns a component (table) by ID or alias.",
      inputSchema: { component: componentRef },
    },
    wrap(ctx, "get_component", async ({ component }) => ok(await ctx.metadata.resolveComponent(component))),
  );

  server.registerTool(
    "get_fields",
    {
      title: "Get fields",
      description: "Returns the field list (schema) for a component, with human-readable field types. Use before creating or filtering records.",
      inputSchema: { component: componentRef },
    },
    wrap(ctx, "get_fields", async ({ component }) => {
      const comp = await ctx.metadata.resolveComponent(component);
      const fields = await ctx.metadata.listFields(comp.Id);
      return ok(fields.map((f) => ({ ...f, FieldTypeName: FIELD_TYPES[f.FieldType] ?? `Unknown(${f.FieldType})` })));
    }),
  );

  server.registerTool(
    "get_field",
    {
      title: "Get field detail",
      description: "Returns details for one field by ID, or by name within a component.",
      inputSchema: { component: componentRef.optional(), field: fieldRef },
    },
    wrap(ctx, "get_field", async ({ component, field }) => {
      if (/^\d+$/.test(field)) {
        return ok(await ctx.api.getField(Number(field)));
      }
      if (component === undefined) throw new Error("component is required when field is a name");
      const comp = await ctx.metadata.resolveComponent(component);
      return ok(await ctx.metadata.resolveField(comp.Id, field));
    }),
  );

  server.registerTool(
    "get_lookup_options",
    {
      title: "Get available lookup records",
      description: "Lists records available to populate a lookup field (by field ID), for building valid create/update payloads.",
      inputSchema: {
        fieldId: z.number().int().min(1),
        recordId: z.number().int().min(1).optional().describe("Existing record ID when editing"),
        ...paging,
      },
    },
    wrap(ctx, "get_lookup_options", async ({ fieldId, recordId, pageIndex, pageSize }) =>
      ok(await ctx.api.getAvailableLookupRecords({ fieldId, pageIndex, pageSize, recordId }))),
  );
};

import { z } from "zod";
import type { RegisterFn, ToolContext } from "./context.js";
import { ok, wrap } from "./context.js";
import { componentRef, fieldRef, filterSchema, fieldsRecord, paging, confirmFlag, requireConfirm, toNavexValue, type FilterInput } from "../schemas.js";
import { FILTER_TYPES, type SearchCriteriaItem, type FilterTypeName } from "../services/navex-api.js";

async function buildFilters(ctx: ToolContext, componentId: number, filters?: FilterInput[]): Promise<SearchCriteriaItem[] | undefined> {
  if (!filters?.length) return undefined;
  return Promise.all(
    filters.map(async (f) => {
      const fieldPath = f.fieldPath ?? [(await ctx.metadata.resolveField(componentId, f.field)).Id];
      const item: SearchCriteriaItem = { FieldPath: fieldPath, FilterType: FILTER_TYPES[f.filterType as FilterTypeName] };
      if (f.value !== undefined) item.Value = f.value;
      return item;
    }),
  );
}

async function buildFieldValues(ctx: ToolContext, componentId: number, fields: Record<string, unknown>) {
  const entries = Object.entries(fields);
  return Promise.all(
    entries.map(async ([ref, value]) => {
      const field = await ctx.metadata.resolveField(componentId, ref);
      return { key: field.Id, value: toNavexValue(value) };
    }),
  );
}

export const registerRecordTools: RegisterFn = (server, ctx) => {
  server.registerTool(
    "get_record",
    {
      title: "Get record",
      description: "Returns a record's field values by component and record ID. Field keys are resolved to field names.",
      inputSchema: {
        component: componentRef,
        recordId: z.number().int().min(1),
        detail: z.boolean().default(false).describe("true = GetDetailRecord with lookup report details"),
        embedRichTextImages: z.boolean().default(false),
      },
    },
    wrap(ctx, "get_record", async ({ component, recordId, detail, embedRichTextImages }) => {
      const comp = await ctx.metadata.resolveComponent(component);
      if (detail) return ok(await ctx.api.getDetailRecord(comp.Id, recordId, embedRichTextImages));
      const record = await ctx.api.getRecord(comp.Id, recordId);
      const fields = await ctx.metadata.listFields(comp.Id);
      const byId = new Map(fields.map((f) => [f.Id, f.Name]));
      return ok({
        Id: record.Id,
        DisplayName: record.DisplayName,
        Fields: Object.fromEntries(record.FieldValues.map((fv) => [byId.get(fv.Key) ?? `field_${fv.Key}`, fv.Value])),
      });
    }),
  );

  server.registerTool(
    "search_records",
    {
      title: "Search records",
      description:
        "Searches records in a component with filters and paging. Filter example: {field:'Status', filterType:'EqualTo', value:'Open'}. Use get_fields first to learn field names.",
      inputSchema: {
        component: componentRef,
        filters: z.array(filterSchema).optional(),
        detail: z.boolean().default(false),
        fields: z.array(fieldRef).optional().describe("Project only these fields (names or IDs); detail mode only"),
        ...paging,
      },
    },
    wrap(ctx, "search_records", async ({ component, filters, detail, fields, pageIndex, pageSize }) => {
      const comp = await ctx.metadata.resolveComponent(component);
      const navexFilters = await buildFilters(ctx, comp.Id, filters);
      const fieldIds = fields
        ? await Promise.all(fields.map(async (f) => (await ctx.metadata.resolveField(comp.Id, f)).Id))
        : undefined;
      const body = { componentId: comp.Id, pageIndex, pageSize, filters: navexFilters, fieldIds };
      return ok(detail || fieldIds ? await ctx.api.getDetailRecords(body) : await ctx.api.getRecords(body));
    }),
  );

  server.registerTool(
    "count_records",
    {
      title: "Count records",
      description: "Returns the number of records in a component matching optional filters.",
      inputSchema: { component: componentRef, filters: z.array(filterSchema).optional() },
    },
    wrap(ctx, "count_records", async ({ component, filters }) => {
      const comp = await ctx.metadata.resolveComponent(component);
      const navexFilters = await buildFilters(ctx, comp.Id, filters);
      return ok({ count: await ctx.api.getRecordCount({ componentId: comp.Id, filters: navexFilters }) });
    }),
  );

  server.registerTool(
    "create_record",
    {
      title: "Create record",
      description:
        "Creates a record. 'fields' maps field name (or ID) to value: string, number, boolean, null, {id} for 1:1 lookups, [{id},...] for 1:many lookups. NOTE: the API does not enforce required fields — validate with get_fields first.",
      inputSchema: { component: componentRef, fields: fieldsRecord },
    },
    wrap(ctx, "create_record", async ({ component, fields }) => {
      const comp = await ctx.metadata.resolveComponent(component);
      const fieldValues = await buildFieldValues(ctx, comp.Id, fields);
      return ok(await ctx.api.createRecord(comp.Id, fieldValues));
    }),
  );

  server.registerTool(
    "update_record",
    {
      title: "Update record",
      description: "Updates fields on an existing record. Same value semantics as create_record.",
      inputSchema: { component: componentRef, recordId: z.number().int().min(1), fields: fieldsRecord },
    },
    wrap(ctx, "update_record", async ({ component, recordId, fields }) => {
      const comp = await ctx.metadata.resolveComponent(component);
      const fieldValues = await buildFieldValues(ctx, comp.Id, fields);
      return ok(await ctx.api.updateRecord(comp.Id, recordId, fieldValues));
    }),
  );

  server.registerTool(
    "delete_record",
    {
      title: "Delete record",
      description: "DESTRUCTIVE: Soft-deletes a record (recoverable only by database script). Requires confirm=true after human approval.",
      inputSchema: { component: componentRef, recordId: z.number().int().min(1), confirm: confirmFlag },
    },
    wrap(ctx, "delete_record", async ({ component, recordId, confirm }) => {
      requireConfirm(confirm);
      const comp = await ctx.metadata.resolveComponent(component);
      return ok({ deleted: await ctx.api.deleteRecord(comp.Id, recordId) });
    }),
  );

  server.registerTool(
    "import_file",
    {
      title: "Import file",
      description: "Queues a bulk import job using a defined import template. fileData must be base64.",
      inputSchema: {
        tableAlias: z.string().min(1),
        importTemplateName: z.string().min(1),
        fileName: z.string().min(1),
        fileData: z.string().min(1).describe("Base64-encoded file contents"),
        runAsSystem: z.boolean().default(false),
      },
    },
    wrap(ctx, "import_file", async (args) => ok({ queued: await ctx.api.importFile(args) })),
  );
};

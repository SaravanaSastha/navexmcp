import { Router, type Response } from "express";
import { z } from "zod";
import type { AuthedRequest } from "../middleware/auth.js";
import type { ContextRegistry } from "../services/context-registry.js";
import { sanitizeError, NavexError } from "../utils/errors.js";
import { auditLogger, logger } from "../utils/logger.js";
import { filterSchema, fieldsRecord, toNavexValue } from "../schemas.js";
import { FILTER_TYPES, type FilterTypeName, type SearchCriteriaItem } from "../services/navex-api.js";

/**
 * REST facade consumed by the Power Platform custom connector.
 * This is what the 30+ Power Automate cloud flows migrate onto,
 * replacing raw HTTP actions + per-flow cookie handling.
 */
export function createApiRouter(registry: ContextRegistry): Router {
  const router = Router();

  function handle(op: string, fn: (req: AuthedRequest) => Promise<unknown>) {
    return async (req: AuthedRequest, res: Response) => {
      const start = Date.now();
      try {
        const result = await fn(req);
        auditLogger.info({ op, identity: req.callerIdentity, durationMs: Date.now() - start, success: true });
        res.json(result ?? { ok: true });
      } catch (err) {
        logger.error({ op, err }, "api operation failed");
        auditLogger.info({ op, identity: req.callerIdentity, durationMs: Date.now() - start, success: false });
        const safe = sanitizeError(err);
        const status =
          err instanceof NavexError
            ? { AUTH_FAILED: 401, SESSION_EXPIRED: 401, PERMISSION_DENIED: 403, NOT_FOUND: 404, VALIDATION: 400, RATE_LIMITED: 429, UPSTREAM: 502, INTERNAL: 500 }[err.code]
            : err instanceof z.ZodError
              ? 400
              : 500;
        res.status(status).json({ error: safe });
      }
    };
  }

  const ctxOf = (req: AuthedRequest) => registry.getContext(req.navexCredentials!);

  /* ---- Metadata ---- */
  router.get("/components", handle("listComponents", async (req) => ctxOf(req).metadata.listComponents()));
  router.get("/components/:ref", handle("getComponent", async (req) => ctxOf(req).metadata.resolveComponent(req.params.ref!)));
  router.get("/components/:ref/fields", handle("getFields", async (req) => {
    const ctx = ctxOf(req);
    const comp = await ctx.metadata.resolveComponent(req.params.ref!);
    return ctx.metadata.listFields(comp.Id);
  }));

  /* ---- Records ---- */
  const searchBody = z.object({
    filters: z.array(filterSchema).optional(),
    pageIndex: z.number().int().min(0).default(0),
    pageSize: z.number().int().min(1).max(500).default(50),
    detail: z.boolean().default(false),
  });

  router.post("/components/:ref/records/search", handle("searchRecords", async (req) => {
    const ctx = ctxOf(req);
    const body = searchBody.parse(req.body ?? {});
    const comp = await ctx.metadata.resolveComponent(req.params.ref!);
    let filters: SearchCriteriaItem[] | undefined;
    if (body.filters?.length) {
      filters = await Promise.all(body.filters.map(async (f) => {
        const fieldPath = f.fieldPath ?? [(await ctx.metadata.resolveField(comp.Id, f.field)).Id];
        const item: SearchCriteriaItem = { FieldPath: fieldPath, FilterType: FILTER_TYPES[f.filterType as FilterTypeName] };
        if (f.value !== undefined) item.Value = f.value;
        return item;
      }));
    }
    const payload = { componentId: comp.Id, pageIndex: body.pageIndex, pageSize: body.pageSize, filters };
    return body.detail ? ctx.api.getDetailRecords(payload) : ctx.api.getRecords(payload);
  }));

  router.get("/components/:ref/records/:recordId", handle("getRecord", async (req) => {
    const ctx = ctxOf(req);
    const comp = await ctx.metadata.resolveComponent(req.params.ref!);
    return ctx.api.getRecord(comp.Id, Number(req.params.recordId));
  }));

  const writeBody = z.object({ fields: fieldsRecord });

  router.post("/components/:ref/records", handle("createRecord", async (req) => {
    const ctx = ctxOf(req);
    const { fields } = writeBody.parse(req.body ?? {});
    const comp = await ctx.metadata.resolveComponent(req.params.ref!);
    const fieldValues = await Promise.all(Object.entries(fields).map(async ([ref, value]) => ({
      key: (await ctx.metadata.resolveField(comp.Id, ref)).Id,
      value: toNavexValue(value),
    })));
    return ctx.api.createRecord(comp.Id, fieldValues);
  }));

  router.patch("/components/:ref/records/:recordId", handle("updateRecord", async (req) => {
    const ctx = ctxOf(req);
    const { fields } = writeBody.parse(req.body ?? {});
    const comp = await ctx.metadata.resolveComponent(req.params.ref!);
    const fieldValues = await Promise.all(Object.entries(fields).map(async ([ref, value]) => ({
      key: (await ctx.metadata.resolveField(comp.Id, ref)).Id,
      value: toNavexValue(value),
    })));
    return ctx.api.updateRecord(comp.Id, Number(req.params.recordId), fieldValues);
  }));

  router.delete("/components/:ref/records/:recordId", handle("deleteRecord", async (req) => {
    const ctx = ctxOf(req);
    const comp = await ctx.metadata.resolveComponent(req.params.ref!);
    return { deleted: await ctx.api.deleteRecord(comp.Id, Number(req.params.recordId)) };
  }));

  /* ---- Workflow ---- */
  router.get("/workflows", handle("getWorkflows", async (req) =>
    ctxOf(req).api.getWorkflows(String(req.query.componentAlias ?? ""))));
  router.get("/workflows/:id", handle("getWorkflow", async (req) => ctxOf(req).api.getWorkflow(Number(req.params.id))));

  const transitionBody = z.object({ tableAlias: z.string(), recordId: z.number().int(), transitionId: z.number().int(), votingComments: z.string().optional() });
  router.post("/workflows/transition", handle("transitionRecord", async (req) => {
    const body = transitionBody.parse(req.body);
    return { transitioned: await ctxOf(req).api.transitionRecord(body) };
  }));
  router.post("/workflows/vote", handle("voteRecord", async (req) => {
    const body = transitionBody.parse(req.body);
    return { voted: await ctxOf(req).api.voteRecord(body) };
  }));

  /* ---- Reports & assessments ---- */
  router.get("/reports/:id/export", handle("exportReport", async (req) => {
    const format = z.enum(["csv", "pdf", "xlsx"]).parse(String(req.query.format ?? "csv"));
    return ctxOf(req).api.exportReport(Number(req.params.id), format);
  }));
  router.post("/assessments/issue", handle("issueAssessment", async (req) =>
    ctxOf(req).api.issueAssessment(z.record(z.unknown()).parse(req.body ?? {}))));

  /* ---- Users & groups ---- */
  router.get("/users/:id", handle("getUser", async (req) => ctxOf(req).api.getUser(Number(req.params.id))));
  router.post("/users/search", handle("getUsers", async (req) => {
    const body = z.object({ pageIndex: z.number().default(0), pageSize: z.number().default(50), filters: z.array(z.unknown()).optional() }).parse(req.body ?? {});
    return ctxOf(req).api.getUsers(body as never);
  }));
  router.post("/users", handle("createUser", async (req) => ctxOf(req).api.createUser(z.record(z.unknown()).parse(req.body))));
  router.patch("/users", handle("updateUser", async (req) => ctxOf(req).api.updateUser(z.record(z.unknown()).parse(req.body))));
  router.delete("/users/:id", handle("deleteUser", async (req) => ({ deleted: await ctxOf(req).api.deleteUser(Number(req.params.id)) })));

  router.get("/groups/:id", handle("getGroup", async (req) => ctxOf(req).api.getGroup(Number(req.params.id))));
  router.post("/groups/search", handle("getGroups", async (req) => {
    const body = z.object({ pageIndex: z.number().default(0), pageSize: z.number().default(50) }).parse(req.body ?? {});
    return ctxOf(req).api.getGroups(body);
  }));
  router.post("/groups", handle("createGroup", async (req) => ctxOf(req).api.createGroup(z.record(z.unknown()).parse(req.body))));
  router.patch("/groups", handle("updateGroup", async (req) => ctxOf(req).api.updateGroup(z.record(z.unknown()).parse(req.body))));
  router.delete("/groups/:id", handle("deleteGroup", async (req) => ({ deleted: await ctxOf(req).api.deleteGroup(Number(req.params.id)) })));

  return router;
}

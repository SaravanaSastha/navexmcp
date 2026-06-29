import { z } from "zod";
import { FILTER_TYPES } from "./services/navex-api.js";
import { NavexError } from "./utils/errors.js";

/**
 * COPILOT STUDIO COMPATIBILITY (learn.microsoft.com/microsoft-copilot-studio/mcp-troubleshooting):
 * - No union/multi-type fields (truncates the tool schema)  -> single types only
 * - No `$ref` reference inputs (tool gets filtered out)     -> inline schemas
 * - No integer `exclusiveMinimum` (System.FormatException)  -> use .min(), never .positive()
 * - No literal/const                                        -> boolean + runtime check
 * Looser wire types are compensated by runtime coercion below.
 */

/** Component reference: alias or numeric ID — accepted as string, numbers coerced. */
export const componentRef = z.coerce
  .string()
  .min(1)
  .describe("Component alias/short name (e.g. 'Devices') or numeric component ID (e.g. '10001')");

/** Field reference: name or numeric ID — accepted as string, numbers coerced. */
export const fieldRef = z.coerce
  .string()
  .min(1)
  .describe("Field name (e.g. 'Status') or numeric field ID (e.g. '4216')");

export const paging = {
  pageIndex: z.number().int().min(0).default(0).describe("Zero-based page index"),
  pageSize: z.number().int().min(1).max(500).default(50).describe("Page size (1-500)"),
};

/** Destructive-tool confirmation: must be true at runtime. */
export const confirmFlag = z
  .boolean()
  .describe("Must be exactly true to execute this destructive operation. Always ask the human first.");

export function requireConfirm(confirm: unknown): void {
  if (confirm !== true) {
    throw new NavexError("Destructive operation not confirmed: pass confirm=true after human approval.", "VALIDATION");
  }
}

export const filterSchema = z.object({
  field: fieldRef.describe("Field to filter on: name or numeric ID"),
  fieldPath: z.array(z.number().int()).optional()
    .describe("Advanced: explicit field-ID path for lookup traversal; overrides 'field' when provided"),
  filterType: z.enum(Object.keys(FILTER_TYPES) as [string, ...string[]])
    .describe("Filter operator: one of " + Object.keys(FILTER_TYPES).join(", ")),
  value: z.string().optional()
    .describe("Comparison value as a string (numbers too, e.g. '7'). Omit for IsEmpty/IsNotEmpty/IsNull/IsNotNull. Pipe-delimited pair for Between/NotBetween ('a|b')."),
});
export type FilterInput = z.infer<typeof filterSchema>;

/**
 * Field values for create/update. Schema stays permissive (single 'object' type
 * with free-form values) for Copilot Studio; shapes are validated at runtime.
 */
export const fieldsRecord = z
  .record(z.any())
  .describe(
    "Map of field name (or ID) to value. Values: string, number, boolean, null, " +
      '{"id": 18} for a 1:1 lookup, or [{"id": 13}, {"id": 20}] for 1:many lookups.',
  );

/** Convert a friendly value into NAVEX dynamicRecord JSON form (runtime-validated). */
export function toNavexValue(v: unknown): unknown {
  if (v === null || typeof v === "string" || typeof v === "number" || typeof v === "boolean") return v;
  const idOf = (o: unknown): number | null => {
    if (o !== null && typeof o === "object") {
      const rec = o as Record<string, unknown>;
      const id = rec.id ?? rec.Id;
      if (typeof id === "number" && Number.isInteger(id)) return id;
      if (typeof id === "string" && /^\d+$/.test(id)) return Number(id);
    }
    return null;
  };
  if (Array.isArray(v)) {
    const ids = v.map(idOf);
    if (ids.every((x): x is number => x !== null)) return ids.map((Id) => ({ Id }));
    throw new NavexError('Invalid 1:many lookup value: expected [{"id": <recordId>}, ...].', "VALIDATION");
  }
  const id = idOf(v);
  if (id !== null) return { Id: id };
  throw new NavexError(
    'Invalid field value: use string, number, boolean, null, {"id": n} (1:1 lookup) or [{"id": n}] (1:many).',
    "VALIDATION",
  );
}

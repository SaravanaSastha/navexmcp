import { NavexError } from "../utils/errors.js";
/**
 * Caches DCF metadata (components, fields) so tools can accept aliases
 * and human field names instead of hardcoded IDs.
 * Tenant structures are dynamic, so everything is TTL-based.
 */
export class MetadataCache {
    api;
    ttlMs;
    components = null;
    fields = new Map();
    constructor(api, ttlMs) {
        this.api = api;
        this.ttlMs = ttlMs;
    }
    invalidate() {
        this.components = null;
        this.fields.clear();
    }
    async listComponents() {
        if (this.components && this.components.expiresAt > Date.now())
            return this.components.value;
        const value = await this.api.getComponentList();
        this.components = { value, expiresAt: Date.now() + this.ttlMs };
        return value;
    }
    /** Resolve a component by numeric ID or alias/short name (case-insensitive). */
    async resolveComponent(ref) {
        if (typeof ref === "number" || /^\d+$/.test(ref)) {
            const id = Number(ref);
            const cached = (await this.listComponents()).find((c) => c.Id === id);
            return cached ?? this.api.getComponent(id);
        }
        const list = await this.listComponents();
        const lower = ref.toLowerCase();
        const hit = list.find((c) => c.ShortName.toLowerCase() === lower || c.SystemName.toLowerCase() === lower || c.Name.toLowerCase() === lower);
        if (hit)
            return hit;
        // Fall back to the API in case the cache is stale.
        try {
            return await this.api.getComponentByAlias(ref);
        }
        catch {
            throw new NavexError(`Component "${ref}" not found. Use list_components to see available components.`, "NOT_FOUND");
        }
    }
    async listFields(componentId) {
        const cached = this.fields.get(componentId);
        if (cached && cached.expiresAt > Date.now())
            return cached.value;
        const value = await this.api.getFieldList(componentId);
        this.fields.set(componentId, { value, expiresAt: Date.now() + this.ttlMs });
        return value;
    }
    /** Resolve a field by numeric ID or name within a component. */
    async resolveField(componentId, ref) {
        const fields = await this.listFields(componentId);
        if (typeof ref === "number" || /^\d+$/.test(String(ref))) {
            const id = Number(ref);
            const hit = fields.find((f) => f.Id === id);
            if (hit)
                return hit;
            throw new NavexError(`Field ${id} not found in component ${componentId}.`, "NOT_FOUND");
        }
        const lower = String(ref).toLowerCase();
        const hit = fields.find((f) => f.ShortName.toLowerCase() === lower || f.SystemName.toLowerCase() === lower || f.Name.toLowerCase() === lower);
        if (hit)
            return hit;
        throw new NavexError(`Field "${ref}" not found in component ${componentId}. Use get_fields to list fields.`, "NOT_FOUND");
    }
}
//# sourceMappingURL=metadata-cache.js.map
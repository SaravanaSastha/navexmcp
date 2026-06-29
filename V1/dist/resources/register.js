import { ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { FIELD_TYPES } from "../services/navex-api.js";
function json(uri, data) {
    return { contents: [{ uri, mimeType: "application/json", text: JSON.stringify(data, null, 2) }] };
}
/** navex:// resource hierarchy for read-only discovery. */
export function registerResources(server, ctx) {
    server.registerResource("components", "navex://components", { title: "NAVEX components", description: "All DCF components (tables) visible to the current account", mimeType: "application/json" }, async (uri) => json(uri.href, await ctx.metadata.listComponents()));
    server.registerResource("component", new ResourceTemplate("navex://components/{componentId}", { list: undefined }), { title: "NAVEX component", description: "A single component by ID or alias" }, async (uri, { componentId }) => json(uri.href, await ctx.metadata.resolveComponent(String(componentId))));
    server.registerResource("component-fields", new ResourceTemplate("navex://components/{componentId}/fields", { list: undefined }), { title: "Component fields", description: "Field schema for a component" }, async (uri, { componentId }) => {
        const comp = await ctx.metadata.resolveComponent(String(componentId));
        const fields = await ctx.metadata.listFields(comp.Id);
        return json(uri.href, fields.map((f) => ({ ...f, FieldTypeName: FIELD_TYPES[f.FieldType] })));
    });
    server.registerResource("component-workflows", new ResourceTemplate("navex://components/{alias}/workflows", { list: undefined }), { title: "Component workflows", description: "Workflows for a component (by alias)" }, async (uri, { alias }) => json(uri.href, await ctx.api.getWorkflows(String(alias))));
    server.registerResource("users", "navex://users", { title: "NAVEX users", description: "First 100 active users", mimeType: "application/json" }, async (uri) => json(uri.href, await ctx.api.getUsers({
        pageIndex: 0, pageSize: 100,
        filters: [{ Field: { ShortName: "Active" }, FilterType: "5", Value: "true" }],
    })));
    server.registerResource("groups", "navex://groups", { title: "NAVEX groups", description: "First 100 groups", mimeType: "application/json" }, async (uri) => json(uri.href, await ctx.api.getGroups({ pageIndex: 0, pageSize: 100 })));
}
//# sourceMappingURL=register.js.map
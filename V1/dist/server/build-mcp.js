import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerAuthTools } from "../tools/auth.js";
import { registerSecurityTools } from "../tools/security.js";
import { registerMetadataTools } from "../tools/metadata.js";
import { registerRecordTools } from "../tools/records.js";
import { registerWorkflowTools } from "../tools/workflow.js";
import { registerReportTools } from "../tools/reports.js";
import { registerAssessmentTools } from "../tools/assessments.js";
import { registerAttachmentTools } from "../tools/attachments.js";
import { registerResources } from "../resources/register.js";
/** Builds a fully wired McpServer instance for one authenticated context. */
export function buildMcpServer(ctx) {
    const server = new McpServer({
        name: "navex-irm",
        version: "0.1.0",
    });
    registerAuthTools(server, ctx);
    registerMetadataTools(server, ctx);
    registerRecordTools(server, ctx);
    registerWorkflowTools(server, ctx);
    registerReportTools(server, ctx);
    registerAssessmentTools(server, ctx);
    registerAttachmentTools(server, ctx);
    registerSecurityTools(server, ctx);
    registerResources(server, ctx);
    return server;
}
//# sourceMappingURL=build-mcp.js.map
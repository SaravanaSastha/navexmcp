import { z } from "zod";
import { ok, wrap } from "./context.js";
import { componentRef, fieldRef, confirmFlag, requireConfirm } from "../schemas.js";
export const registerAttachmentTools = (server, ctx) => {
    server.registerTool("list_attachments", {
        title: "List attachments",
        description: "Lists attachments (file name, document ID) on a Documents field of a record.",
        inputSchema: { component: componentRef, recordId: z.number().int().min(1), field: fieldRef },
    }, wrap(ctx, "list_attachments", async ({ component, recordId, field }) => {
        const comp = await ctx.metadata.resolveComponent(component);
        const f = await ctx.metadata.resolveField(comp.Id, field);
        return ok(await ctx.api.getRecordAttachments(comp.Id, recordId, f.Id));
    }));
    server.registerTool("get_attachment", {
        title: "Get attachment",
        description: "Downloads one attachment (base64 FileData) by document ID.",
        inputSchema: { component: componentRef, recordId: z.number().int().min(1), field: fieldRef, documentId: z.number().int().min(1) },
    }, wrap(ctx, "get_attachment", async ({ component, recordId, field, documentId }) => {
        const comp = await ctx.metadata.resolveComponent(component);
        const f = await ctx.metadata.resolveField(comp.Id, field);
        return ok(await ctx.api.getRecordAttachment(comp.Id, recordId, f.Id, documentId));
    }));
    server.registerTool("upload_attachment", {
        title: "Upload attachment",
        description: "Adds one or more attachments to a Documents field on a record. Each file: {fileName, fileDataBase64}.",
        inputSchema: {
            component: componentRef,
            recordId: z.number().int().min(1),
            field: fieldRef,
            files: z.array(z.object({ fileName: z.string().min(1), fileDataBase64: z.string().min(1) })).min(1),
        },
    }, wrap(ctx, "upload_attachment", async ({ component, recordId, field, files }) => {
        const comp = await ctx.metadata.resolveComponent(component);
        const f = await ctx.metadata.resolveField(comp.Id, field);
        return ok(await ctx.api.updateRecordAttachments(comp.Id, recordId, f.Id, files.map((x) => ({ FileName: x.fileName, FileData: x.fileDataBase64 }))));
    }));
    server.registerTool("delete_attachments", {
        title: "Delete attachments",
        description: "DESTRUCTIVE: Deletes attachments by document ID from a Documents field. Confirm with a human before calling.",
        inputSchema: {
            component: componentRef,
            recordId: z.number().int().min(1),
            field: fieldRef,
            documentIds: z.array(z.number().int().min(1)).min(1),
            confirm: confirmFlag,
        },
    }, wrap(ctx, "delete_attachments", async ({ component, recordId, field, documentIds, confirm }) => {
        requireConfirm(confirm);
        const comp = await ctx.metadata.resolveComponent(component);
        const f = await ctx.metadata.resolveField(comp.Id, field);
        return ok(await ctx.api.deleteRecordAttachments(comp.Id, recordId, f.Id, documentIds));
    }));
};
//# sourceMappingURL=attachments.js.map
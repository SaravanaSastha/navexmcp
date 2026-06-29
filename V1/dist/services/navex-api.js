/** Field type IDs per the reference guide (GetField). */
export const FIELD_TYPES = {
    1: "Text", 2: "Numeric", 3: "Date", 4: "IPAddress", 5: "Lookup",
    6: "Master/Detail", 7: "Matrix", 8: "Documents", 9: "Assessments", 10: "Yes/No",
};
/** Filter type IDs per the reference guide (GetRecords). */
export const FILTER_TYPES = {
    Contains: 1, Excludes: 2, StartsWith: 3, EndsWith: 4,
    EqualTo: 5, NotEqualTo: 6, GreaterThan: 7, LessThan: 8,
    GreaterOrEqual: 9, LessOrEqual: 10, Between: 11, NotBetween: 12,
    IsEmpty: 13, IsNotEmpty: 14, IsNull: 15, IsNotNull: 16,
    Offset: 10001, ContainsAny: 10002, ContainsOnly: 10003,
    ContainsNone: 10004, ContainsAtLeast: 10005,
};
/**
 * Typed wrappers over every NAVEX IRM endpoint used by this server.
 * One thin method per API call; no business logic here.
 */
export class NavexApi {
    client;
    constructor(client) {
        this.client = client;
    }
    /* ---- Security ---- */
    ping() { return this.client.ping(); }
    logout() { return this.client.logout(); }
    getUser(id) { return this.client.request("GET", `/SecurityService/GetUser?id=${id}`); }
    getUsers(body) {
        return this.client.request("POST", "/SecurityService/GetUsers", body);
    }
    getUserCount(body) {
        return this.client.request("POST", "/SecurityService/GetUserCount", body);
    }
    createUser(user) { return this.client.request("POST", "/SecurityService/CreateUser", { user }); }
    updateUser(user) { return this.client.request("POST", "/SecurityService/UpdateUser", { user }); }
    deleteUser(id) { return this.client.request("DELETE", "/SecurityService/DeleteUser", { id }); }
    getGroup(id) { return this.client.request("GET", `/SecurityService/GetGroup?id=${id}`); }
    getGroups(body) {
        return this.client.request("POST", "/SecurityService/GetGroups", body);
    }
    createGroup(group) { return this.client.request("POST", "/SecurityService/CreateGroup", { group }); }
    updateGroup(group) { return this.client.request("POST", "/SecurityService/UpdateGroup", { group }); }
    deleteGroup(id) { return this.client.request("DELETE", "/SecurityService/DeleteGroup", { id }); }
    /* ---- Component metadata ---- */
    getComponentList() { return this.client.request("GET", "/ComponentService/GetComponentList"); }
    getComponent(id) { return this.client.request("GET", `/ComponentService/GetComponent?id=${id}`); }
    getComponentByAlias(alias) {
        return this.client.request("GET", `/ComponentService/GetComponentByAlias?alias=${encodeURIComponent(alias)}`);
    }
    getFieldList(componentId) { return this.client.request("GET", `/ComponentService/GetFieldList?componentId=${componentId}`); }
    getField(id) { return this.client.request("GET", `/ComponentService/GetField?id=${id}`); }
    getAvailableLookupRecords(body) {
        return this.client.request("POST", "/ComponentService/GetAvailableLookupRecords", body);
    }
    /* ---- Records ---- */
    getRecord(componentId, recordId) {
        return this.client.request("GET", `/ComponentService/GetRecord?componentId=${componentId}&recordId=${recordId}`);
    }
    getDetailRecord(componentId, recordId, embedRichTextImages = false) {
        return this.client.request("GET", `/ComponentService/GetDetailRecord?componentId=${componentId}&recordId=${recordId}&embedRichTextImages=${embedRichTextImages}`);
    }
    getRecords(body) {
        return this.client.request("POST", "/ComponentService/GetRecords", body);
    }
    getDetailRecords(body) {
        return this.client.request("POST", "/ComponentService/GetDetailRecords", body);
    }
    getRecordCount(body) {
        return this.client.request("POST", "/ComponentService/GetRecordCount", body);
    }
    createRecord(componentId, fieldValues) {
        return this.client.request("POST", "/ComponentService/CreateRecord", {
            componentId, dynamicRecord: { FieldValues: fieldValues },
        });
    }
    updateRecord(componentId, recordId, fieldValues) {
        return this.client.request("POST", "/ComponentService/UpdateRecord", {
            componentId, dynamicRecord: { Id: recordId, FieldValues: fieldValues },
        });
    }
    deleteRecord(componentId, recordId) {
        return this.client.request("DELETE", "/ComponentService/DeleteRecord", { componentId, recordId });
    }
    importFile(body) {
        return this.client.request("POST", "/ComponentService/ImportFile", body);
    }
    /* ---- Workflow ---- */
    getWorkflows(componentAlias) {
        return this.client.request("GET", `/ComponentService/GetWorkflows?componentalias=${encodeURIComponent(componentAlias)}`);
    }
    getWorkflow(id) { return this.client.request("GET", `/ComponentService/GetWorkflow?id=${id}`); }
    transitionRecord(body) {
        return this.client.request("POST", "/ComponentService/TransitionRecord", body);
    }
    voteRecord(body) {
        return this.client.request("POST", "/ComponentService/VoteRecord", body);
    }
    /* ---- Attachments ---- */
    getRecordAttachments(componentId, recordId, fieldId) {
        return this.client.request("GET", `/ComponentService/GetRecordAttachments?componentId=${componentId}&recordId=${recordId}&fieldId=${fieldId}`);
    }
    getRecordAttachment(componentId, recordId, fieldId, documentId) {
        return this.client.request("GET", `/ComponentService/GetRecordAttachment?componentId=${componentId}&recordId=${recordId}&fieldId=${fieldId}&documentId=${documentId}`);
    }
    updateRecordAttachments(componentId, recordId, fieldId, files) {
        return this.client.request("POST", "/ComponentService/UpdateRecordAttachments", {
            componentId, dynamicRecord: { Id: recordId, FieldValues: [{ key: fieldId, value: files }] },
        });
    }
    deleteRecordAttachments(componentId, recordId, fieldId, documentIds) {
        return this.client.request("POST", "/ComponentService/DeleteRecordAttachments", {
            componentId,
            dynamicRecord: { Id: recordId, FieldValues: [{ key: fieldId, value: documentIds.map((Id) => ({ Id })) }] },
        });
    }
    /* ---- Reports & Assessments ---- */
    exportReport(id, fileExtension) {
        return this.client.requestBinary(`/ReportService/ExportReport?id=${id}&fileExtension=${fileExtension}`);
    }
    issueAssessment(params) {
        return this.client.request("POST", "/AssessmentService/IssueAssessment", params);
    }
}
//# sourceMappingURL=navex-api.js.map
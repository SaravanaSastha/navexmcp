import type { NavexClient } from "../clients/navex-client.js";

/* ----- NAVEX wire types (from API Reference Guide 6.1) ----- */

export interface ComponentItem {
  Id: number;
  Name: string;
  SystemName: string;
  ShortName: string;
}

export interface FieldItem {
  Id: number;
  Name: string;
  SystemName: string;
  ShortName: string;
  ReadOnly: boolean;
  Required: boolean;
  FieldType: number;
  OneToMany?: boolean;
  [k: string]: unknown;
}

export interface DynamicRecordItem {
  Id: number;
  DisplayName: string;
  FieldValues: Array<{ Key: number; Value: unknown }>;
}

export interface SearchCriteriaItem {
  FieldPath: number[];
  FilterType: number;
  Value?: string | number;
}

export interface WorkflowSummary {
  Id: number;
  Name: string;
  IsActive: boolean;
  IsDefault: boolean;
}

export interface AttachmentInfo {
  FileName: string;
  FieldId: number;
  DocumentId: number;
}

export interface UserSummary {
  Id: number;
  FullName: string;
  Username: string;
  Active: boolean;
  Deleted: boolean;
  AccountType: number;
  [k: string]: unknown;
}

/** Field type IDs per the reference guide (GetField). */
export const FIELD_TYPES: Record<number, string> = {
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
} as const;
export type FilterTypeName = keyof typeof FILTER_TYPES;

/**
 * Typed wrappers over every NAVEX IRM endpoint used by this server.
 * One thin method per API call; no business logic here.
 */
export class NavexApi {
  constructor(private readonly client: NavexClient) {}

  /* ---- Security ---- */
  ping() { return this.client.ping(); }
  logout() { return this.client.logout(); }

  getUser(id: number) { return this.client.request<UserSummary>("GET", `/SecurityService/GetUser?id=${id}`); }
  getUsers(body: { pageIndex: number; pageSize: number; filters?: unknown[] }) {
    return this.client.request<UserSummary[]>("POST", "/SecurityService/GetUsers", body);
  }
  getUserCount(body: { filters?: unknown[] }) {
    return this.client.request<number>("POST", "/SecurityService/GetUserCount", body);
  }
  createUser(user: Record<string, unknown>) { return this.client.request<UserSummary>("POST", "/SecurityService/CreateUser", { user }); }
  updateUser(user: Record<string, unknown>) { return this.client.request<UserSummary>("POST", "/SecurityService/UpdateUser", { user }); }
  deleteUser(id: number) { return this.client.request<boolean>("DELETE", "/SecurityService/DeleteUser", { id }); }

  getGroup(id: number) { return this.client.request<Record<string, unknown>>("GET", `/SecurityService/GetGroup?id=${id}`); }
  getGroups(body: { pageIndex: number; pageSize: number; filters?: unknown[] }) {
    return this.client.request<Array<{ Id: number; Name: string }>>("POST", "/SecurityService/GetGroups", body);
  }
  createGroup(group: Record<string, unknown>) { return this.client.request<Record<string, unknown>>("POST", "/SecurityService/CreateGroup", { group }); }
  updateGroup(group: Record<string, unknown>) { return this.client.request<Record<string, unknown>>("POST", "/SecurityService/UpdateGroup", { group }); }
  deleteGroup(id: number) { return this.client.request<boolean>("DELETE", "/SecurityService/DeleteGroup", { id }); }

  /* ---- Component metadata ---- */
  getComponentList() { return this.client.request<ComponentItem[]>("GET", "/ComponentService/GetComponentList"); }
  getComponent(id: number) { return this.client.request<ComponentItem>("GET", `/ComponentService/GetComponent?id=${id}`); }
  getComponentByAlias(alias: string) {
    return this.client.request<ComponentItem>("GET", `/ComponentService/GetComponentByAlias?alias=${encodeURIComponent(alias)}`);
  }
  getFieldList(componentId: number) { return this.client.request<FieldItem[]>("GET", `/ComponentService/GetFieldList?componentId=${componentId}`); }
  getField(id: number) { return this.client.request<FieldItem>("GET", `/ComponentService/GetField?id=${id}`); }
  getAvailableLookupRecords(body: { fieldId: number; pageIndex: number; pageSize: number; recordId?: number }) {
    return this.client.request<DynamicRecordItem[]>("POST", "/ComponentService/GetAvailableLookupRecords", body);
  }

  /* ---- Records ---- */
  getRecord(componentId: number, recordId: number) {
    return this.client.request<DynamicRecordItem>("GET", `/ComponentService/GetRecord?componentId=${componentId}&recordId=${recordId}`);
  }
  getDetailRecord(componentId: number, recordId: number, embedRichTextImages = false) {
    return this.client.request<Record<string, unknown>>(
      "GET",
      `/ComponentService/GetDetailRecord?componentId=${componentId}&recordId=${recordId}&embedRichTextImages=${embedRichTextImages}`,
    );
  }
  getRecords(body: { componentId: number; pageIndex: number; pageSize: number; filters?: SearchCriteriaItem[] }) {
    return this.client.request<DynamicRecordItem[]>("POST", "/ComponentService/GetRecords", body);
  }
  getDetailRecords(body: { componentId: number; pageIndex: number; pageSize: number; filters?: SearchCriteriaItem[]; fieldIds?: number[] }) {
    return this.client.request<Array<Record<string, unknown>>>("POST", "/ComponentService/GetDetailRecords", body);
  }
  getRecordCount(body: { componentId: number; filters?: SearchCriteriaItem[] }) {
    return this.client.request<number>("POST", "/ComponentService/GetRecordCount", body);
  }
  createRecord(componentId: number, fieldValues: Array<{ key: number; value: unknown }>) {
    return this.client.request<DynamicRecordItem>("POST", "/ComponentService/CreateRecord", {
      componentId, dynamicRecord: { FieldValues: fieldValues },
    });
  }
  updateRecord(componentId: number, recordId: number, fieldValues: Array<{ key: number; value: unknown }>) {
    return this.client.request<DynamicRecordItem>("POST", "/ComponentService/UpdateRecord", {
      componentId, dynamicRecord: { Id: recordId, FieldValues: fieldValues },
    });
  }
  deleteRecord(componentId: number, recordId: number) {
    return this.client.request<boolean>("DELETE", "/ComponentService/DeleteRecord", { componentId, recordId });
  }
  importFile(body: { tableAlias: string; importTemplateName: string; fileName: string; fileData: string; runAsSystem: boolean }) {
    return this.client.request<boolean>("POST", "/ComponentService/ImportFile", body);
  }

  /* ---- Workflow ---- */
  getWorkflows(componentAlias: string) {
    return this.client.request<WorkflowSummary[]>("GET", `/ComponentService/GetWorkflows?componentalias=${encodeURIComponent(componentAlias)}`);
  }
  getWorkflow(id: number) { return this.client.request<Record<string, unknown>>("GET", `/ComponentService/GetWorkflow?id=${id}`); }
  transitionRecord(body: { tableAlias: string; recordId: number; transitionId: number }) {
    return this.client.request<boolean>("POST", "/ComponentService/TransitionRecord", body);
  }
  voteRecord(body: { tableAlias: string; recordId: number; transitionId: number; votingComments?: string }) {
    return this.client.request<boolean>("POST", "/ComponentService/VoteRecord", body);
  }

  /* ---- Attachments ---- */
  getRecordAttachments(componentId: number, recordId: number, fieldId: number) {
    return this.client.request<AttachmentInfo[]>(
      "GET", `/ComponentService/GetRecordAttachments?componentId=${componentId}&recordId=${recordId}&fieldId=${fieldId}`);
  }
  getRecordAttachment(componentId: number, recordId: number, fieldId: number, documentId: number) {
    return this.client.request<{ FileName: string; FileData: string }>(
      "GET",
      `/ComponentService/GetRecordAttachment?componentId=${componentId}&recordId=${recordId}&fieldId=${fieldId}&documentId=${documentId}`);
  }
  updateRecordAttachments(componentId: number, recordId: number, fieldId: number, files: Array<{ FileName: string; FileData: string }>) {
    return this.client.request<Array<Record<string, unknown>>>("POST", "/ComponentService/UpdateRecordAttachments", {
      componentId, dynamicRecord: { Id: recordId, FieldValues: [{ key: fieldId, value: files }] },
    });
  }
  deleteRecordAttachments(componentId: number, recordId: number, fieldId: number, documentIds: number[]) {
    return this.client.request<Array<Record<string, unknown>>>("POST", "/ComponentService/DeleteRecordAttachments", {
      componentId,
      dynamicRecord: { Id: recordId, FieldValues: [{ key: fieldId, value: documentIds.map((Id) => ({ Id })) }] },
    });
  }

  /* ---- Reports & Assessments ---- */
  exportReport(id: number, fileExtension: "csv" | "pdf" | "xlsx") {
    return (this.client as NavexClient).requestBinary(`/ReportService/ExportReport?id=${id}&fileExtension=${fileExtension}`);
  }
  issueAssessment(params: Record<string, unknown>) {
    return this.client.request<unknown>("POST", "/AssessmentService/IssueAssessment", params);
  }
}

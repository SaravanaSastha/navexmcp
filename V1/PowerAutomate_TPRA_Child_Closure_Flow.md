# NAVEX TPRA → Close Child Records — Power Automate (ROBUST, stage-aware)

**Goal:** daily (UTC), find TPRA records updated yesterday with Active=false. For each related **Risk** (key 7972) and **Risk Register** item (key 11955): set the **Status** field to Closed, then **transition the Workflow Stage to Closed using the transition valid for that record's current stage** (skip if already Closed).

Why stage-aware: a transition ID is only valid from one stage. Firing 165 on an already-Closed risk → `Invalid permissions`. So we read each child's current stage and `Switch`.

---

## Action tree (inside your existing `Try` scope, after `HTTP` = GetDetailRecords)

```
Apply_to_each_TPRA                         loop @body('HTTP')
├─ Filter_Risks                            FieldValues where Key = 7972
├─ Apply_to_each_Risk                      loop related Risks
│   ├─ Close_Risk_Status                   UpdateRecord  (10012, field 13538 = 6)
│   ├─ Get_Risk_Stage                      GetDetailRecords (10012, this Id, fieldIds [526])
│   ├─ Filter_Risk_StageField              FieldValues where Key = 526
│   ├─ Compose_Risk_StageId                the current stage Id
│   └─ Switch_Risk_Stage                   pick transition by stage
│        case 213 → Transition_Risk (165)
│        case 216 → Transition_Risk (166)
│        case 215 → Transition_Risk (102)
│        default  → (do nothing — already Closed/Archive)
├─ Filter_Register                         FieldValues where Key = 11955
└─ Apply_to_each_Register                  loop related Risk Register items
    ├─ Close_Register_Status               UpdateRecord  (10560, field 13032 = 6)
    ├─ Get_Register_Stage                  GetDetailRecords (10560, this Id, fieldIds [11008])
    ├─ Filter_Register_StageField          FieldValues where Key = 11008
    ├─ Compose_Register_StageId            the current stage Id
    └─ Switch_Register_Stage               pick transition by stage
         case 526 → Transition_Register (263)
         case 520 → Transition_Register (310)
         case 521 → Transition_Register (311)
         case 522 → Transition_Register (317)
         case 523 → Transition_Register (313)
         case 559 → Transition_Register (319)
         case 524 → Transition_Register (219)
         case 525 → Transition_Register (213)
         default  → (do nothing — already Closed)
```

All HTTP actions use Headers `Content-Type: application/json` and Cookie `@outputs('Login_Cookie')`.

---

## RISKS branch

### `Apply_to_each_Risk` — Select: `@first(body('Filter_Risks'))?['Value']`

**`Close_Risk_Status`** — POST `@{variables('BaseUrl')}/ComponentService/UpdateRecord`
```json
{
  "componentId": 10012,
  "dynamicRecord": {
    "Id": "@{items('Apply_to_each_Risk')?['Id']}",
    "FieldValues": [ { "key": 13538, "value": { "Id": 6 } } ]
  }
}
```

**`Get_Risk_Stage`** — POST `@{variables('BaseUrl')}/ComponentService/GetDetailRecords`  *(reads current stage as JSON)*
```json
{
  "componentId": 10012,
  "pageIndex": 0,
  "pageSize": 1,
  "filters": [ { "FieldPath": [519], "FilterType": 5, "Value": "@{items('Apply_to_each_Risk')?['Id']}" } ],
  "fieldIds": [526]
}
```
(519 = the Risk record's `Id` field; 526 = Workflow Stage.)

**`Filter_Risk_StageField`** — Filter array
- From: `@first(body('Get_Risk_Stage'))?['FieldValues']`
- Condition (advanced): `@equals(item()?['Key'], 526)`

**`Compose_Risk_StageId`** — Compose
```
@first(body('Filter_Risk_StageField'))?['Value']?['Id']
```

**`Switch_Risk_Stage`** — Switch on `@outputs('Compose_Risk_StageId')`
- Case **213** → `Transition_Risk` with transitionId **165**
- Case **216** → transitionId **166**
- Case **215** → transitionId **102**
- Default → leave empty (already Closed / Archive — nothing to do)

**`Transition_Risk`** (the action inside each case) — POST `@{variables('BaseUrl')}/ComponentService/TransitionRecord`
```json
{ "tableAlias": "Risks", "recordId": @{items('Apply_to_each_Risk')?['Id']}, "transitionId": <case value> }
```

---

## RISK REGISTER branch

### `Apply_to_each_Register` — Select: `@first(body('Filter_Register'))?['Value']`

**`Close_Register_Status`** — POST `…/ComponentService/UpdateRecord`
```json
{
  "componentId": 10560,
  "dynamicRecord": {
    "Id": "@{items('Apply_to_each_Register')?['Id']}",
    "FieldValues": [ { "key": 13032, "value": { "Id": 6 } } ]
  }
}
```

**`Get_Register_Stage`** — POST `…/ComponentService/GetDetailRecords`
```json
{
  "componentId": 10560,
  "pageIndex": 0,
  "pageSize": 1,
  "filters": [ { "FieldPath": [10998], "FilterType": 5, "Value": "@{items('Apply_to_each_Register')?['Id']}" } ],
  "fieldIds": [11008]
}
```
(10998 = the Risk Register record's `Id` field; 11008 = Workflow Stage.)

**`Filter_Register_StageField`** — Filter array
- From: `@first(body('Get_Register_Stage'))?['FieldValues']`
- Condition (advanced): `@equals(item()?['Key'], 11008)`

**`Compose_Register_StageId`** — Compose
```
@first(body('Filter_Register_StageField'))?['Value']?['Id']
```

**`Switch_Register_Stage`** — Switch on `@outputs('Compose_Register_StageId')`
- Case **526** → transitionId **263**
- Case **520** → **310**
- Case **521** → **311**
- Case **522** → **317**
- Case **523** → **313**
- Case **559** → **319**
- Case **524** → **219**
- Case **525** → **213**
- Default → leave empty (already Closed)

**`Transition_Register`** (inside each case) — POST `…/ComponentService/TransitionRecord`
```json
{ "tableAlias": "_RiskRegister", "recordId": @{items('Apply_to_each_Register')?['Id']}, "transitionId": <case value> }
```

---

## Verify each transition once (in Postman) before trusting the Switch
- **Risks New→Closed (165):** confirmed working on a New record.
- **Risk Register Identify→Closed (263):** still UNVERIFIED — test `POST /ComponentService/TransitionRecord { "tableAlias":"_RiskRegister","recordId":<an Identify-stage item>,"transitionId":263 }`. 263 is a "Conditional Transition", so if it returns `Invalid permissions`/criteria error, the Register workflow may not allow an API close from Identify — tell me and we'll adjust (e.g., move it forward a stage first, or confirm the service account's group).
- Most Register transitions except 219 (Monitor) and 213 (Risk Disposition) are "Conditional" — verify any stage your data actually uses.

## Permissions
TransitionRecord runs as the logged-in account (`ambassador.user`). It must be in a group allowed to transition that stage:
- Risks "New": **GRC Org** or **PRM Department**.
- Risk Register "Identify": **GRC Org** or **Administration**.
A correct transition that still returns `Invalid permissions` = the account isn't in the right group (admin fix on the account).

## Dynamic dates (after testing) — in the existing GetDetailRecords (`HTTP`) body
- Lower `Value`: `@{formatDateTime(addDays(utcNow(),-1),'yyyy-MM-dd')}T00:00:00`
- Upper `Value`: `@{formatDateTime(utcNow(),'yyyy-MM-dd')}T00:00:00` · keep `12927 = false`.

## Reference
| Item | Value |
|---|---|
| TPRA / Active / UpdatedAt | 10215 / 12927=false / 4209 |
| Risks table (key 7972) | comp 10012, alias `Risks`, Id field 519, Stage field 526, wf 148, Closed stage 212 |
| Risk Register (key 11955) | comp 10560, alias `_RiskRegister`, Id field 10998, Stage field 11008, wf 373, Closed stage 519 |
| Status fields → `{ "Id": 6 }` | Risks 13538 / Register 13032 |
| Closed transition by stage | Risks: 213→165, 216→166, 215→102 · Register: 526→263, 520→310, 521→311, 522→317, 523→313, 559→319, 524→219, 525→213 |

## Security TODO
Move NAVEX credentials out of the Login body into a secure parameter / Key Vault; rotate the current password.

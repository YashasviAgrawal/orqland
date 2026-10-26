# Action matrix

Generated from `backend/src/domain/engine.ts` (`npm run docs:actions`). Each code is a button the API returns in an order’s `actions` list only when it is valid for that order’s fulfilment type, current statuses and the caller’s role.

| Action code | Roles | Kind |
|---|---|---|
| `ACCEPT` | Workspace Admin | state change |
| `ACCEPT_AND_START_PREP` | Workspace Admin | state change |
| `REJECT` | Workspace Admin | state change |
| `REQUEST_CLARIFICATION` | Workspace Admin | state change |
| `CANCEL` | Workspace Admin | state change |
| `CONFIRM_CANCELLATION` | Workspace Admin | state change |
| `DECLINE_CANCELLATION` | Workspace Admin | state change |
| `START_PREPARATION` | Workspace Admin | state change |
| `ADD_PREP_TIME` | Workspace Admin | state change |
| `MARK_READY` | Workspace Admin | state change |
| `CONFIRM_SCHEDULE` | Workspace Admin | state change |
| `RESCHEDULE` | Workspace Admin | state change |
| `APPROVE_RESCHEDULE_REQUEST` | Workspace Admin | state change |
| `DECLINE_RESCHEDULE_REQUEST` | Workspace Admin | state change |
| `VIEW_AVAILABILITY` | Workspace Admin | navigation / view |
| `MANAGE_CAPACITY` | Workspace Admin | navigation / view |
| `ASSIGN_AGENT` | Workspace Admin | state change |
| `AUTO_ASSIGN_AGENT` | Workspace Admin | state change |
| `REASSIGN_AGENT` | Workspace Admin | state change |
| `TRACK_DELIVERY` | Workspace Admin, Delivery Agent | navigation / view |
| `CONFIRM_PICKUP_HANDOVER` | Workspace Admin | state change |
| `CONFIRM_DELIVERED` | Workspace Admin | state change |
| `CONFIRM_SERVED` | Workspace Admin | state change |
| `CONFIRM_SERVICE_COMPLETION` | Workspace Admin | state change |
| `RETRY_DELIVERY` | Workspace Admin | state change |
| `APPROVE_RETURN` | Workspace Admin | state change |
| `DECLINE_RETURN` | Workspace Admin | state change |
| `CONFIRM_RETURN_RECEIVED` | Workspace Admin | state change |
| `CONFIRM_RETURN_PICKUP` | Workspace Admin | state change |
| `ASSIGN_PROVIDER` | Workspace Admin | state change |
| `REPORT_PROVIDER_UNAVAILABLE` | Workspace Admin | state change |
| `SET_MEETING_DETAILS` | Workspace Admin, Service Provider / Staff | state change |
| `CONFIRM_APPOINTMENT` | Service Provider / Staff | state change |
| `START_TRAVEL` | Workspace Admin, Service Provider / Staff | state change |
| `MARK_ATTENDED` | Workspace Admin, Service Provider / Staff | state change |
| `START_SERVICE` | Workspace Admin, Service Provider / Staff | state change |
| `MARK_SERVICE_COMPLETED` | Service Provider / Staff | state change |
| `REPORT_CUSTOMER_UNAVAILABLE` | Workspace Admin, Service Provider / Staff | state change |
| `MARK_SERVICE_FAILED` | Workspace Admin, Service Provider / Staff | state change |
| `REQUEST_RESCHEDULING` | Service Provider / Staff | state change |
| `VIEW_PAYMENT_DETAILS` | Workspace Admin | navigation / view |
| `RECORD_COD_COLLECTED` | Workspace Admin, Delivery Agent | state change |
| `RETRY_PAYMENT` | Workspace Admin | state change |
| `UPDATE_REFUND_STATUS` | Workspace Admin | state change |
| `ACCEPT_DELIVERY` | Delivery Agent | state change |
| `REJECT_DELIVERY` | Delivery Agent | state change |
| `NAVIGATE_TO_PICKUP` | Delivery Agent | navigation / view |
| `NAVIGATE_TO_CUSTOMER` | Delivery Agent | navigation / view |
| `CONFIRM_PICKUP` | Delivery Agent | state change |
| `START_DELIVERY` | Delivery Agent | state change |
| `CONTACT_CUSTOMER` | Delivery Agent, Service Provider / Staff | navigation / view |
| `MARK_DELIVERED` | Delivery Agent | state change |
| `MARK_DELIVERY_FAILED` | Delivery Agent | state change |
| `RETURN_TO_WORKSPACE` | Delivery Agent | state change |
| `CUSTOMER_REQUEST_CANCELLATION` | Customer (sample API) | state change |
| `CUSTOMER_REQUEST_RESCHEDULE` | Customer (sample API) | state change |
| `CUSTOMER_REQUEST_RETURN` | Customer (sample API) | state change |
| `CUSTOMER_RESPOND_CLARIFICATION` | Customer (sample API) | state change |
| `PAYMENT_CONFIRMED` | System | state change |
| `PAYMENT_FAILED` | System | state change |
| `ASSIGNMENT_EXPIRED` | System | state change |

# Requirements traceability — “Orqland – Order Management Module Requirements”

Every requirement in the document, where it is implemented, and how it was verified.

**Legend**
✅ **Done & tested** — covered by automated tests (unit or integration against PostgreSQL) and/or driven end-to-end in a real browser.
✅ **Done** — implemented and checked visually / by type-check.
🔌 **Hook ready** — the document says this must be agreed with OpenPurpl first (§11); the module exposes a clean integration point and does not ship a third-party integration.

**Verification environment note:** the workflow engine, all services, SQL, migrations and seed were executed and tested against PostgreSQL 16; the full UI was bundled and driven in Chromium against those real services (screenshots in `docs/screenshots`). The build sandbox had no access to the npm registry, so the final `nest build` / `next build` with installed packages has to be run once on a normal machine (`docker compose up --build` or `npm install`). All source was type-checked against its own types.

---

## §1 Overall project

| Requirement | Status | Where |
|---|---|---|
| Manage the complete order and booking lifecycle for products and services | ✅ tested | `backend/src/domain/engine.ts`, `workflows.ts` |
| Acceptance, preparation, fulfilment, delivery/service completion, cancellations, payment tracking, COD reconciliation | ✅ tested | engine actions + `settlements` |
| Frontend Next.js + React + TypeScript | ✅ | `frontend/` (Next.js 15, React 19, TS strict) |
| Backend NestJS | ✅ | `backend/src` (NestJS 10) |
| Database PostgreSQL | ✅ tested | `backend/migrations` |
| Built independently, integration requirements documented | ✅ | sample data; [INTEGRATION_GUIDE.md](INTEGRATION_GUIDE.md) |
| Figma as reference; improve usability, responsiveness, navigation, consistency while keeping Orqland identity | ✅ | see §8 below |

## §2A Product fulfilment

| Requirement | Status | Implementation |
|---|---|---|
| Workflow chosen from the fulfilment option configured on the listing | ✅ tested | `listings.fulfilment_types`, `WORKFLOWS` config per type; creation validates the type is offered |
| **Delivery to Customer** — accept/reject | ✅ tested | `ACCEPT`, `ACCEPT_AND_START_PREP`, `REJECT` |
| preparation / processing | ✅ tested | `START_PREPARATION`, prep countdown, `ADD_PREP_TIME`, `MARK_READY` |
| agent assigned manually or automatically once ready | ✅ tested | `ASSIGN_AGENT`, `AUTO_ASSIGN_AGENT` (also allowed during preparation, as in the Figma) |
| agent accepts, picks up, starts delivery | ✅ tested | `ACCEPT_DELIVERY`, `CONFIRM_PICKUP`, `START_DELIVERY` |
| progress tracked, agent records outcome | ✅ tested | fulfilment statuses + timeline; `MARK_DELIVERED` / `MARK_DELIVERY_FAILED` |
| COD collection and cash handover tracked separately | ✅ tested | `cod_status`, `cod_collections`, `cash_handovers` |
| **Scheduled Delivery** — customer selects date/time slot | ✅ tested | delivery-window slots, capacity-checked reservation |
| accept/reject; slot recorded | ✅ tested | `schedule.slotId/start/end` |
| prep & assignment managed by scheduled time | ✅ | Upcoming tab sorted by slot; *Start Preparation* from `SCHEDULED` |
| reschedule updates schedule & notifies users | ✅ tested | `RESCHEDULE`, customer request → `APPROVE_RESCHEDULE_REQUEST`; customer/agent/provider notifications |
| **Take Away** — accept, prep, extra prep time | ✅ tested | `ADD_PREP_TIME` (dialog + one-tap “+5 min”) |
| customer notified when ready | ✅ tested | `MARK_READY` → “Ready for pickup” customer notification |
| authorised staff confirms handover; no agent | ✅ tested | `CONFIRM_PICKUP_HANDOVER`; no agent actions offered for this type |
| **Schedule Take Away** — pickup slot, scheduled prep, ready, collected in slot, confirmation recorded | ✅ tested | pickup-window slots; same handover flow |
| **Dine In** — accept, prep, ready-to-serve, staff confirms served, payment per method | ✅ tested | `MARK_READY` (“Mark Ready to Serve”), `CONFIRM_SERVED` with optional cash collected at counter |

## §2B Service fulfilment

| Requirement | Status | Implementation |
|---|---|---|
| **At Your Location** — booking, availability & capacity check | ✅ tested | service slots with capacity (e.g. 2 chairs) |
| admin accepts or auto-confirms depending on booking mode | ✅ tested | `listings.auto_confirm` → `AUTO_CONFIRM` audit event; otherwise review |
| scheduled → in progress → completed; attendance/completion recorded | ✅ tested | `MARK_ATTENDED` → `START_SERVICE` → `MARK_SERVICE_COMPLETED` / `CONFIRM_SERVICE_COMPLETION` |
| **At Customer's Location** — admin accepts and confirms time | ✅ tested | `ACCEPT` → `AWAITING_SCHEDULE` → `CONFIRM_SCHEDULE` (time + provider) |
| provider/team travels; in progress; completed | ✅ tested | `START_TRAVEL` → `START_SERVICE` → completed |
| failed visits, rescheduling, cancellations | ✅ tested | `REPORT_CUSTOMER_UNAVAILABLE`, `MARK_SERVICE_FAILED`, `RESCHEDULE`, `CANCEL` |
| **Event Service** — event date, time, location, requirements recorded | ✅ tested | `event_details` (venue, guests, occasion, requirements) + scheduled time |
| admin reviews and confirms | ✅ tested | Events are *always* reviewed (`alwaysReview`) and need `CONFIRM_SCHEDULE` |
| scheduled → in progress → completion | ✅ tested | |
| **Workshop** — session dates, slots, capacity, remaining seats | ✅ tested | workshop sessions; seats = quantity; remaining shown on schedule page |
| bookings never exceed capacity | ✅ tested | atomic reservation + DB `CHECK (reserved <= capacity)`; concurrency test (5 requests, 3 seats → exactly 3) |
| admin views attendees, manages cancellations/rescheduling | ✅ tested | slot drawer attendee list; order-level cancel/reschedule |
| workshop marked completed after the session | ✅ tested | **Mark session completed** (attendees completed, absentees no-show) |
| **Customer Visit / Consulting** — availability and conflict prevention | ✅ tested | 30-min slots + provider no-overlap EXCLUDE constraint (test: conflict refused) |
| admin or provider confirms | ✅ tested | `ACCEPT` (admin) or `CONFIRM_APPOINTMENT` (provider) |
| in progress, completed; rescheduling, cancellation, missed appointments | ✅ tested | `NO_SHOW` flow → reschedule/cancel |
| **Online** — slot or instant booking; booking time and meeting details recorded | ✅ tested | instant listing starts now (capacity-checked); `SET_MEETING_DETAILS` (link + instructions) |
| admin/provider confirms; in progress; completed | ✅ tested | |
| failed sessions, cancellations, rescheduling | ✅ tested | “Mark Session Failed”, cancel, reschedule |

## §3 Booking modes and availability

| Requirement | Status | Implementation |
|---|---|---|
| Instant booking — validates availability & capacity | ✅ tested | stock (products), workspace open, listing `instant_capacity` for overlapping instant bookings (services) |
| auto-confirm or send to admin per listing configuration | ✅ tested | `auto_confirm` |
| prevent duplicate or invalid bookings | ✅ tested | `Idempotency-Key`, unique customer+slot, provider exclusion constraint, request validation |
| Slot-based — select date/time, check capacity/availability/existing bookings | ✅ tested | `GET /schedule/slots?available=true`, slot picker shows “N left” |
| slot reserved/confirmed per rules | ✅ tested | reservation at booking; released on cancel/reject; moved on reschedule |
| admin manages schedules, capacity, rescheduling | ✅ tested | Availability & capacity page: add slot, change capacity (never below bookings), close/reopen, reschedule |
| prevent double-booking and overbooking | ✅ tested | DB constraints + concurrency tests |
| rules apply to services, workshops, delivery slots and pickup slots | ✅ | four slot kinds |

## §4 Standard lifecycle

| Stage | Status | Implementation |
|---|---|---|
| 1 Received — shown in Workspace Admin dashboard | ✅ tested | “New entries” lane + New card/tab |
| 2 Review — accept / reject / request clarification | ✅ tested | `ACCEPT`, `REJECT`, `REQUEST_CLARIFICATION` (+ customer reply) |
| 3 Confirmed — with scheduled time | ✅ | |
| 4 Preparation or Scheduled | ✅ | |
| 5 Ready / Assigned (agent or provider/session) | ✅ | |
| 6 In Progress | ✅ | |
| 7 Fulfilment — delivery, collection, serving, attendance, completion | ✅ tested | |
| 8 Payment update incl. COD | ✅ tested | order completes only when paid; COD collection recorded |
| 9 Completed | ✅ tested | derived automatically |
| Only relevant stages and actions shown | ✅ tested | per-type stepper (`stagesFor`) and per-type/status/role actions |

## §5 Order management dashboard

| Requirement | Status | Implementation |
|---|---|---|
| Summary cards: new, confirmed, in-progress, completed, cancelled, exception | ✅ tested | six clickable cards (+ the Figma revenue card) — counts verified equal to list totals |
| Separate filters for products, services and fulfilment types | ✅ | Products/Services toggle + fulfilment type select |
| Search by order ID, customer, date and status | ✅ tested | search box (ID, name, phone, item), date (placed or scheduled), status cards/tabs |
| Details, items/service, quantities, amount, fulfilment method, schedule, payment status | ✅ | cards, table view, detail drawer/page |
| Delivery assignment and tracking | ✅ | Delivery board + Track Delivery panel |
| Booking schedules and capacity for services and scheduled fulfilment | ✅ | Availability & capacity page; slot capacity on booking detail |
| Visibility into failed fulfilments, cancellations, payment issues, outstanding COD | ✅ tested | Exceptions card/tab with reason badges; COD settlement page; revenue card shows cash with agents |

## §6 Required buttons

All buttons are returned by the API per order and rendered only when valid for the fulfilment type, status and role ([ACTION_MATRIX.md](ACTION_MATRIX.md)).

**Workspace Admin**

| Button | Status | Code / location |
|---|---|---|
| View Details | ✅ | card/row click → detail drawer; “Open full page” |
| Accept Order / Confirm Booking | ✅ tested | `ACCEPT` (label adapts) |
| Reject Order / Reject Booking | ✅ tested | `REJECT` |
| Cancel Order / Cancel Booking | ✅ tested | `CANCEL` |
| Confirm Cancellation | ✅ tested | `CONFIRM_CANCELLATION` |
| Start Preparation | ✅ tested | `START_PREPARATION` |
| Add Extra Preparation Time | ✅ tested | `ADD_PREP_TIME` (+ “+5 min” quick button) |
| Mark Ready | ✅ tested | `MARK_READY` |
| Confirm Schedule | ✅ tested | `CONFIRM_SCHEDULE` |
| Reschedule | ✅ tested | `RESCHEDULE` (slot picker or custom time) |
| View Availability | ✅ | `VIEW_AVAILABILITY` → schedule page for that listing/day |
| Manage Capacity | ✅ tested | `MANAGE_CAPACITY` → slot; capacity dialog |
| Assign Delivery Agent | ✅ tested | `ASSIGN_AGENT` |
| Auto-Assign Agent | ✅ tested | `AUTO_ASSIGN_AGENT` |
| Reassign Agent | ✅ tested | `REASSIGN_AGENT` |
| Track Delivery | ✅ | `TRACK_DELIVERY` → delivery & tracking panel |
| Confirm Pickup / Handover | ✅ tested | `CONFIRM_PICKUP_HANDOVER` |
| Confirm Delivered | ✅ | `CONFIRM_DELIVERED` |
| Confirm Served | ✅ tested | `CONFIRM_SERVED` |
| Confirm Service Completion | ✅ tested | `CONFIRM_SERVICE_COMPLETION` |
| Approve Return | ✅ tested | `APPROVE_RETURN` (failed delivery or customer return) |
| View Payment Details | ✅ | `VIEW_PAYMENT_DETAILS` → payment section (attempts, cash collections, refund) |
| Record COD Collected | ✅ tested | `RECORD_COD_COLLECTED` |
| View Pending Settlements | ✅ | COD settlement page |
| Confirm Cash Received | ✅ tested | settlements → confirm |
| Record Discrepancy | ✅ tested | settlements → discrepancy |
| Resolve Discrepancy | ✅ tested | settlements → resolve |

**Delivery Agent** (mobile-first app at `/agent`)

| Button | Status | Code |
|---|---|---|
| View Assigned Orders | ✅ tested | Offers / Active / History tabs |
| Accept Delivery / Reject Delivery | ✅ tested | `ACCEPT_DELIVERY`, `REJECT_DELIVERY` (reason) with live expiry countdown |
| Navigate to Pickup | ✅ | `NAVIGATE_TO_PICKUP` (Google Maps directions) |
| Confirm Pickup / Start Delivery | ✅ tested | `CONFIRM_PICKUP`, `START_DELIVERY` |
| Track Delivery | ✅ | `TRACK_DELIVERY`, plus `NAVIGATE_TO_CUSTOMER` |
| Contact Customer | ✅ | `CONTACT_CUSTOMER` (tel: link) |
| Mark Delivered / Mark Delivery Failed | ✅ tested | `MARK_DELIVERED` (with cash), `MARK_DELIVERY_FAILED` (reason, notes, evidence) |
| Record COD Collected | ✅ tested | `RECORD_COD_COLLECTED` |
| Return to Workspace | ✅ tested | `RETURN_TO_WORKSPACE` |
| Submit Cash Handover | ✅ tested | Cash tab |

**Service Provider / Workspace Staff** (mobile-first app at `/provider`)

| Button | Status | Code |
|---|---|---|
| View Assigned Bookings | ✅ tested | Today / Upcoming / To do / Past |
| Confirm Appointment | ✅ tested | `CONFIRM_APPOINTMENT` |
| Start Service | ✅ tested | `START_SERVICE` |
| Mark Customer Attended | ✅ tested | `MARK_ATTENDED` |
| Mark Service Completed | ✅ tested | `MARK_SERVICE_COMPLETED` |
| Report Customer Unavailable | ✅ tested | `REPORT_CUSTOMER_UNAVAILABLE` |
| Request Rescheduling | ✅ tested | `REQUEST_RESCHEDULING` → admin approves/declines |

## §7 Exception handling

| Requirement | Status | Implementation |
|---|---|---|
| Reason required for rejection; cancellation reasons recorded | ✅ tested | engine validation + DB `CHECK` |
| Cancellation rules by status | ✅ tested | see [STATUS_DEFINITIONS.md §6](STATUS_DEFINITIONS.md#6-cancellation--rejection-rules-7) |
| Cancelled/rejected orders cannot progress | ✅ tested | engine guards + DB trigger |
| Refund status recorded separately when paid | ✅ tested | `refund_status = PENDING` automatically; `UPDATE_REFUND_STATUS` |
| Notify users and retain history | ✅ tested | notifications + `audit_logs` |
| Agent rejection reason recorded, order back to unassigned queue | ✅ tested | |
| Manual or automatic reassignment | ✅ tested | `REASSIGN_AGENT`, auto re-offer |
| Expire unaccepted assignments after a configurable period | ✅ tested | `assignmentExpirySeconds`; background sweep + lazy expiry |
| Restrict reassignment after pickup to authorised actions | ✅ tested | admin only, reason required, audited |
| Failed delivery: reason + notes/evidence | ✅ tested | |
| Admin can retry, reschedule, reassign, approve return or cancel | ✅ tested | all five offered on `DELIVERY_FAILED` |
| Return-to-workspace confirmation recorded | ✅ tested | `RETURN_TO_WORKSPACE` (agent) + `CONFIRM_RETURN_RECEIVED` (admin) |
| Service failure: missed appointments, provider unavailability, inability to deliver | ✅ tested | `NO_SHOW`, `PROVIDER_UNAVAILABLE`, `SERVICE_FAILED` |
| Authorised rescheduling, reassignment or cancellation; availability updated; customer notified | ✅ tested | slot released/re-reserved; notifications |
| Payment kept pending/failed per verified information | ✅ tested | only webhook changes online payment status |
| Payment retry | ✅ tested | `RETRY_PAYMENT` creates a new attempt |
| No duplicate successful charges; never paid without confirmation | ✅ tested | unique success index, idempotent webhook, no manual “mark paid” for online |
| Agent records collected amount and submits handover | ✅ tested | |
| Admin verifies and confirms amount | ✅ tested | |
| Discrepancies recorded; settlement pending until resolved | ✅ tested | |
| Outstanding cash tracked by agent and by order | ✅ tested | settlements page tables |

## §8 UI/UX improvements

| Requirement | Status | What was done |
|---|---|---|
| Figma as baseline, improved | ✅ | Kept the split order card, black destination block, prep countdown ring, gradient revenue card, black primary / green accept / red decline buttons, blue “View all/Accept all”. Improved: sentence-case labels, consistent spacing/type scale (Inter + Inter Tight), status pills with one colour system, contextual buttons, request call-outs, exception badges |
| Responsive desktop, tablet, mobile | ✅ tested | checked at 390, 768, 1024, 1440 px with no horizontal scrolling; collapsible sidebar; mobile apps for agents/providers; bottom sheets for dialogs on phones |
| Clear navigation, spacing, typography, icons, hierarchy | ✅ | sidebar with counts, top bar with notifications & workspace |
| Better tables, search, filtering, detail views, status indicators | ✅ | cards/table toggle, debounced search, filters with clear, detail drawer + full page, 4-status panel, stepper |
| Confirmation dialogs for sensitive actions | ✅ tested | reject, cancel, reassign after pickup, failed delivery, delivered, COD, refunds, returns, discrepancy |
| Loading, empty, success and error states | ✅ | skeletons, contextual empty states, toasts that echo the action, inline errors with retry |
| Easy-to-understand timelines | ✅ | stepper per fulfilment type + activity log with actor, role, reason and time |
| Only relevant buttons per order, type and role | ✅ tested | server-driven `actions` |
| Clearer delivery tracking and COD settlement | ✅ | Delivery board (4 lanes + agent roster, offer countdowns); COD settlement page (totals, to-verify cards, by agent, by order, still to collect, history) |
| Easy Workspace Admin and Delivery Agent interfaces | ✅ tested | see screenshots |
| Accessibility | ✅ | keyboard focus rings, aria labels/roles, reduced-motion support, colour + text for every status |

## §9 Technical requirements

| Requirement | Status | Implementation |
|---|---|---|
| Next.js, React, TypeScript frontend | ✅ | |
| NestJS + PostgreSQL APIs | ✅ | |
| Built separately with sample data | ✅ | `seeds/sample_data.sql` (38 orders across every state) |
| Document API contracts, data structures, status definitions, migrations, integration | ✅ | [API.md](API.md), Swagger, [DATA_MODEL.md](DATA_MODEL.md), [STATUS_DEFINITIONS.md](STATUS_DEFINITIONS.md), [INTEGRATION_GUIDE.md](INTEGRATION_GUIDE.md) |
| Role-based access control | ✅ tested | guard + `@Roles` + engine per-action roles + row-level scoping for agents/providers |
| Backend validation | ✅ tested | class-validator DTOs + engine field validation + DB constraints |
| Error handling | ✅ tested | consistent error JSON with stable codes; DB constraint errors translated to friendly 409s |
| Audit logs: timestamp, user, reason for status changes | ✅ tested | `audit_logs` with from/to state |
| Separate order, fulfilment, payment and COD settlement status | ✅ tested | four columns (+ refund) |
| Capacity validation, duplicate-request protection, safe transitions | ✅ tested | constraints, idempotency keys, row locks, optimistic `version`, terminal-state trigger |
| Automated tests | ✅ | 27 unit + 23 integration tests, all passing |
| Setup instructions, API documentation, deployment guidance | ✅ | [README](../README.md), [DEPLOYMENT.md](DEPLOYMENT.md), Swagger at `/api/docs` |

## §11 Deliverables

| Deliverable | Status |
|---|---|
| Complete module source code | ✅ `backend/`, `frontend/` |
| Workspace Admin, Delivery Agent and Service Provider interfaces | ✅ |
| Improved responsive UI based on the Figma | ✅ |
| Backend APIs and database schema/migrations | ✅ |
| Product and service fulfilment workflows | ✅ (all 11) |
| Exception handling and payment/COD management | ✅ |
| Automated tests and a working demonstration | ✅ tests; demo via `docker compose up` + customer simulator |
| API documentation, setup instructions, integration guide | ✅ |
| Live GPS tracking | 🔌 `POST /agent/location` + last-position display; distance auto-assign slot in `AssignmentService` |
| External notification providers | 🔌 `NotificationChannel` interface; in-app notifications working |
| Payment gateway integration | 🔌 webhook + `PaymentsService.handleEvent`; sample provider |
| Refunds | 🔌 refund status tracked; processing via gateway to be agreed |
| Customer-facing UI changes | 🔌 customer actions exist in the API; demo uses the simulator |

---

## Additions beyond the written document (from the Figma or needed for a complete flow)

* **Accept & Start Prep** and **Accept all** (Figma “New entries” lane).
* Customer **reschedule request → Accept/Decline** (Figma “Buyer requested for a re-schedule”), **Decline Cancellation**, **Decline Return**.
* Customer **return request → Approve Return → Confirm Return Pickup → refund pending** (Figma “Support” section).
* **Request Clarification** with customer reply (document §4 stage 2).
* **Assign/Reassign Provider**, **Report Provider Unavailable**, **Add Meeting Details**, **Start Travel**, **Retry Payment**, **Update Refund Status**, **Confirm Return Received**.
* Agent **on/off duty**, in-app **notifications** for every role, **customer simulator** for the demo.

## Items in the Figma that need a decision

* **Invoice upload** on completed orders (Figma “Completed” card) is not in the written requirements, so it was not built. It is a small addition (file storage + one action) if OpenPurpl wants it.
* The Figma summary cards (revenue / ongoing / completed) differ from the document's list (new / confirmed / in progress / completed / cancelled / exception). Both are shown: the revenue card plus the six status cards.

## Questions to confirm with OpenPurpl

1. Auto-assign rule: least-busy agent is implemented; switch to nearest agent once GPS is agreed?
2. Offer expiry default is 3 minutes and auto re-offer is on — confirm the values per workspace.
3. Customer cancellation policy: immediate before acceptance, request afterwards, not allowed after dispatch — confirm, and whether cancellation fees apply.
4. Return window after delivery (currently no time limit).
5. Delivery fee and discounts: fields exist (`delivery_fee_paise`, `discount_paise`) but pricing rules come from the platform.
6. Which notification channels (SMS / WhatsApp / push / email) and templates for customers.
7. Payment gateway choice and refund processing.
8. Invoice upload (see above).

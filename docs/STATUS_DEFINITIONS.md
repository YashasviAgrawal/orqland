# Status definitions & workflows

The module keeps **order status, fulfilment status, payment status and COD settlement status separate** (requirement §9), plus a separate **refund status** (§7). The single source of truth for transitions is [`backend/src/domain/engine.ts`](../backend/src/domain/engine.ts); the tables below describe it.

## 1. Order status — the business lifecycle

| Status | Meaning | Lifecycle stage (§4) |
|---|---|---|
| `PENDING_REVIEW` | Received, waiting for the admin (or provider) to accept | 1 Received · 2 Review |
| `CLARIFICATION_REQUESTED` | Admin asked the customer a question; back to review when they reply | 2 Review |
| `CONFIRMED` | Accepted; waiting to start (prep, scheduled time, schedule confirmation) | 3 Confirmed |
| `IN_PROGRESS` | Preparation, delivery, travel or service under way — or fulfilled but payment still pending | 4–8 |
| `COMPLETED` | Fulfilled **and** paid | 9 Completed |
| `CANCELLED` | Cancelled by workspace or at the customer's request | terminal |
| `REJECTED` | Declined during review (reason mandatory) | terminal |

Order status is **derived** after every action from fulfilment + payment, so the statuses can never contradict each other. `CANCELLED`, `REJECTED` and `COMPLETED` are terminal: the API refuses progression and a database trigger blocks any write that would move them back.

## 2. Fulfilment status — operational progress

| Status | Used by | Meaning |
|---|---|---|
| `NOT_STARTED` | all | Under review |
| `AWAITING_PREPARATION` | instant products | Accepted, prep not started ("Waiting for preparation") |
| `AWAITING_SCHEDULE` | Event, At customer's location | Accepted, admin still has to confirm the time |
| `SCHEDULED` | scheduled products, services | Waiting for the booked slot |
| `PREPARING` | products | Prep timer running (+ extra prep time) |
| `READY` | products | Packed / ready for agent pickup, customer collection or serving |
| `PICKED_UP` → `OUT_FOR_DELIVERY` → `DELIVERED` | delivery types | Agent progress |
| `DELIVERY_FAILED` | delivery types | Agent reported failure (reason, notes, evidence) |
| `RETURNING` → `RETURNED_TO_WORKSPACE` | delivery types | Parcel coming back; admin confirms receipt |
| `COLLECTED` | take-away | Customer collected, staff confirmed handover |
| `SERVED` | dine-in | Served at the table |
| `PROVIDER_EN_ROUTE` | at customer's location, event | Provider travelling |
| `CHECKED_IN` | at our location, workshop, consulting, online | Customer attended |
| `IN_SERVICE` → `SERVICE_COMPLETED` | services | Service execution |
| `NO_SHOW` · `PROVIDER_UNAVAILABLE` · `SERVICE_FAILED` | services | Service exceptions |
| `RETURN_APPROVED` → `RETURN_RECEIVED` | delivered / collected products | Customer return after fulfilment |
| `CANCELLED` | all | Fulfilment stopped |

## 3. Payment, COD settlement & refund

| Payment status | Meaning |
|---|---|
| `PENDING` | No verified payment yet (online awaiting gateway, or cash to collect) |
| `PAID` | Verified: gateway webhook succeeded, or cash recorded in full |
| `FAILED` | Gateway reported failure — admin can **Retry Payment** (new attempt) |

Online payments are **only** marked paid from a verified provider event (`POST /payments/webhook`); there is no admin button to mark them paid. A second successful charge for the same order is blocked by a unique index; replayed webhooks are idempotent.

| COD status | Meaning |
|---|---|
| `NOT_APPLICABLE` | Not a cash order |
| `PENDING_COLLECTION` | Cash to be collected on fulfilment |
| `COLLECTED` | Cash is with the delivery agent (or short-collected) |
| `HANDOVER_SUBMITTED` | Agent handed it over; admin to verify |
| `DISCREPANCY` | Counted amount differs — settlement stays pending |
| `SETTLED` | Verified (or collected at the counter) |

| Refund status | Meaning |
|---|---|
| `NOT_APPLICABLE` · `PENDING` · `REFUNDED` · `FAILED` | Set to `PENDING` automatically when a paid order is cancelled/rejected or a return is received. Refund processing itself is outside the module (§11); admins record the outcome with **Update Refund Status**. |

## 4. Workflows per fulfilment type (§2)

`→` is the normal path; *italic* actions are available at that point.

| Type | Path |
|---|---|
| Delivery to Customer | Review → *Accept / Accept & Start Prep* → Preparing (*+ prep time*) → Ready → *Assign / Auto-assign* agent → agent *Accepts* → *Confirm Pickup* → *Start Delivery* → *Mark Delivered* (+ COD) → Completed |
| Scheduled Delivery | Review → Scheduled (slot) → *Start Preparation* → … same as delivery. *Reschedule* moves the slot reservation |
| Take Away | Review → Preparing → *Mark Ready for Pickup* (customer notified) → *Confirm Pickup / Handover* (+ cash at counter) |
| Scheduled Take Away | Review → Scheduled (pickup slot) → Preparing → Ready → Handover |
| Dine In | Review → Preparing → *Mark Ready to Serve* → *Confirm Served* (+ cash) |
| At Your Location | Booking (auto-confirm or review) → Scheduled → *Mark Customer Attended* → *Start Service* → *Mark Service Completed* |
| At Customer's Location | Review → Awaiting schedule → *Confirm Schedule* (+ provider) → *Start Travel* → *Start Service* → Completed; failed visit / no-show / reschedule / cancel supported |
| Event Service | **Always reviewed** → *Confirm Schedule* → *Start Travel* → *Start Service* → Completed. Event date, venue, guests, requirements recorded |
| Workshop | Seats booked against session capacity → Scheduled → *Mark Attended* → completion; **Mark session completed** on the schedule page completes attendees and marks absentees as no-show |
| Customer Visit / Consulting | Provider or admin *Confirms* → Scheduled → Attended → In service → Completed; provider double-booking blocked; no-show supported |
| Online | Instant (starts now, capacity-checked) or slot → *Add Meeting Details* → Attended → In service → Completed; *Mark Session Failed* supported |

## 5. Booking modes & availability (§3)

* **Instant** — products: stock + workspace open; services: concurrent capacity of the listing (`instantCapacity`) checked for the time window. Listing `autoConfirm` decides automatic confirmation vs admin review.
* **Slot-based** — the customer picks a slot; the slot is reserved atomically (`reserved + seats ≤ capacity`, enforced by a `CHECK` constraint), so concurrent requests can never overbook. Admin can add slots, change capacity (never below current bookings), close/reopen slots.
* Duplicate bookings: one active booking per customer per slot (unique index) + `Idempotency-Key`.
* Provider conflicts: for consulting, online and at-customer bookings a PostgreSQL exclusion constraint prevents overlapping bookings for the same provider.

## 6. Cancellation & rejection rules (§7)

| Situation | Rule |
|---|---|
| Under review | Admin **Rejects** (reason required). Customer cancellation is immediate. |
| Confirmed / preparing / ready / scheduled | Admin **Cancels** (reason required). Customer requests are queued for **Confirm / Decline Cancellation**. |
| Picked up, out for delivery, provider en route, in service | Cannot be cancelled — resolve first (mark failed, return). |
| Delivery failed | Cancel is allowed; the parcel goes to `RETURNING` and the agent still sees **Return to Workspace**. |
| Effects | Slot capacity released, stock restored (if not yet prepared), active assignment cancelled, refund `PENDING` if paid, open requests declined, customer/agent/provider notified, full history retained. |

## 7. Delivery assignment (§7)

`OFFERED` → `ACCEPTED` → `COMPLETED`, or `REJECTED` (reason required) / `EXPIRED` (not accepted within `assignmentExpirySeconds`, default 180 s) / `CANCELLED` (reassigned or order cancelled). After rejection or expiry the order returns to the unassigned queue and — if `autoReassignOnReject` is on — is offered to the next available agent (fewest active deliveries, excluding agents who already declined). Reassignment after pickup is restricted to workspace admins, needs a reason and is audited.

## 8. Exceptions shown on the dashboard

`DELIVERY_FAILED`, `RETURNING`, `RETURN_TO_CONFIRM`, `RETURNED_TO_WORKSPACE`, `NO_SHOW`, `PROVIDER_UNAVAILABLE`, `SERVICE_FAILED`, `CANCELLATION_REQUESTED`, `RESCHEDULE_REQUESTED`, `RETURN_REQUESTED`, `RETURN_IN_PROGRESS`, `PAYMENT_FAILED`, `PAYMENT_PENDING` (fulfilled but unpaid), `COD_SHORT_COLLECTED`, `COD_DISCREPANCY`, `REFUND_PENDING`, `REFUND_FAILED`. The `orders.exception` column is maintained by a database trigger, so it is correct whichever service writes the order.

## 9. Cash flow (COD)

```
Agent: Mark Delivered (+ amount) / Record COD Collected ──► cod = COLLECTED, payment = PAID (if full)
Agent: Submit Cash Handover (declared amount, note if different) ──► HANDOVER_SUBMITTED
Admin: Confirm Cash Received (must match) ──────────────────────► SETTLED
Admin: Record Discrepancy (counted amount + reason) ─────────────► DISCREPANCY (pending)
Admin: Resolve Discrepancy (agent paid / recount / deduct / write-off + note) ─► SETTLED
```
Outstanding cash is tracked per agent (in hand · to verify · disputed) and per order.

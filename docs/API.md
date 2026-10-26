# API reference

Base URL: `http://localhost:4000/api/v1` · Interactive docs (Swagger/OpenAPI): `http://localhost:4000/api/docs`

## Conventions

| Topic | Contract |
|---|---|
| Auth | `Authorization: Bearer <token>`. The standalone module issues demo tokens (`POST /auth/demo-login`); in Orqland the platform's identity provider is used instead (see [Integration guide](INTEGRATION_GUIDE.md#1-authentication)). |
| Roles | `WORKSPACE_ADMIN`, `DELIVERY_AGENT`, `SERVICE_PROVIDER`. Every endpoint is role-restricted; reads are scoped (agents see only orders assigned to them, providers only their bookings). |
| Money | Integer **paise** (`totalPaise: 99800` = ₹998.00). Inputs typed in rupees (`amount: 998`) are converted by the API. |
| Time | ISO-8601 UTC strings. Business days are India Standard Time. |
| Errors | `{ statusCode, code, message, details? }` — `400 VALIDATION`, `401`, `403 FORBIDDEN`, `404 NOT_FOUND`, `409` business conflicts (`CAPACITY_EXCEEDED`, `DUPLICATE_BOOKING`, `PROVIDER_CONFLICT`, `STALE_ORDER`, `OFFER_EXPIRED`, `OUT_OF_STOCK`, `NO_AGENT_AVAILABLE`, `ALREADY_PAID` …), `422 ACTION_NOT_ALLOWED` for an action that is not valid in the order's current status. |
| Duplicate-request protection | Send `Idempotency-Key: <uuid>` on `POST /orders`, `POST /orders/:id/actions` and `POST /simulator/orders`. A retry with the same key returns the first result instead of acting twice. |
| Concurrency | Every order has a `version`. Pass `expectedVersion` with an action; if someone changed the order meanwhile the API answers `409 STALE_ORDER`. Actions on the same order are also serialised with a row lock. |

## The order object

Returned by every list and detail endpoint (detail adds `timeline`, `payments`, `codCollections`, `assignments`, `requests`, `workflow`).

```jsonc
{
  "id": "uuid", "code": "OQ-100231", "version": 7,
  "kind": "PRODUCT",                       // PRODUCT | SERVICE
  "fulfilmentType": "DELIVERY",            // 11 types, see STATUS_DEFINITIONS.md
  "fulfilmentLabel": "Delivery to Customer",
  "bookingMode": "INSTANT",                // INSTANT | SLOT
  "status": {                              // four separate statuses (+ refund)
    "order": "IN_PROGRESS", "fulfilment": "OUT_FOR_DELIVERY",
    "payment": "PENDING", "cod": "PENDING_COLLECTION", "refund": "NOT_APPLICABLE"
  },
  "statusLabel": { "order": "In progress", "fulfilment": "On the way" },
  "exception": null, "exceptionLabel": null,          // e.g. DELIVERY_FAILED, CANCELLATION_REQUESTED
  "customer": { "id": "…", "name": "Prem Kumar S", "phone": "+91 96453 82418", "email": null },
  "items": [{ "listingId": "…", "name": "Handmade Ceramic Mug", "quantity": 1, "unitPricePaise": 99800, "totalPaise": 99800, "tags": ["Heat-resistant"] }],
  "amounts": { "subtotalPaise": 99800, "deliveryFeePaise": 0, "discountPaise": 0, "totalPaise": 99800, "codCollectedPaise": 0 },
  "paymentMethod": "CASH",
  "schedule": { "start": null, "end": null, "slotId": null, "slotTitle": null, "capacity": null, "reserved": null, "seats": 1 },
  "delivery": { "address": "Park Street, 2nd Block…", "lat": null, "lng": null, "distanceKm": 8.6 },
  "note": "Please place cushioning material on all sides.",
  "tableNumber": null, "eventDetails": null,
  "provider": null,                         // services: { id, name, phone, confirmedAt }
  "meeting": null,                          // online: { link, notes }
  "prep": { "minutes": 15, "extraMinutes": 5, "startedAt": "…", "dueAt": "…", "readyAt": "…" },
  "assignment": { "agentId": "…", "agentName": "Suresh M", "status": "ACCEPTED", "expiresAt": null, "pickedUpAt": "…" },
  "openRequests": [],                       // pending CANCELLATION | RESCHEDULE | RETURN
  "failure": null,                          // { reason, notes, evidence }
  "stages": [{ "key": "received", "label": "Order received", "state": "done" }, …],
  "actions": [                              // ← the buttons this user may press right now
    {
      "code": "MARK_DELIVERED", "label": "Mark Delivered", "tone": "success", "kind": "mutation",
      "fields": [{ "name": "amount", "label": "Cash collected from customer", "type": "money", "required": false, "defaultValue": 998 }],
      "confirm": { "title": "Mark as delivered?", "body": "Collect ₹998.00 in cash before confirming.", "cta": "Delivered" }
    }
  ]
}
```

`actions` is computed by the workflow engine for the **caller's role, the fulfilment type and the current statuses**. Clients render these and nothing else, so a button can never appear that the API would reject. Field types: `text | textarea | number | money | datetime | select | agent | provider | schedule | url`. A `schedule` value is `{ "slotId": "…" }` or `{ "start": "ISO" }`.

## Endpoints

### Auth & meta
| Method | Path | Who | Purpose |
|---|---|---|---|
| GET | `/health` | public | Liveness + DB check |
| GET | `/meta` | public | Workflows, status labels, exception labels, action catalogue |
| GET | `/auth/demo-users` | public (demo) | Users for the demo sign-in screen |
| POST | `/auth/demo-login` | public (demo) | `{ userId }` → `{ token, user }` |
| GET | `/auth/me` | any | Current user + workspace |

### Orders & bookings (Workspace Admin)
| Method | Path | Purpose |
|---|---|---|
| GET | `/orders` | List. Query: `view` (`all,new,confirmed,in_progress,completed,cancelled,exceptions,processing,ongoing,upcoming`), `kind`, `fulfilmentType` (csv), `status` (csv), `paymentStatus`, `q` (order ID / customer / phone / item), `dateFrom`, `dateTo`, `dateField` (`created`/`scheduled`), `page`, `pageSize` |
| GET | `/orders/summary` | Counts for every card/tab, revenue today vs yesterday, outstanding COD, pending handovers, pending refunds |
| GET | `/orders/:id` | Detail (admins; agents/providers only for their own orders) |
| POST | `/orders/:id/actions` | `{ action, input?, expectedVersion? }` → updated detail. Any role; the engine checks the role |
| POST | `/orders/bulk-accept` | `{ orderIds[], startPreparation? }` — “Accept all” |
| POST | `/orders` | Create an order/booking (checkout integration) — see body below |

`POST /orders` body:
```jsonc
{
  "customerId": "uuid",                       // or "customer": { name, phone, email?, address? }
  "fulfilmentType": "SCHEDULED_TAKEAWAY",
  "items": [{ "listingId": "uuid", "quantity": 2 }],
  "paymentMethod": "UPI",                     // CASH | UPI | CARD | NET_BANKING | WALLET
  "slotId": "uuid",                           // slot-based types
  "scheduledStart": "ISO",                    // EVENT only
  "deliveryAddress": "…", "deliveryLat": 13.0, "deliveryLng": 80.2,
  "note": "…", "tableNumber": "T4",
  "eventDetails": { "venue": "…", "guests": 120, "occasion": "…", "requirements": "…" }
}
```
Validation: listing active and offering the fulfilment type, stock (atomic, never oversold), slot kind/listing/open/future, slot capacity (atomic, never overbooked), instant-booking capacity, provider double-booking (DB exclusion constraint), duplicate booking of the same slot by the same customer, idempotency key. Listings with `autoConfirm` are confirmed immediately; others (and every Event) go to admin review.

### Delivery
| Method | Path | Who | Purpose |
|---|---|---|---|
| GET | `/delivery/board` | Admin | Unassigned queue, pending offers, active deliveries, failed/returns, agent roster |
| GET | `/delivery/agents` | Admin | Agents with on-duty flag and active load |
| GET | `/agent/assignments?scope=offers\|active\|completed` | Agent | Agent's deliveries |
| GET | `/agent/summary` | Agent | Offers, active, delivered today, duty status, cash in hand |
| PATCH | `/agent/availability` | Agent | `{ isAvailable }` — go on/off duty |
| POST | `/agent/location` | Agent | `{ lat, lng }` — integration hook for live GPS (stores last position) |
| GET | `/agent/cash` | Agent | Cash in hand by order + handover history |
| POST | `/agent/cash-handovers` | Agent | `{ declaredAmount, note?, collectionIds? }` — note required if amount differs |

### Services
| Method | Path | Who | Purpose |
|---|---|---|---|
| GET | `/provider/bookings?scope=today\|upcoming\|attention\|past` | Provider | Assigned bookings |
| GET | `/provider/summary` | Provider | Today / upcoming / in progress / completed today |

### Availability & capacity
| Method | Path | Who | Purpose |
|---|---|---|---|
| GET | `/schedule/slots` | Admin, Provider | `from`, `to`, `listingId`, `kind` (csv: `DELIVERY,PICKUP,SERVICE,WORKSHOP_SESSION`), `available=true` |
| GET | `/schedule/slots/:id` | Admin, Provider | Slot + attendees |
| POST | `/schedule/slots` | Admin | `{ kind, listingId?, providerId?, startsAt, endsAt, capacity, title? }` |
| PATCH | `/schedule/slots/:id` | Admin | `{ capacity?, status?: OPEN\|CLOSED, reason? }` — capacity never below bookings |
| POST | `/schedule/slots/:id/complete` | Admin | Workshop session completion (attended → completed, absent → no-show) |
| GET | `/schedule/listings` | Admin, Provider | Listings (sample catalogue) |
| GET | `/schedule/providers` | Admin | Service providers |

### Payments & COD settlement
| Method | Path | Who | Purpose |
|---|---|---|---|
| POST | `/payments/webhook` | Payment provider (`X-Webhook-Secret`) | `{ orderId?, reference, status: SUCCEEDED\|FAILED, reason? }` — idempotent per `reference` |
| GET | `/settlements` | Admin | Totals, outstanding by agent and by order, cash still to collect, handovers to verify |
| GET | `/settlements/handovers?status=` | Admin | Handover history |
| POST | `/settlements/handovers/:id/confirm` | Admin | `{ receivedAmount }` — must equal collected amount |
| POST | `/settlements/handovers/:id/discrepancy` | Admin | `{ receivedAmount, reason }` — settlement stays pending |
| POST | `/settlements/handovers/:id/resolve` | Admin | `{ resolution: AGENT_PAID_DIFFERENCE\|RECOUNT_CORRECTED\|DEDUCTED_FROM_PAYOUT\|WRITTEN_OFF, note }` |

### Notifications
| Method | Path | Purpose |
|---|---|---|
| GET | `/notifications` | In-app notifications for the caller (admins see workspace notifications) |
| POST | `/notifications/:id/read` · `/notifications/read-all` | Mark read |

### Customer simulator (demo only — `ENABLE_SIMULATOR=false` in production)
| Method | Path | Purpose |
|---|---|---|
| GET | `/simulator/catalog` | Listings and customers |
| GET | `/simulator/availability?listingId&fulfilmentType` | Bookable slots |
| POST | `/simulator/orders` | Place an order as a customer (same body as `POST /orders`) |
| GET | `/simulator/orders?customerId=` | Customer's orders with the customer's own actions |
| POST | `/simulator/orders/:id/actions` | `CUSTOMER_REQUEST_CANCELLATION`, `CUSTOMER_REQUEST_RESCHEDULE`, `CUSTOMER_REQUEST_RETURN`, `CUSTOMER_RESPOND_CLARIFICATION` |
| POST | `/simulator/orders/:id/payment` | `{ outcome: SUCCEEDED\|FAILED }` — simulates the gateway webhook |
| GET | `/simulator/customers/:id/notifications` | What the customer would have been notified about |

## Action catalogue

See [ACTION_MATRIX.md](ACTION_MATRIX.md) for every action code and role, and [STATUS_DEFINITIONS.md](STATUS_DEFINITIONS.md) for when each is available.

# Data model & migrations

PostgreSQL 14+ (tested on 16). Migrations live in `backend/migrations/` and are applied in order by `npm run db:migrate` (tracked in `schema_migrations`).

| Migration | Contents |
|---|---|
| `001_init.sql` | All tables, constraints and indexes |
| `002_derived_state.sql` | Trigger that maintains `orders.exception`, `version`, `updated_at` and blocks terminal-status regressions |
| `003_idempotency.sql` | `idempotency_keys` for duplicate-request protection |
| `004_time_helpers.sql` | `ist_today()`, `ist_day_start(date)` — business-day boundaries independent of server timezone |

## Tables

| Table | Purpose | Key rules enforced by the database |
|---|---|---|
| `workspaces` | Business (sample of Orqland workspace) incl. `settings` JSON: `assignmentExpirySeconds`, `autoReassignOnReject`, `autoAssignStrategy` | |
| `users` | Workspace admins, delivery agents, service providers (`is_available` = on duty) | role CHECK |
| `customers` | Customers (sample) | |
| `listings` | Products & services: price, `fulfilment_types[]`, `booking_mode`, `auto_confirm`, `prep_minutes`, `duration_minutes`, `instant_capacity`, `stock`, default provider, `external_ref` (Orqland listing id) | `stock >= 0` → never oversold |
| `slots` | Availability: delivery windows, pickup windows, service slots, workshop sessions — `capacity`, `reserved`, `status` | `reserved BETWEEN 0 AND capacity` → never overbooked |
| `orders` | Orders and bookings: the four statuses + refund, amounts (paise), schedule, delivery, service, exception and audit fields, `version` | status CHECKs; reject/cancel reason required; one active booking per customer per slot; provider no-overlap EXCLUDE constraint; unique idempotency key |
| `order_items` | Line items (name & price snapshot) | |
| `order_requests` | Customer/provider requests: `CANCELLATION`, `RESCHEDULE`, `RETURN` with status and resolution | one pending request per type per order |
| `delivery_assignments` | Offers to agents: `OFFERED/ACCEPTED/REJECTED/EXPIRED/CANCELLED/COMPLETED`, reason, expiry, pickup time, last GPS position (hook) | one active assignment per order |
| `payments` | Payment attempts (online + cash), provider reference | unique provider reference (idempotent webhooks); one `SUCCEEDED` per order (no double charge) |
| `cod_collections` | Each cash collection: agent (or counter), amount, handover, settled | |
| `cash_handovers` | Agent handovers: expected, declared, received, status, discrepancy, resolution | |
| `audit_logs` | Every status change and important event: actor id/role/name, reason, from/to state, data, timestamp | |
| `notifications` | In-app notifications (admin, agent, provider) and customer notifications queued for an external provider | |
| `idempotency_keys` | Stored responses for retried requests | |

## Entity relationships

```
workspaces 1─* users, customers, listings, slots, orders, cash_handovers
orders     1─* order_items, order_requests, delivery_assignments, payments, cod_collections, audit_logs, notifications
orders     *─1 customers, slots (optional), users (provider, optional)
cod_collections *─1 cash_handovers (optional), users (agent, optional)
```

## Sample data

`backend/seeds/sample_data.sql` (`npm run db:seed`) creates the “Sj Softwares” workspace from the Figma, 1 admin, 3 agents (one off duty), 3 providers, 8 customers, 5 products, 6 services, 8 days of availability and **38 orders/bookings covering every fulfilment type and every dashboard state** (new, clarification, scheduled, in preparation, offered, out for delivery, failed delivery, no-show, payment failed, cancel/return/reschedule requests, COD in hand / submitted / disputed, completed, cancelled with refund pending, rejected). Dates are relative to “now”, so the demo always looks current.

# Integration guide — plugging the module into Orqland

The module was built standalone with sample data because the Orqland codebase is confidential (§1, §9). It is deliberately shaped so it can be dropped into the existing NestJS + Next.js + PostgreSQL platform with a small, well-defined set of seams. Everything below lists **what to replace** and **what stays as is**.

## 0. Overview of seams

| Seam | Standalone implementation | Replace with (in Orqland) |
|---|---|---|
| Authentication | `AuthGuard` verifies module-issued JWTs (`/auth/demo-login`) | Orqland's guard / identity provider, mapped to `AuthUser` |
| Workspaces, users, customers, listings | Module tables with sample data | Existing Orqland tables (via views or FK mapping) |
| Order creation | `POST /orders` (+ simulator) | Called by Orqland checkout |
| Payment gateway | Sample provider + `POST /payments/webhook` | Real gateway webhook → `PaymentsService.handleEvent` |
| Notifications | In-app table; customer notifications marked `SKIPPED` | Implement `NotificationChannel` (SMS / WhatsApp / push / email) |
| Live GPS | `POST /agent/location` stores last position | Device/GPS provider → same endpoint or `delivery_assignments.last_*` |
| Auto-assign strategy | Least active deliveries | Distance-based strategy in `AssignmentService` once GPS is available |
| Refunds | Refund status recorded manually | Gateway refund API → `UPDATE_REFUND_STATUS` |

## 1. Authentication

All controllers only depend on the `AuthUser` interface (`backend/src/common/auth/auth.types.ts`):

```ts
interface AuthUser { id: string; role: 'WORKSPACE_ADMIN' | 'DELIVERY_AGENT' | 'SERVICE_PROVIDER'; name: string; workspaceId: string }
```

1. Remove `AuthController` and the demo login (or set `ENABLE_DEMO_LOGIN=false`).
2. Replace the token verification in `AuthGuard.canActivate` with Orqland's (or register Orqland's guard as `APP_GUARD`) and set `req.user` to an `AuthUser`. Map Orqland roles → the three module roles. `@Roles()` and the per-action role checks in the workflow engine keep working unchanged.
3. Permission matrix: `PERMISSIONS` in `auth.types.ts`; per-action roles are listed in [ACTION_MATRIX.md](ACTION_MATRIX.md).

## 2. Mounting the backend

* Copy `backend/src` into the Orqland API (e.g. `src/modules/order-management`) and import `AppModule`'s contents as a feature module (`OrderManagementModule`). It has no global state other than the `DatabaseModule`.
* Database access uses `pg` through `DatabaseService`. If Orqland uses TypeORM/Prisma, keep `DatabaseService` pointing at the same database (it only needs a connection string) — the module's SQL is self-contained.
* Run the four migrations. If Orqland already has `workspaces`, `users`, `customers` or `listings`, either:
  * **Option A (recommended):** keep the module tables and sync them from Orqland (listings carry `external_ref`), or
  * **Option B:** replace them with views over Orqland tables exposing the same column names, and drop the module's table definitions from `001_init.sql`.
* Set `assignmentExpirySeconds`, `autoReassignOnReject` per workspace in `workspaces.settings`.
* The expiry job runs in every API instance; it is safe to run concurrently (each expiry locks its order and re-checks the state).

## 3. Creating orders from Orqland checkout

Call `POST /api/v1/orders` (or `OrderCreationService.create()` in-process) when a customer checks out. Always send an `Idempotency-Key` (e.g. the checkout session id). Responses are the full order object. Validation errors are `400`, availability/capacity/stock/duplicate conflicts are `409` with a stable `code` the checkout can show to the customer.

Customer-initiated changes (cancel, reschedule, return, clarification reply) are engine actions available to the `CUSTOMER` role — in the standalone build they are exposed through `/simulator/orders/:id/actions`. For production, expose an equivalent authenticated customer endpoint that calls `OrderActionsService.execute(customerActor, …)` with codes `CUSTOMER_REQUEST_CANCELLATION`, `CUSTOMER_REQUEST_RESCHEDULE`, `CUSTOMER_REQUEST_RETURN`, `CUSTOMER_RESPOND_CLARIFICATION`, then disable the simulator (`ENABLE_SIMULATOR=false`). Customer-facing UI changes are out of scope (§11).

## 4. Payment gateway

`PaymentsService.handleEvent({ orderId?, reference, status, reason? })` is the only way payment status changes. Point the gateway webhook at `POST /payments/webhook` and replace the shared-secret check in `PaymentsController` with the gateway's signature verification. Retries create a new `payments` attempt; send the customer a payment link from your gateway when `RETRY_PAYMENT` runs (hook: the `CREATE_PAYMENT_ATTEMPT` effect in `OrderActionsService`).

## 5. Notifications

Implement and register a channel:

```ts
class WhatsAppChannel implements NotificationChannel {
  name = 'WHATSAPP';
  supports(n) { return n.audience === 'CUSTOMER'; }
  async send(n) { /* call provider */ }
}
notificationsService.registerChannel(new WhatsAppChannel());
```

Notifications are written in the same transaction as the change and dispatched after commit; a failing provider never blocks an order action.

## 6. Live GPS tracking

Not implemented until agreed (§11). The hooks are ready: `POST /agent/location` stores `last_lat/last_lng/last_location_at` on active assignments, the order detail shows the last position with a map link, and `AssignmentService` is where a distance-based auto-assign strategy plugs in.

## 7. Frontend

`frontend/` is a Next.js 15 App Router app with no UI-library dependency (plain CSS design tokens in `app/globals.css`, inline icon set). To embed in the Orqland web app:

* Copy `src/components/orders`, `src/components/ui`, `src/lib` and the pages under `src/app/admin`, `src/app/agent`, `src/app/provider`.
* Replace `src/lib/api.ts` `getSession()` with Orqland's session/token source; everything else calls `api()`.
* Replace `AdminShell` with Orqland's layout (sidebar + top bar); the pages only need a content container. The sidebar items the platform owns (My Listing, Workspace Management, Analytics, Billing, Access Control) are shown as placeholders.
* Buttons are rendered from the API's `actions` list — no workflow logic lives in the UI, so the frontend stays correct as the workflow evolves.

## 8. Configuration

| Variable | Default | Notes |
|---|---|---|
| `DATABASE_URL` | `postgres://postgres:postgres@localhost:5432/orqland_om` | |
| `PORT` | `4000` | |
| `CORS_ORIGIN` | `http://localhost:3000` | comma-separated |
| `JWT_SECRET`, `JWT_EXPIRES_IN` | dev values | standalone auth only |
| `PAYMENT_WEBHOOK_SECRET` | `dev-webhook-secret` | replace with gateway signature check |
| `ENABLE_SIMULATOR` | `true` | **false in production** |
| `ENABLE_DEMO_LOGIN` | `true` | **false in production** |
| `ASSIGNMENT_EXPIRY_SWEEP_MS` | `15000` | `0` disables the sweep (lazy expiry still applies) |
| `NEXT_PUBLIC_API_URL` (frontend) | `http://localhost:4000/api/v1` | build-time |

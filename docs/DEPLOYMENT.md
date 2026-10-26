# Setup, testing & deployment

## Requirements
Node.js 20+ (22 recommended), PostgreSQL 14+ (16 recommended), npm. Docker optional.

## Quick start with Docker
```bash
docker compose up --build
```
* Web app: http://localhost:3000 — pick a demo user (admin, agent, provider)
* API: http://localhost:4000/api/v1 — Swagger at http://localhost:4000/api/docs
* The `seed` service loads the sample workspace. Re-run it to reset the demo: `docker compose run --rm seed`

## Manual setup
```bash
# database
createdb orqland_om

# API
cd backend
cp .env.example .env            # adjust DATABASE_URL if needed
npm install
npm run db:migrate
npm run db:seed
npm run start:dev               # http://localhost:4000/api/v1

# web
cd ../frontend
cp .env.example .env.local
npm install
npm run dev                     # http://localhost:3000
```

## Tests
```bash
cd backend
npm run test:unit                               # workflow engine — no database needed
createdb orqland_om_test
TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/orqland_om_test npm run test:e2e
```
* **Unit (27 tests)** — every fulfilment type's flow, role restrictions, cancellation rules, payment rules, plus an exhaustive check across all 11 types × every status × every role that the engine never offers an action it would refuse.
* **Integration (26 tests)** — run against a real PostgreSQL database with the sample seed: dashboard counts/filters, role-scoped boards, full delivery + COD + handover + discrepancy flow, concurrent overselling and overbooking attempts, double-accept races, stale versions, offer expiry & auto re-offer, agent rejection, failed delivery → return → reschedule, provider conflicts, no-show/reschedule/requests, events, workshop session completion, payment failure/retry/idempotent webhooks, customer cancellation and returns, bulk accept.
* The integration test resets the test database each run — never point `TEST_DATABASE_URL` at real data.

## Production checklist
* `ENABLE_SIMULATOR=false`, `ENABLE_DEMO_LOGIN=false`, strong `JWT_SECRET` (or Orqland auth), real `PAYMENT_WEBHOOK_SECRET`/signature verification.
* Run `node dist/cli/migrate.js` before starting new versions (the Docker image does this automatically).
* Do **not** run the seed against production.
* Put the API behind HTTPS; set `CORS_ORIGIN` to the web origin.
* Backups: standard PostgreSQL backups; `audit_logs` is append-only and can be archived by date.
* Scaling: the API is stateless; run several instances behind a load balancer. Row locks + DB constraints keep concurrent actions safe; the expiry sweep is safe on every instance.

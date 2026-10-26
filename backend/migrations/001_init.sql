-- Orqland Order Management — initial schema
-- PostgreSQL 14+ (uses gen_random_uuid() and btree_gist)
--
-- Design notes
--  * Order status, fulfilment status, payment status, COD settlement status and refund status are
--    separate columns (requirement §9).
--  * Capacity and double-booking rules are enforced by the database, not only by the API:
--      - slots.reserved can never exceed slots.capacity (CHECK)
--      - a customer cannot hold two active bookings for the same slot (partial UNIQUE)
--      - a provider cannot have overlapping bookings for conflict-sensitive services (EXCLUDE)
--      - an order can have at most one active delivery assignment (partial UNIQUE)
--      - an order can have at most one successful payment (partial UNIQUE)
--      - order creation is idempotent per workspace (UNIQUE idempotency_key)
--  * Money is stored as integer paise.

CREATE EXTENSION IF NOT EXISTS btree_gist;

-- ---------------------------------------------------------------- workspaces & people
CREATE TABLE workspaces (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code            text NOT NULL UNIQUE,              -- e.g. WSID ABC#123456789#
  name            text NOT NULL,
  address         text NOT NULL,
  lat             numeric(9,6),
  lng             numeric(9,6),
  phone           text,
  timezone        text NOT NULL DEFAULT 'Asia/Kolkata',
  is_open         boolean NOT NULL DEFAULT true,
  settings        jsonb NOT NULL DEFAULT '{"assignmentExpirySeconds":180,"autoReassignOnReject":true,"autoAssignStrategy":"LEAST_ACTIVE"}',
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    uuid NOT NULL REFERENCES workspaces(id),
  name            text NOT NULL,
  phone           text,
  email           text,
  role            text NOT NULL CHECK (role IN ('WORKSPACE_ADMIN','SERVICE_PROVIDER','DELIVERY_AGENT')),
  title           text,                                -- e.g. "Senior Stylist", "Bike"
  is_active       boolean NOT NULL DEFAULT true,
  is_available    boolean NOT NULL DEFAULT true,      -- agents/providers on duty
  avatar_color    text,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX users_ws_role_idx ON users(workspace_id, role) WHERE is_active;

CREATE TABLE customers (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    uuid NOT NULL REFERENCES workspaces(id),
  name            text NOT NULL,
  phone           text NOT NULL,
  email           text,
  default_address text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------- listings (sample of the platform's catalogue)
CREATE TABLE listings (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id         uuid NOT NULL REFERENCES workspaces(id),
  external_ref         text,                              -- id of the listing in the main Orqland platform
  kind                 text NOT NULL CHECK (kind IN ('PRODUCT','SERVICE')),
  name                 text NOT NULL,
  description          text,
  tags                 text[] NOT NULL DEFAULT '{}',
  price_paise          integer NOT NULL CHECK (price_paise >= 0),
  fulfilment_types     text[] NOT NULL,                   -- fulfilment options configured on the listing
  booking_mode         text NOT NULL DEFAULT 'INSTANT' CHECK (booking_mode IN ('INSTANT','SLOT')),
  auto_confirm         boolean NOT NULL DEFAULT false,    -- confirm automatically or send to admin
  prep_minutes         integer NOT NULL DEFAULT 15 CHECK (prep_minutes >= 0),
  duration_minutes     integer NOT NULL DEFAULT 60 CHECK (duration_minutes > 0),
  instant_capacity     integer NOT NULL DEFAULT 1 CHECK (instant_capacity > 0), -- concurrent instant bookings
  stock                integer CHECK (stock IS NULL OR stock >= 0),            -- NULL = not tracked
  default_provider_id  uuid REFERENCES users(id),
  default_meeting_link text,
  is_active            boolean NOT NULL DEFAULT true,
  created_at           timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------- availability & capacity
CREATE TABLE slots (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL REFERENCES workspaces(id),
  listing_id    uuid REFERENCES listings(id),             -- NULL = workspace-wide delivery / pickup slot
  kind          text NOT NULL CHECK (kind IN ('DELIVERY','PICKUP','SERVICE','WORKSHOP_SESSION')),
  provider_id   uuid REFERENCES users(id),
  title         text,
  starts_at     timestamptz NOT NULL,
  ends_at       timestamptz NOT NULL,
  capacity      integer NOT NULL CHECK (capacity > 0),
  reserved      integer NOT NULL DEFAULT 0,
  status        text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','CLOSED','COMPLETED')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT slot_time_ok CHECK (ends_at > starts_at),
  -- never overbook, never go negative — even under concurrent requests
  CONSTRAINT slot_capacity_ok CHECK (reserved >= 0 AND reserved <= capacity)
);
CREATE INDEX slots_lookup_idx ON slots(workspace_id, kind, starts_at);
CREATE INDEX slots_listing_idx ON slots(listing_id, starts_at);

-- ---------------------------------------------------------------- orders / bookings
CREATE SEQUENCE order_code_seq START 100001;

CREATE TABLE orders (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code                  text NOT NULL UNIQUE DEFAULT ('OQ-' || nextval('order_code_seq')),
  workspace_id          uuid NOT NULL REFERENCES workspaces(id),
  customer_id           uuid NOT NULL REFERENCES customers(id),
  kind                  text NOT NULL CHECK (kind IN ('PRODUCT','SERVICE')),
  fulfilment_type       text NOT NULL CHECK (fulfilment_type IN (
                          'DELIVERY','SCHEDULED_DELIVERY','TAKEAWAY','SCHEDULED_TAKEAWAY','DINE_IN',
                          'AT_PROVIDER_LOCATION','AT_CUSTOMER_LOCATION','EVENT','WORKSHOP','CONSULTATION','ONLINE')),
  booking_mode          text NOT NULL CHECK (booking_mode IN ('INSTANT','SLOT')),

  -- the four (+refund) separate statuses
  order_status          text NOT NULL CHECK (order_status IN ('PENDING_REVIEW','CLARIFICATION_REQUESTED','CONFIRMED','IN_PROGRESS','COMPLETED','CANCELLED','REJECTED')),
  fulfilment_status     text NOT NULL CHECK (fulfilment_status IN (
                          'NOT_STARTED','AWAITING_PREPARATION','AWAITING_SCHEDULE','SCHEDULED','PREPARING','READY','PICKED_UP',
                          'OUT_FOR_DELIVERY','DELIVERED','DELIVERY_FAILED','RETURNING','RETURNED_TO_WORKSPACE','COLLECTED','SERVED',
                          'PROVIDER_EN_ROUTE','CHECKED_IN','IN_SERVICE','SERVICE_COMPLETED','NO_SHOW','PROVIDER_UNAVAILABLE',
                          'SERVICE_FAILED','RETURN_APPROVED','RETURN_RECEIVED','CANCELLED')),
  payment_status        text NOT NULL CHECK (payment_status IN ('PENDING','PAID','FAILED')),
  payment_method        text NOT NULL CHECK (payment_method IN ('CASH','UPI','CARD','NET_BANKING','WALLET')),
  cod_status            text NOT NULL DEFAULT 'NOT_APPLICABLE' CHECK (cod_status IN ('NOT_APPLICABLE','PENDING_COLLECTION','COLLECTED','HANDOVER_SUBMITTED','SETTLED','DISCREPANCY')),
  refund_status         text NOT NULL DEFAULT 'NOT_APPLICABLE' CHECK (refund_status IN ('NOT_APPLICABLE','PENDING','REFUNDED','FAILED')),

  subtotal_paise        integer NOT NULL CHECK (subtotal_paise >= 0),
  delivery_fee_paise    integer NOT NULL DEFAULT 0 CHECK (delivery_fee_paise >= 0),
  discount_paise        integer NOT NULL DEFAULT 0 CHECK (discount_paise >= 0),
  total_paise           integer NOT NULL CHECK (total_paise >= 0),
  cod_collected_paise   integer NOT NULL DEFAULT 0 CHECK (cod_collected_paise >= 0),

  -- schedule & capacity
  slot_id               uuid REFERENCES slots(id),
  seats                 integer NOT NULL DEFAULT 1 CHECK (seats > 0),
  scheduled_start       timestamptz,
  scheduled_end         timestamptz,

  -- fulfilment details
  delivery_address      text,
  delivery_lat          numeric(9,6),
  delivery_lng          numeric(9,6),
  distance_km           numeric(6,2),
  customer_note         text,
  table_number          text,
  event_details         jsonb,                    -- venue, guests, requirements
  provider_id           uuid REFERENCES users(id),
  provider_confirmed_at timestamptz,
  blocks_provider       boolean NOT NULL DEFAULT false,
  meeting_link          text,
  meeting_notes         text,
  prep_minutes          integer NOT NULL DEFAULT 0,
  extra_prep_minutes    integer NOT NULL DEFAULT 0 CHECK (extra_prep_minutes >= 0),
  prep_started_at       timestamptz,
  ready_at              timestamptz,
  delivered_by_agent_id uuid REFERENCES users(id),

  -- exceptions
  clarification_note    text,
  cancel_reason         text,
  reject_reason         text,
  failure_reason        text,
  failure_notes         text,
  failure_evidence      text,
  return_confirmed_at   timestamptz,
  after_return_action   text CHECK (after_return_action IN ('RESCHEDULE')),
  return_pickup_at      timestamptz,
  exception             text,                     -- derived exception code for dashboards

  cancelled_at          timestamptz,
  completed_at          timestamptz,
  idempotency_key       text,
  version               integer NOT NULL DEFAULT 1,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT orders_idempotency UNIQUE (workspace_id, idempotency_key),
  CONSTRAINT orders_schedule_ok CHECK (scheduled_end IS NULL OR scheduled_start IS NULL OR scheduled_end > scheduled_start),
  CONSTRAINT orders_reject_reason CHECK (order_status <> 'REJECTED' OR reject_reason IS NOT NULL),
  CONSTRAINT orders_cancel_reason CHECK (order_status <> 'CANCELLED' OR cancel_reason IS NOT NULL),
  -- a provider cannot be double-booked for conflict-sensitive services
  CONSTRAINT orders_provider_no_overlap EXCLUDE USING gist (
    provider_id WITH =,
    tstzrange(scheduled_start, scheduled_end) WITH &&
  ) WHERE (blocks_provider AND provider_id IS NOT NULL AND scheduled_start IS NOT NULL AND scheduled_end IS NOT NULL
           AND order_status IN ('PENDING_REVIEW','CLARIFICATION_REQUESTED','CONFIRMED','IN_PROGRESS'))
);
-- same customer cannot book the same slot twice (duplicate booking protection)
CREATE UNIQUE INDEX orders_customer_slot_active_uq ON orders(customer_id, slot_id)
  WHERE slot_id IS NOT NULL AND order_status NOT IN ('CANCELLED','REJECTED');
CREATE INDEX orders_ws_status_idx ON orders(workspace_id, order_status, created_at DESC);
CREATE INDEX orders_ws_type_idx ON orders(workspace_id, fulfilment_type);
CREATE INDEX orders_ws_exception_idx ON orders(workspace_id) WHERE exception IS NOT NULL;
CREATE INDEX orders_provider_idx ON orders(provider_id, scheduled_start);
CREATE INDEX orders_slot_idx ON orders(slot_id);

CREATE TABLE order_items (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id          uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  listing_id        uuid NOT NULL REFERENCES listings(id),
  name              text NOT NULL,
  quantity          integer NOT NULL CHECK (quantity > 0),
  unit_price_paise  integer NOT NULL CHECK (unit_price_paise >= 0),
  total_paise       integer NOT NULL CHECK (total_paise >= 0),
  note              text
);
CREATE INDEX order_items_order_idx ON order_items(order_id);

-- customer / provider requests (cancellation, reschedule, return)
CREATE TABLE order_requests (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id           uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  type               text NOT NULL CHECK (type IN ('CANCELLATION','RESCHEDULE','RETURN')),
  status             text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','APPROVED','DECLINED')),
  requested_by_role  text NOT NULL,
  requested_by_id    uuid,
  reason             text,
  proposed_start     timestamptz,
  proposed_slot_id   uuid REFERENCES slots(id),
  resolved_by        uuid,
  resolved_at        timestamptz,
  resolution_note    text,
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX order_requests_one_open_per_type ON order_requests(order_id, type) WHERE status = 'PENDING';

-- ---------------------------------------------------------------- delivery
CREATE TABLE delivery_assignments (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id         uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  agent_id         uuid NOT NULL REFERENCES users(id),
  status           text NOT NULL CHECK (status IN ('OFFERED','ACCEPTED','REJECTED','EXPIRED','CANCELLED','COMPLETED')),
  method           text NOT NULL CHECK (method IN ('MANUAL','AUTO')),
  assigned_by      uuid,
  offered_at       timestamptz NOT NULL DEFAULT now(),
  expires_at       timestamptz,
  responded_at     timestamptz,
  picked_up_at     timestamptz,
  closed_at        timestamptz,
  reason           text,
  -- hooks for future live-GPS integration (out of scope, see integration guide)
  last_lat         numeric(9,6),
  last_lng         numeric(9,6),
  last_location_at timestamptz
);
CREATE UNIQUE INDEX delivery_one_active_assignment ON delivery_assignments(order_id) WHERE status IN ('OFFERED','ACCEPTED');
CREATE INDEX delivery_agent_active_idx ON delivery_assignments(agent_id) WHERE status IN ('OFFERED','ACCEPTED');
CREATE INDEX delivery_expiry_idx ON delivery_assignments(expires_at) WHERE status = 'OFFERED';

-- ---------------------------------------------------------------- payments, COD & settlement
CREATE TABLE payments (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id            uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  attempt             integer NOT NULL,
  method              text NOT NULL,
  amount_paise        integer NOT NULL CHECK (amount_paise >= 0),
  status              text NOT NULL CHECK (status IN ('PENDING','SUCCEEDED','FAILED')),
  provider            text NOT NULL DEFAULT 'sample',
  provider_reference  text UNIQUE,                    -- gateway transaction id (idempotent webhooks)
  failure_reason      text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  confirmed_at        timestamptz,
  UNIQUE (order_id, attempt)
);
-- prevents duplicate successful charges
CREATE UNIQUE INDEX payments_one_success_per_order ON payments(order_id) WHERE status = 'SUCCEEDED';

CREATE TABLE cash_handovers (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code                text NOT NULL UNIQUE DEFAULT ('HO-' || to_char(now(),'YYMMDD') || '-' || substr(md5(random()::text),1,4)),
  workspace_id        uuid NOT NULL REFERENCES workspaces(id),
  agent_id            uuid NOT NULL REFERENCES users(id),
  status              text NOT NULL CHECK (status IN ('SUBMITTED','CONFIRMED','DISCREPANCY','RESOLVED')),
  expected_paise      integer NOT NULL CHECK (expected_paise >= 0),   -- sum of collections included
  declared_paise      integer NOT NULL CHECK (declared_paise >= 0),   -- what the agent says they hand over
  received_paise      integer CHECK (received_paise >= 0),            -- what the admin counted
  agent_note          text,
  discrepancy_reason  text,
  resolution          text CHECK (resolution IN ('AGENT_PAID_DIFFERENCE','RECOUNT_CORRECTED','WRITTEN_OFF','DEDUCTED_FROM_PAYOUT')),
  resolution_note     text,
  submitted_at        timestamptz NOT NULL DEFAULT now(),
  verified_by         uuid REFERENCES users(id),
  verified_at         timestamptz,
  resolved_by         uuid REFERENCES users(id),
  resolved_at         timestamptz
);
CREATE INDEX cash_handovers_ws_status_idx ON cash_handovers(workspace_id, status);

CREATE TABLE cod_collections (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id              uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  agent_id              uuid REFERENCES users(id),     -- NULL = collected at the workspace counter
  amount_paise          integer NOT NULL CHECK (amount_paise > 0),
  collected_by_user_id  uuid REFERENCES users(id),
  collected_at          timestamptz NOT NULL DEFAULT now(),
  handover_id           uuid REFERENCES cash_handovers(id),
  settled               boolean NOT NULL DEFAULT false
);
CREATE INDEX cod_collections_agent_open_idx ON cod_collections(agent_id) WHERE NOT settled;

-- ---------------------------------------------------------------- audit & notifications
CREATE TABLE audit_logs (
  id            bigserial PRIMARY KEY,
  workspace_id  uuid NOT NULL REFERENCES workspaces(id),
  entity_type   text NOT NULL,             -- ORDER, SLOT, HANDOVER, ASSIGNMENT, PAYMENT
  entity_id     uuid NOT NULL,
  order_id      uuid REFERENCES orders(id) ON DELETE CASCADE,
  action        text NOT NULL,
  message       text NOT NULL,
  actor_id      text,
  actor_role    text NOT NULL,
  actor_name    text,
  reason        text,
  from_state    jsonb,
  to_state      jsonb,
  data          jsonb,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_logs_order_idx ON audit_logs(order_id, created_at);
CREATE INDEX audit_logs_entity_idx ON audit_logs(entity_type, entity_id, created_at);

CREATE TABLE notifications (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id           uuid NOT NULL REFERENCES workspaces(id),
  audience               text NOT NULL CHECK (audience IN ('CUSTOMER','ADMIN','AGENT','PROVIDER')),
  recipient_user_id      uuid REFERENCES users(id),
  recipient_customer_id  uuid REFERENCES customers(id),
  order_id               uuid REFERENCES orders(id) ON DELETE CASCADE,
  title                  text NOT NULL,
  body                   text,
  channel                text NOT NULL DEFAULT 'IN_APP',
  delivery_status        text NOT NULL DEFAULT 'QUEUED' CHECK (delivery_status IN ('QUEUED','SENT','FAILED','SKIPPED')),
  read_at                timestamptz,
  created_at             timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notifications_user_idx ON notifications(recipient_user_id, created_at DESC);
CREATE INDEX notifications_ws_aud_idx ON notifications(workspace_id, audience, created_at DESC);

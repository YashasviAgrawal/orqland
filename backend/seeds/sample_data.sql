-- Sample data for the standalone Order Management module.
-- The real Orqland platform is confidential, so this seed recreates a realistic workspace
-- ("Sj Softwares", as in the Figma) with orders/bookings in every relevant state.
-- Dates are relative to now() so the demo always looks current.
-- Safe to re-run: it wipes module data first.

BEGIN;

TRUNCATE audit_logs, notifications, cod_collections, cash_handovers, payments, delivery_assignments,
         order_requests, order_items, orders, slots, listings, customers, users, workspaces CASCADE;
ALTER SEQUENCE order_code_seq RESTART WITH 100231;

-- ------------------------------------------------------------------ workspace
INSERT INTO workspaces (id, code, name, address, lat, lng, phone) VALUES
 ('11111111-1111-4111-8111-111111111111', 'ABC#123456789#', 'Sj Softwares', '14, MS Road, T. Nagar, Chennai 600017', 13.041700, 80.233900, '+91 44 4000 1234');

-- ------------------------------------------------------------------ people
INSERT INTO users (id, workspace_id, name, phone, email, role, title, is_available, avatar_color) VALUES
 ('a0000000-0000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111','Sanjay J','+91 98400 11111','admin@sjsoftwares.in','WORKSPACE_ADMIN','Workspace Admin',true,'#1d4ed8'),
 ('a0000000-0000-4000-8000-000000000002','11111111-1111-4111-8111-111111111111','Ravi Kumar','+91 98400 22222',null,'DELIVERY_AGENT','Bike · TN 09 AB 1234',true,'#0f766e'),
 ('a0000000-0000-4000-8000-000000000003','11111111-1111-4111-8111-111111111111','Suresh M','+91 98400 33333',null,'DELIVERY_AGENT','Scooter · TN 07 CD 5678',true,'#b45309'),
 ('a0000000-0000-4000-8000-000000000004','11111111-1111-4111-8111-111111111111','Arun P','+91 98400 44444',null,'DELIVERY_AGENT','Bike · TN 10 EF 9012',false,'#7c3aed'),
 ('a0000000-0000-4000-8000-000000000005','11111111-1111-4111-8111-111111111111','Priya S','+91 98400 55555',null,'SERVICE_PROVIDER','Senior Stylist',true,'#be185d'),
 ('a0000000-0000-4000-8000-000000000006','11111111-1111-4111-8111-111111111111','Karthik R','+91 98400 66666',null,'SERVICE_PROVIDER','Field Technician & Events',true,'#0369a1'),
 ('a0000000-0000-4000-8000-000000000007','11111111-1111-4111-8111-111111111111','Meena V','+91 98400 77777',null,'SERVICE_PROVIDER','Design Consultant & Instructor',true,'#15803d');

INSERT INTO customers (id, workspace_id, name, phone, email, default_address) VALUES
 ('c0000000-0000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111','Ram Kumar K','+91 90876 65432','ram.k@example.com','22, MS Road, Chennai 600017'),
 ('c0000000-0000-4000-8000-000000000002','11111111-1111-4111-8111-111111111111','Prem Kumar S','+91 96453 82418','prem.s@example.com','Park Street, 2nd Block, Apartment 28, Anna Nagar, Chennai 600040'),
 ('c0000000-0000-4000-8000-000000000003','11111111-1111-4111-8111-111111111111','Anitha R','+91 94440 12345',null,'7, Gandhi Road, Adyar, Chennai 600020'),
 ('c0000000-0000-4000-8000-000000000004','11111111-1111-4111-8111-111111111111','Deepak V','+91 99620 54321',null,'Flat 3B, Lake View Apts, Velachery, Chennai 600042'),
 ('c0000000-0000-4000-8000-000000000005','11111111-1111-4111-8111-111111111111','Lakshmi N','+91 98841 67890',null,'12, Temple Street, Mylapore, Chennai 600004'),
 ('c0000000-0000-4000-8000-000000000006','11111111-1111-4111-8111-111111111111','Farhan A','+91 97910 24680',null,'45, Mount Road, Teynampet, Chennai 600018'),
 ('c0000000-0000-4000-8000-000000000007','11111111-1111-4111-8111-111111111111','Kavya S','+91 93810 13579',null,'9, Besant Avenue, Besant Nagar, Chennai 600090'),
 ('c0000000-0000-4000-8000-000000000008','11111111-1111-4111-8111-111111111111','Vignesh T','+91 95000 86420',null,'18, OMR, Thoraipakkam, Chennai 600097');

-- ------------------------------------------------------------------ listings
INSERT INTO listings (id, workspace_id, kind, name, description, tags, price_paise, fulfilment_types, booking_mode, auto_confirm, prep_minutes, duration_minutes, instant_capacity, stock, default_provider_id, default_meeting_link) VALUES
 ('b0000000-0000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111','PRODUCT','Handmade Ceramic Mug','Hand-thrown stoneware mug, 350 ml',ARRAY['Heat-resistant','Comfortable grip'],99800,ARRAY['DELIVERY','SCHEDULED_DELIVERY','TAKEAWAY','SCHEDULED_TAKEAWAY'],'INSTANT',false,15,60,1,23,null,null),
 ('b0000000-0000-4000-8000-000000000002','11111111-1111-4111-8111-111111111111','PRODUCT','Filter Coffee','Traditional degree coffee, 150 ml',ARRAY['Hot','Freshly brewed'],6000,ARRAY['DINE_IN','TAKEAWAY','DELIVERY'],'INSTANT',false,8,60,1,null,null,null),
 ('b0000000-0000-4000-8000-000000000003','11111111-1111-4111-8111-111111111111','PRODUCT','Terracotta Planter Set','Set of 3 hand-painted planters',ARRAY['Handmade','Fragile'],145000,ARRAY['DELIVERY','SCHEDULED_DELIVERY'],'INSTANT',false,20,60,1,12,null,null),
 ('b0000000-0000-4000-8000-000000000004','11111111-1111-4111-8111-111111111111','PRODUCT','Masala Dosa Platter','Dosa with sambar & three chutneys',ARRAY['Vegetarian','Serves 1'],22000,ARRAY['DINE_IN','TAKEAWAY','SCHEDULED_TAKEAWAY'],'INSTANT',false,12,60,1,null,null,null),
 ('b0000000-0000-4000-8000-000000000005','11111111-1111-4111-8111-111111111111','PRODUCT','Festive Gift Hamper','Curated hamper with mug, sweets & card',ARRAY['Gift wrap','Personalised card'],249900,ARRAY['SCHEDULED_DELIVERY','DELIVERY'],'SLOT',false,30,60,1,8,null,null),
 ('b0000000-0000-4000-8000-000000000011','11111111-1111-4111-8111-111111111111','SERVICE','Hair Spa & Styling','Deep conditioning spa and blow-dry',ARRAY['60 min','Salon'],180000,ARRAY['AT_PROVIDER_LOCATION'],'SLOT',true,0,60,2,null,'a0000000-0000-4000-8000-000000000005',null),
 ('b0000000-0000-4000-8000-000000000012','11111111-1111-4111-8111-111111111111','SERVICE','Home AC Servicing','Split AC deep cleaning & gas check',ARRAY['90 min','At home'],149900,ARRAY['AT_CUSTOMER_LOCATION'],'SLOT',false,0,90,1,null,'a0000000-0000-4000-8000-000000000006',null),
 ('b0000000-0000-4000-8000-000000000013','11111111-1111-4111-8111-111111111111','SERVICE','Wedding Décor & Photography','Stage décor, floral styling and candid photography',ARRAY['Event','Custom quote'],4500000,ARRAY['EVENT'],'SLOT',false,0,480,1,null,'a0000000-0000-4000-8000-000000000006',null),
 ('b0000000-0000-4000-8000-000000000014','11111111-1111-4111-8111-111111111111','SERVICE','Pottery Wheel Workshop','3-hour beginner workshop, materials included',ARRAY['Workshop','Beginner'],150000,ARRAY['WORKSHOP'],'SLOT',true,0,180,12,null,'a0000000-0000-4000-8000-000000000007',null),
 ('b0000000-0000-4000-8000-000000000015','11111111-1111-4111-8111-111111111111','SERVICE','Business Consultation','30-minute strategy consultation or product demo',ARRAY['30 min','In person'],120000,ARRAY['CONSULTATION'],'SLOT',false,0,30,1,null,'a0000000-0000-4000-8000-000000000007',null),
 ('b0000000-0000-4000-8000-000000000016','11111111-1111-4111-8111-111111111111','SERVICE','Online Design Review','Live video review of your brand or UI design',ARRAY['30 min','Video call'],80000,ARRAY['ONLINE'],'INSTANT',true,0,30,1,null,'a0000000-0000-4000-8000-000000000007','https://meet.orqland.example/design-review');

-- ------------------------------------------------------------------ availability (today .. +7 days, Asia/Kolkata)
-- workspace delivery windows
INSERT INTO slots (workspace_id, kind, title, starts_at, ends_at, capacity)
SELECT '11111111-1111-4111-8111-111111111111','DELIVERY','Delivery window',
       ((ist_today() + d) + t) AT TIME ZONE 'Asia/Kolkata', ((ist_today() + d) + t + interval '2 hours') AT TIME ZONE 'Asia/Kolkata', 8
FROM generate_series(0,7) d, unnest(ARRAY[time '10:00', time '12:00', time '16:00', time '18:00']) t;
-- pickup windows
INSERT INTO slots (workspace_id, kind, title, starts_at, ends_at, capacity)
SELECT '11111111-1111-4111-8111-111111111111','PICKUP','Pickup window',
       ((ist_today() + d) + t) AT TIME ZONE 'Asia/Kolkata', ((ist_today() + d) + t + interval '30 minutes') AT TIME ZONE 'Asia/Kolkata', 6
FROM generate_series(0,7) d, unnest(ARRAY[time '11:00', time '13:00', time '17:00', time '19:00']) t;
-- hair spa: hourly, 2 chairs
INSERT INTO slots (workspace_id, listing_id, kind, provider_id, starts_at, ends_at, capacity)
SELECT '11111111-1111-4111-8111-111111111111','b0000000-0000-4000-8000-000000000011','SERVICE','a0000000-0000-4000-8000-000000000005',
       ((ist_today() + d) + make_time(h,0,0)) AT TIME ZONE 'Asia/Kolkata', ((ist_today() + d) + make_time(h+1,0,0)) AT TIME ZONE 'Asia/Kolkata', 2
FROM generate_series(0,7) d, generate_series(10,17) h;
-- AC servicing: 4 visits a day, one technician
INSERT INTO slots (workspace_id, listing_id, kind, provider_id, starts_at, ends_at, capacity)
SELECT '11111111-1111-4111-8111-111111111111','b0000000-0000-4000-8000-000000000012','SERVICE','a0000000-0000-4000-8000-000000000006',
       ((ist_today() + d) + t) AT TIME ZONE 'Asia/Kolkata', ((ist_today() + d) + t + interval '90 minutes') AT TIME ZONE 'Asia/Kolkata', 1
FROM generate_series(0,7) d, unnest(ARRAY[time '09:00', time '11:00', time '14:00', time '16:00']) t;
-- pottery workshop sessions with 12 seats
INSERT INTO slots (workspace_id, listing_id, kind, provider_id, title, starts_at, ends_at, capacity)
SELECT '11111111-1111-4111-8111-111111111111','b0000000-0000-4000-8000-000000000014','WORKSHOP_SESSION','a0000000-0000-4000-8000-000000000007','Pottery for Beginners',
       ((ist_today() + d) + time '10:00') AT TIME ZONE 'Asia/Kolkata', ((ist_today() + d) + time '13:00') AT TIME ZONE 'Asia/Kolkata', 12
FROM unnest(ARRAY[0,1,3,6]) d;
-- consultations every 30 minutes
INSERT INTO slots (workspace_id, listing_id, kind, provider_id, starts_at, ends_at, capacity)
SELECT '11111111-1111-4111-8111-111111111111','b0000000-0000-4000-8000-000000000015','SERVICE','a0000000-0000-4000-8000-000000000007',
       ((ist_today() + d) + make_time(10,0,0) + (s * interval '30 minutes')) AT TIME ZONE 'Asia/Kolkata',
       ((ist_today() + d) + make_time(10,30,0) + (s * interval '30 minutes')) AT TIME ZONE 'Asia/Kolkata', 1
FROM generate_series(0,7) d, generate_series(0,13) s;
-- online sessions in the evening
INSERT INTO slots (workspace_id, listing_id, kind, provider_id, starts_at, ends_at, capacity)
SELECT '11111111-1111-4111-8111-111111111111','b0000000-0000-4000-8000-000000000016','SERVICE','a0000000-0000-4000-8000-000000000007',
       ((ist_today() + d) + make_time(18,0,0) + (s * interval '30 minutes')) AT TIME ZONE 'Asia/Kolkata',
       ((ist_today() + d) + make_time(18,30,0) + (s * interval '30 minutes')) AT TIME ZONE 'Asia/Kolkata', 1
FROM generate_series(0,7) d, generate_series(0,5) s;

-- ------------------------------------------------------------------ helper to create consistent orders
CREATE OR REPLACE FUNCTION pg_temp.mk(j jsonb) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE
  ws uuid := '11111111-1111-4111-8111-111111111111';
  v_id uuid := gen_random_uuid();
  l listings%ROWTYPE;
  s slots%ROWTYPE;
  v_qty int := coalesce((j->>'qty')::int, 1);
  v_type text := j->>'type';
  v_created timestamptz := now() - coalesce((j->>'ago')::interval, interval '5 minutes');
  v_pm text := coalesce(j->>'pm', 'UPI');
  v_ps text;
  v_os text := coalesce(j->>'os', 'PENDING_REVIEW');
  v_fs text := coalesce(j->>'fs', 'NOT_STARTED');
  v_start timestamptz; v_end timestamptz;
  v_total int; v_cod text; v_addr text; v_slot uuid; v_seats int := 1;
  v_provider uuid; v_blocks boolean := false;
  ev jsonb; v_t timestamptz;
BEGIN
  SELECT * INTO l FROM listings WHERE id = (j->>'listing')::uuid;
  IF NOT FOUND THEN RAISE EXCEPTION 'listing missing %', j; END IF;
  v_ps := coalesce(j->>'ps', CASE WHEN v_pm = 'CASH' THEN 'PENDING' ELSE 'PAID' END);
  v_cod := coalesce(j->>'cod', CASE WHEN v_pm = 'CASH' THEN 'PENDING_COLLECTION' ELSE 'NOT_APPLICABLE' END);

  IF j ? 'slot_day' THEN
    SELECT * INTO s FROM slots
     WHERE workspace_id = ws AND kind = j->>'slot_kind'
       AND (CASE WHEN j->>'slot_kind' IN ('DELIVERY','PICKUP') THEN listing_id IS NULL ELSE listing_id = l.id END)
       AND starts_at = ((ist_today() + (j->>'slot_day')::int) + (j->>'slot_time')::time) AT TIME ZONE 'Asia/Kolkata';
    IF NOT FOUND THEN RAISE EXCEPTION 'slot missing %', j; END IF;
    v_slot := s.id; v_start := s.starts_at; v_end := s.ends_at;
    IF v_type = 'WORKSHOP' THEN v_seats := v_qty; END IF;
    IF v_os NOT IN ('CANCELLED','REJECTED') THEN
      UPDATE slots SET reserved = reserved + v_seats WHERE id = s.id;
    END IF;
  ELSIF j ? 'start_in' THEN
    v_start := date_trunc('minute', now() + (j->>'start_in')::interval);
    v_end := v_start + make_interval(mins => l.duration_minutes);
  END IF;

  IF l.kind = 'SERVICE' THEN
    v_provider := coalesce((j->>'provider')::uuid, l.default_provider_id);
    v_blocks := v_type IN ('AT_CUSTOMER_LOCATION','CONSULTATION','ONLINE');
  END IF;
  v_addr := CASE WHEN v_type IN ('DELIVERY','SCHEDULED_DELIVERY','AT_CUSTOMER_LOCATION','EVENT')
                 THEN coalesce(j->>'address', (SELECT default_address FROM customers WHERE id = (j->>'customer')::uuid)) END;
  v_total := l.price_paise * v_qty;

  INSERT INTO orders (id, workspace_id, customer_id, kind, fulfilment_type, booking_mode, order_status, fulfilment_status,
    payment_status, payment_method, cod_status, refund_status, subtotal_paise, total_paise, cod_collected_paise,
    slot_id, seats, scheduled_start, scheduled_end, delivery_address, distance_km, customer_note, table_number, event_details,
    provider_id, provider_confirmed_at, blocks_provider, meeting_link, prep_minutes, extra_prep_minutes, prep_started_at, ready_at,
    delivered_by_agent_id, clarification_note, cancel_reason, reject_reason, failure_reason, failure_notes,
    return_confirmed_at, cancelled_at, completed_at, created_at)
  VALUES (v_id, ws, (j->>'customer')::uuid, l.kind, v_type, CASE WHEN v_slot IS NOT NULL THEN 'SLOT' ELSE 'INSTANT' END, v_os, v_fs,
    v_ps, v_pm, v_cod, coalesce(j->>'refund','NOT_APPLICABLE'), v_total, v_total, coalesce((j->>'cod_collected')::int, 0),
    v_slot, v_seats, v_start, v_end, v_addr, (j->>'distance')::numeric, j->>'note', j->>'table', j->'event',
    v_provider, CASE WHEN (j->>'provider_confirmed')::boolean THEN v_created + interval '3 minutes' END, v_blocks,
    coalesce(j->>'meeting', CASE WHEN v_type = 'ONLINE' AND v_os <> 'PENDING_REVIEW' THEN l.default_meeting_link END),
    l.prep_minutes, coalesce((j->>'extra_prep')::int, 0),
    CASE WHEN j ? 'prep_ago' THEN now() - (j->>'prep_ago')::interval END,
    CASE WHEN v_fs IN ('READY','PICKED_UP','OUT_FOR_DELIVERY','DELIVERED','COLLECTED','SERVED','DELIVERY_FAILED') THEN now() - coalesce((j->>'ready_ago')::interval, interval '4 minutes') END,
    (j->>'delivered_by')::uuid, j->>'clarification', j->>'cancel_reason', j->>'reject_reason', j->>'failure_reason', j->>'failure_notes',
    CASE WHEN (j->>'return_confirmed')::boolean THEN now() END,
    CASE WHEN v_os = 'CANCELLED' THEN now() - interval '20 minutes' END,
    CASE WHEN v_os = 'COMPLETED' THEN v_created + interval '50 minutes' END,
    v_created);

  INSERT INTO order_items (order_id, listing_id, name, quantity, unit_price_paise, total_paise)
  VALUES (v_id, l.id, l.name, v_qty, l.price_paise, v_total);

  IF v_pm <> 'CASH' THEN
    INSERT INTO payments (order_id, attempt, method, amount_paise, status, provider_reference, failure_reason, created_at, confirmed_at)
    VALUES (v_id, 1, v_pm, v_total,
            CASE v_ps WHEN 'PAID' THEN 'SUCCEEDED' WHEN 'FAILED' THEN 'FAILED' ELSE 'PENDING' END,
            'pay_' || substr(md5(v_id::text), 1, 14),
            CASE WHEN v_ps = 'FAILED' THEN 'Bank declined: insufficient funds' END,
            v_created, CASE WHEN v_ps = 'PAID' THEN v_created + interval '20 seconds' END);
  END IF;

  INSERT INTO audit_logs (workspace_id, entity_type, entity_id, order_id, action, message, actor_role, actor_name, to_state, created_at)
  VALUES (ws, 'ORDER', v_id, v_id, 'ORDER_PLACED', CASE WHEN l.kind = 'PRODUCT' THEN 'Order placed by customer' ELSE 'Booking placed by customer' END,
          'CUSTOMER', (SELECT name FROM customers WHERE id = (j->>'customer')::uuid),
          jsonb_build_object('orderStatus','PENDING_REVIEW','fulfilmentStatus','NOT_STARTED','paymentStatus', v_ps), v_created);
  IF v_pm <> 'CASH' AND v_ps = 'PAID' THEN
    INSERT INTO audit_logs (workspace_id, entity_type, entity_id, order_id, action, message, actor_role, actor_name, created_at)
    VALUES (ws, 'PAYMENT', v_id, v_id, 'PAYMENT_CONFIRMED', 'Payment confirmed by payment provider', 'SYSTEM', 'Payments', v_created + interval '20 seconds');
  END IF;

  -- extra timeline events: [{"m":"…","a":"ACTION","r":"ROLE","n":"name","after":"2 minutes","reason":"…"}]
  v_t := v_created + interval '30 seconds';
  FOR ev IN SELECT * FROM jsonb_array_elements(coalesce(j->'events','[]'::jsonb)) LOOP
    v_t := CASE WHEN ev ? 'at_ago' THEN now() - (ev->>'at_ago')::interval ELSE v_t + coalesce((ev->>'after')::interval, interval '2 minutes') END;
    INSERT INTO audit_logs (workspace_id, entity_type, entity_id, order_id, action, message, actor_role, actor_name, reason, created_at)
    VALUES (ws, 'ORDER', v_id, v_id, coalesce(ev->>'a','UPDATE'), ev->>'m', coalesce(ev->>'r','WORKSPACE_ADMIN'), coalesce(ev->>'n','Sanjay J'), ev->>'reason', v_t);
  END LOOP;
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION pg_temp.assign(p_order uuid, p_agent uuid, p_status text, p_ago interval, p_expires interval DEFAULT NULL) RETURNS void LANGUAGE sql AS $$
  INSERT INTO delivery_assignments (order_id, agent_id, status, method, assigned_by, offered_at, expires_at, responded_at, picked_up_at, closed_at)
  VALUES (p_order, p_agent, p_status, 'MANUAL', 'a0000000-0000-4000-8000-000000000001', now() - p_ago,
          CASE WHEN p_status = 'OFFERED' THEN now() + coalesce(p_expires, interval '3 minutes') END,
          CASE WHEN p_status <> 'OFFERED' THEN now() - p_ago + interval '1 minute' END,
          NULL,
          CASE WHEN p_status IN ('COMPLETED','CANCELLED','REJECTED','EXPIRED') THEN now() - p_ago + interval '30 minutes' END);
$$;

-- ------------------------------------------------------------------ orders
DO $$
DECLARE
  -- people
  ram uuid := 'c0000000-0000-4000-8000-000000000001'; prem uuid := 'c0000000-0000-4000-8000-000000000002';
  anitha uuid := 'c0000000-0000-4000-8000-000000000003'; deepak uuid := 'c0000000-0000-4000-8000-000000000004';
  lakshmi uuid := 'c0000000-0000-4000-8000-000000000005'; farhan uuid := 'c0000000-0000-4000-8000-000000000006';
  kavya uuid := 'c0000000-0000-4000-8000-000000000007'; vignesh uuid := 'c0000000-0000-4000-8000-000000000008';
  ravi uuid := 'a0000000-0000-4000-8000-000000000002'; suresh uuid := 'a0000000-0000-4000-8000-000000000003';
  admin uuid := 'a0000000-0000-4000-8000-000000000001';
  -- listings
  mug text := 'b0000000-0000-4000-8000-000000000001'; coffee text := 'b0000000-0000-4000-8000-000000000002';
  planter text := 'b0000000-0000-4000-8000-000000000003'; dosa text := 'b0000000-0000-4000-8000-000000000004';
  hamper text := 'b0000000-0000-4000-8000-000000000005'; spa text := 'b0000000-0000-4000-8000-000000000011';
  ac text := 'b0000000-0000-4000-8000-000000000012'; wedding text := 'b0000000-0000-4000-8000-000000000013';
  pottery text := 'b0000000-0000-4000-8000-000000000014'; consult text := 'b0000000-0000-4000-8000-000000000015';
  online text := 'b0000000-0000-4000-8000-000000000016';
  o uuid; h uuid;
BEGIN
  -- ===== NEW (pending review) =====
  PERFORM pg_temp.mk(jsonb_build_object('customer',ram,'listing',mug,'type','DELIVERY','ago','2 minutes','distance',10.2,
    'note','Please place the cushioning material on all sides.'));
  PERFORM pg_temp.mk(jsonb_build_object('customer',anitha,'listing',coffee,'qty',2,'type','TAKEAWAY','pm','CASH','ago','4 minutes'));
  PERFORM pg_temp.mk(jsonb_build_object('customer',deepak,'listing',planter,'type','SCHEDULED_DELIVERY','pm','CARD','ago','8 minutes',
    'slot_kind','DELIVERY','slot_day',1,'slot_time','16:00','distance',6.4));
  PERFORM pg_temp.mk(jsonb_build_object('customer',lakshmi,'listing',wedding,'type','EVENT','ps','PENDING','ago','55 minutes','start_in','12 days',
    'address','Sri Mahal Kalyana Mandapam, Mylapore, Chennai',
    'event',jsonb_build_object('venue','Sri Mahal Kalyana Mandapam, Mylapore','guests',250,'occasion','Wedding reception','requirements','Floral stage backdrop in ivory & gold, two candid photographers, 6 pm – 11 pm')));
  PERFORM pg_temp.mk(jsonb_build_object('customer',farhan,'listing',ac,'type','AT_CUSTOMER_LOCATION','pm','CASH','ago','20 minutes',
    'slot_kind','SERVICE','slot_day',1,'slot_time','11:00','note','Two split ACs, 2nd floor. Call before arriving.'));
  PERFORM pg_temp.mk(jsonb_build_object('customer',kavya,'listing',consult,'type','CONSULTATION','ago','12 minutes',
    'slot_kind','SERVICE','slot_day',1,'slot_time','15:00','note','Want to discuss launching an online store.'));
  PERFORM pg_temp.mk(jsonb_build_object('customer',vignesh,'listing',dosa,'qty',2,'type','DINE_IN','pm','CASH','ago','1 minute','table','T4'));

  -- clarification requested
  PERFORM pg_temp.mk(jsonb_build_object('customer',prem,'listing',hamper,'type','SCHEDULED_DELIVERY','ago','40 minutes','os','CLARIFICATION_REQUESTED',
    'slot_kind','DELIVERY','slot_day',2,'slot_time','12:00','clarification','Which message should we print on the personalised gift card?',
    'events',jsonb_build_array(jsonb_build_object('a','REQUEST_CLARIFICATION','m','Clarification requested from customer','after','6 minutes','reason','Which message should we print on the personalised gift card?'))));

  -- ===== CONFIRMED / UPCOMING =====
  o := pg_temp.mk(jsonb_build_object('customer',prem,'listing',mug,'type','SCHEDULED_TAKEAWAY','ago','3 hours','os','CONFIRMED','fs','SCHEDULED',
    'slot_kind','PICKUP','slot_day',0,'slot_time','19:00',
    'events',jsonb_build_array(jsonb_build_object('a','ACCEPT','m','Order accepted'))));
  INSERT INTO order_requests (order_id, type, requested_by_role, requested_by_id, reason, proposed_slot_id, proposed_start, created_at)
  SELECT o, 'RESCHEDULE', 'CUSTOMER', prem, 'Stuck at work, can I collect tomorrow?', s.id, s.starts_at, now() - interval '15 minutes'
  FROM slots s WHERE s.kind = 'PICKUP' AND s.starts_at = ((ist_today() + 1) + time '13:00') AT TIME ZONE 'Asia/Kolkata';
  INSERT INTO audit_logs (workspace_id, entity_type, entity_id, order_id, action, message, actor_role, actor_name, reason, created_at)
  VALUES ('11111111-1111-4111-8111-111111111111','ORDER',o,o,'CUSTOMER_REQUEST_RESCHEDULE','Customer requested a reschedule','CUSTOMER','Prem Kumar S','Stuck at work, can I collect tomorrow?', now() - interval '15 minutes');

  PERFORM pg_temp.mk(jsonb_build_object('customer',ram,'listing',hamper,'type','SCHEDULED_DELIVERY','ago','5 hours','os','CONFIRMED','fs','SCHEDULED',
    'slot_kind','DELIVERY','slot_day',0,'slot_time','18:00','distance',3.1,
    'events',jsonb_build_array(jsonb_build_object('a','ACCEPT','m','Order accepted','after','4 minutes'))));
  PERFORM pg_temp.mk(jsonb_build_object('customer',anitha,'listing',spa,'type','AT_PROVIDER_LOCATION','pm','CASH','ago','1 day','os','CONFIRMED','fs','SCHEDULED',
    'slot_kind','SERVICE','slot_day',1,'slot_time','10:00','provider_confirmed',true,
    'events',jsonb_build_array(jsonb_build_object('a','AUTO_CONFIRM','m','Booking confirmed automatically (instant confirmation listing)','r','SYSTEM','n','System','after','1 second'),
                               jsonb_build_object('a','CONFIRM_APPOINTMENT','m','Provider acknowledged the appointment','r','SERVICE_PROVIDER','n','Priya S','after','3 minutes'))));
  PERFORM pg_temp.mk(jsonb_build_object('customer',deepak,'listing',pottery,'qty',2,'type','WORKSHOP','ago','2 days','os','CONFIRMED','fs','SCHEDULED',
    'slot_kind','WORKSHOP_SESSION','slot_day',3,'slot_time','10:00',
    'events',jsonb_build_array(jsonb_build_object('a','AUTO_CONFIRM','m','Booking confirmed automatically — 2 seats reserved','r','SYSTEM','n','System','after','1 second'))));
  PERFORM pg_temp.mk(jsonb_build_object('customer',lakshmi,'listing',pottery,'qty',1,'type','WORKSHOP','ago','1 day','os','CONFIRMED','fs','SCHEDULED',
    'slot_kind','WORKSHOP_SESSION','slot_day',3,'slot_time','10:00',
    'events',jsonb_build_array(jsonb_build_object('a','AUTO_CONFIRM','m','Booking confirmed automatically — 1 seat reserved','r','SYSTEM','n','System','after','1 second'))));
  PERFORM pg_temp.mk(jsonb_build_object('customer',kavya,'listing',online,'type','ONLINE','ago','6 hours','os','CONFIRMED','fs','SCHEDULED',
    'slot_kind','SERVICE','slot_day',0,'slot_time','19:00','provider_confirmed',true,
    'events',jsonb_build_array(jsonb_build_object('a','AUTO_CONFIRM','m','Booking confirmed automatically','r','SYSTEM','n','System','after','1 second'),
                               jsonb_build_object('a','SET_MEETING_DETAILS','m','Online meeting details updated','r','SERVICE_PROVIDER','n','Meena V'))));
  PERFORM pg_temp.mk(jsonb_build_object('customer',lakshmi,'listing',mug,'type','DELIVERY','ago','6 minutes','os','CONFIRMED','fs','AWAITING_PREPARATION','distance',4.8,
    'events',jsonb_build_array(jsonb_build_object('a','ACCEPT','m','Order accepted','after','1 minute'))));

  -- ===== IN PROGRESS =====
  PERFORM pg_temp.mk(jsonb_build_object('customer',ram,'listing',mug,'type','DELIVERY','pm','CASH','ago','16 minutes','os','IN_PROGRESS','fs','PREPARING',
    'prep_ago','10 minutes','extra_prep',5,'distance',10.2,'note','Please place cushioning material on all sides.',
    'events',jsonb_build_array(jsonb_build_object('a','ACCEPT_AND_START_PREP','m','Order accepted and preparation started','at_ago','10 minutes'),
                               jsonb_build_object('a','ADD_PREP_TIME','m','Preparation time extended by 5 min','at_ago','4 minutes'))));
  o := pg_temp.mk(jsonb_build_object('customer',farhan,'listing',planter,'type','DELIVERY','pm','CARD','ago','45 minutes','os','IN_PROGRESS','fs','READY','distance',7.9,'prep_ago','35 minutes',
    'events',jsonb_build_array(jsonb_build_object('a','ACCEPT_AND_START_PREP','m','Order accepted and preparation started','at_ago','35 minutes'),
                               jsonb_build_object('a','MARK_READY','m','Order marked ready','at_ago','4 minutes'),
                               jsonb_build_object('a','ASSIGN_AGENT','m','Delivery agent assigned manually','at_ago','1 minute'))));
  PERFORM pg_temp.assign(o, ravi, 'OFFERED', interval '1 minute', interval '2 minutes');
  PERFORM pg_temp.mk(jsonb_build_object('customer',vignesh,'listing',coffee,'qty',3,'type','DELIVERY','ago','25 minutes','os','IN_PROGRESS','fs','READY','distance',2.2,'prep_ago','18 minutes',
    'events',jsonb_build_array(jsonb_build_object('a','ACCEPT_AND_START_PREP','m','Order accepted and preparation started','at_ago','18 minutes'),
                               jsonb_build_object('a','MARK_READY','m','Order marked ready','at_ago','6 minutes'))));
  o := pg_temp.mk(jsonb_build_object('customer',prem,'listing',mug,'type','DELIVERY','pm','CASH','ago','70 minutes','os','IN_PROGRESS','fs','OUT_FOR_DELIVERY','distance',8.6,'prep_ago','60 minutes','ready_ago','30 minutes',
    'events',jsonb_build_array(jsonb_build_object('a','ACCEPT_AND_START_PREP','m','Order accepted and preparation started','at_ago','60 minutes'),
                               jsonb_build_object('a','MARK_READY','m','Order marked ready','at_ago','30 minutes'),
                               jsonb_build_object('a','AUTO_ASSIGN_AGENT','m','Delivery agent auto-assigned','at_ago','29 minutes'),
                               jsonb_build_object('a','ACCEPT_DELIVERY','m','Delivery accepted by agent','r','DELIVERY_AGENT','n','Suresh M','at_ago','28 minutes'),
                               jsonb_build_object('a','CONFIRM_PICKUP','m','Parcel picked up by agent','r','DELIVERY_AGENT','n','Suresh M','at_ago','20 minutes'),
                               jsonb_build_object('a','START_DELIVERY','m','Out for delivery','r','DELIVERY_AGENT','n','Suresh M','at_ago','19 minutes'))));
  PERFORM pg_temp.assign(o, suresh, 'ACCEPTED', interval '29 minutes');
  UPDATE delivery_assignments SET method = 'AUTO', picked_up_at = now() - interval '20 minutes' WHERE order_id = o;
  o := pg_temp.mk(jsonb_build_object('customer',anitha,'listing',mug,'type','DELIVERY','ago','50 minutes','os','IN_PROGRESS','fs','PICKED_UP','distance',5.3,'prep_ago','40 minutes','ready_ago','12 minutes',
    'events',jsonb_build_array(jsonb_build_object('a','ACCEPT_AND_START_PREP','m','Order accepted and preparation started','at_ago','40 minutes'),
                               jsonb_build_object('a','MARK_READY','m','Order marked ready','at_ago','12 minutes'),
                               jsonb_build_object('a','ASSIGN_AGENT','m','Delivery agent assigned manually','at_ago','11 minutes'),
                               jsonb_build_object('a','ACCEPT_DELIVERY','m','Delivery accepted by agent','r','DELIVERY_AGENT','n','Ravi Kumar','at_ago','10 minutes'),
                               jsonb_build_object('a','CONFIRM_PICKUP','m','Parcel picked up by agent','r','DELIVERY_AGENT','n','Ravi Kumar','at_ago','2 minutes'))));
  PERFORM pg_temp.assign(o, ravi, 'ACCEPTED', interval '11 minutes');
  UPDATE delivery_assignments SET picked_up_at = now() - interval '2 minutes' WHERE order_id = o;
  PERFORM pg_temp.mk(jsonb_build_object('customer',deepak,'listing',dosa,'type','TAKEAWAY','pm','CASH','ago','22 minutes','os','IN_PROGRESS','fs','READY','prep_ago','15 minutes',
    'events',jsonb_build_array(jsonb_build_object('a','ACCEPT_AND_START_PREP','m','Order accepted and preparation started','at_ago','15 minutes'),
                               jsonb_build_object('a','MARK_READY','m','Order marked ready for pickup — customer notified','at_ago','3 minutes'))));
  PERFORM pg_temp.mk(jsonb_build_object('customer',kavya,'listing',coffee,'qty',2,'type','DINE_IN','ago','9 minutes','os','IN_PROGRESS','fs','PREPARING','table','T2','prep_ago','5 minutes',
    'events',jsonb_build_array(jsonb_build_object('a','ACCEPT_AND_START_PREP','m','Order accepted and preparation started','at_ago','5 minutes'))));
  PERFORM pg_temp.mk(jsonb_build_object('customer',lakshmi,'listing',spa,'type','AT_PROVIDER_LOCATION','pm','CASH','ago','1 day','os','IN_PROGRESS','fs','IN_SERVICE',
    'start_in','-20 minutes','provider_confirmed',true,
    'events',jsonb_build_array(jsonb_build_object('a','AUTO_CONFIRM','m','Booking confirmed automatically','r','SYSTEM','n','System','after','1 second'),
                               jsonb_build_object('a','MARK_ATTENDED','m','Customer attendance recorded','r','SERVICE_PROVIDER','n','Priya S','at_ago','22 minutes'),
                               jsonb_build_object('a','START_SERVICE','m','Service started','r','SERVICE_PROVIDER','n','Priya S','at_ago','20 minutes'))));
  PERFORM pg_temp.mk(jsonb_build_object('customer',farhan,'listing',ac,'type','AT_CUSTOMER_LOCATION','ago','2 days','os','IN_PROGRESS','fs','PROVIDER_EN_ROUTE',
    'start_in','25 minutes','provider_confirmed',true,
    'events',jsonb_build_array(jsonb_build_object('a','ACCEPT','m','Booking confirmed','after','30 minutes'),
                               jsonb_build_object('a','CONFIRM_SCHEDULE','m','Schedule confirmed','after','2 minutes'),
                               jsonb_build_object('a','START_TRAVEL','m','Provider travelling to customer','r','SERVICE_PROVIDER','n','Karthik R','at_ago','8 minutes'))));

  -- ===== EXCEPTIONS =====
  o := pg_temp.mk(jsonb_build_object('customer',ram,'listing',hamper,'type','SCHEDULED_DELIVERY','ago','1 day','os','IN_PROGRESS','fs','DELIVERY_FAILED',
    'start_in','-90 minutes','distance',3.1,'failure_reason','Customer unavailable','failure_notes','Rang the bell and called twice, no response. Security says resident is out of town.',
    'events',jsonb_build_array(jsonb_build_object('a','ACCEPT','m','Order accepted','after','5 minutes'),
                               jsonb_build_object('a','START_PREPARATION','m','Preparation started','at_ago','3 hours'),
                               jsonb_build_object('a','MARK_READY','m','Order marked ready','at_ago','2 hours'),
                               jsonb_build_object('a','ASSIGN_AGENT','m','Delivery agent assigned manually','at_ago','119 minutes'),
                               jsonb_build_object('a','ACCEPT_DELIVERY','m','Delivery accepted by agent','r','DELIVERY_AGENT','n','Suresh M','at_ago','118 minutes'),
                               jsonb_build_object('a','CONFIRM_PICKUP','m','Parcel picked up by agent','r','DELIVERY_AGENT','n','Suresh M','at_ago','100 minutes'),
                               jsonb_build_object('a','START_DELIVERY','m','Out for delivery','r','DELIVERY_AGENT','n','Suresh M','at_ago','99 minutes'),
                               jsonb_build_object('a','MARK_DELIVERY_FAILED','m','Delivery failed','r','DELIVERY_AGENT','n','Suresh M','at_ago','35 minutes','reason','Customer unavailable'))));
  PERFORM pg_temp.assign(o, suresh, 'ACCEPTED', interval '119 minutes');
  UPDATE delivery_assignments SET picked_up_at = now() - interval '100 minutes' WHERE order_id = o;
  -- remove the slot link: this delivery window has passed
  UPDATE orders SET slot_id = NULL WHERE id = o;

  PERFORM pg_temp.mk(jsonb_build_object('customer',vignesh,'listing',consult,'type','CONSULTATION','ago','2 days','os','IN_PROGRESS','fs','NO_SHOW',
    'start_in','-26 hours','provider_confirmed',true,'failure_reason','Customer did not show up','failure_notes','Waited 20 minutes, phone switched off.',
    'events',jsonb_build_array(jsonb_build_object('a','CONFIRM_APPOINTMENT','m','Appointment confirmed by provider','r','SERVICE_PROVIDER','n','Meena V','after','20 minutes'),
                               jsonb_build_object('a','REPORT_CUSTOMER_UNAVAILABLE','m','Customer unavailable / missed appointment','r','SERVICE_PROVIDER','n','Meena V','at_ago','25 hours','reason','Customer did not show up'))));
  PERFORM pg_temp.mk(jsonb_build_object('customer',anitha,'listing',mug,'type','DELIVERY','ps','FAILED','ago','30 minutes','os','CONFIRMED','fs','AWAITING_PREPARATION','distance',5.3,
    'events',jsonb_build_array(jsonb_build_object('a','ACCEPT','m','Order accepted'),
                               jsonb_build_object('a','PAYMENT_FAILED','m','Payment failed','r','SYSTEM','n','Payments','reason','Bank declined: insufficient funds'))));
  -- customer asked to cancel while being prepared
  o := pg_temp.mk(jsonb_build_object('customer',farhan,'listing',mug,'type','DELIVERY','ago','14 minutes','os','IN_PROGRESS','fs','PREPARING','prep_ago','8 minutes','distance',7.9,
    'events',jsonb_build_array(jsonb_build_object('a','ACCEPT_AND_START_PREP','m','Order accepted and preparation started','at_ago','8 minutes'))));
  INSERT INTO order_requests (order_id, type, requested_by_role, requested_by_id, reason, created_at)
  VALUES (o, 'CANCELLATION', 'CUSTOMER', farhan, 'Ordered by mistake', now() - interval '3 minutes');
  INSERT INTO audit_logs (workspace_id, entity_type, entity_id, order_id, action, message, actor_role, actor_name, reason, created_at)
  VALUES ('11111111-1111-4111-8111-111111111111','ORDER',o,o,'CUSTOMER_REQUEST_CANCELLATION','Customer requested cancellation','CUSTOMER','Farhan A','Ordered by mistake', now() - interval '3 minutes');
  -- delivered order with a return request
  o := pg_temp.mk(jsonb_build_object('customer',prem,'listing',mug,'type','DELIVERY','ago','3 days','os','COMPLETED','fs','DELIVERED','delivered_by',ravi,'distance',8.6,
    'events',jsonb_build_array(jsonb_build_object('a','ACCEPT_AND_START_PREP','m','Order accepted and preparation started','after','3 minutes'),
                               jsonb_build_object('a','MARK_READY','m','Order marked ready','after','15 minutes'),
                               jsonb_build_object('a','MARK_DELIVERED','m','Delivered by agent','r','DELIVERY_AGENT','n','Ravi Kumar','after','35 minutes'))));
  PERFORM pg_temp.assign(o, ravi, 'COMPLETED', interval '3 days');
  INSERT INTO order_requests (order_id, type, requested_by_role, requested_by_id, reason, created_at)
  VALUES (o, 'RETURN', 'CUSTOMER', prem, 'Item arrived with a chipped handle', now() - interval '2 hours');
  INSERT INTO audit_logs (workspace_id, entity_type, entity_id, order_id, action, message, actor_role, actor_name, reason, created_at)
  VALUES ('11111111-1111-4111-8111-111111111111','ORDER',o,o,'CUSTOMER_REQUEST_RETURN','Customer requested a return','CUSTOMER','Prem Kumar S','Item arrived with a chipped handle', now() - interval '2 hours');

  -- ===== COD & settlement =====
  -- (a) cash still with Ravi
  o := pg_temp.mk(jsonb_build_object('customer',kavya,'listing',mug,'type','DELIVERY','pm','CASH','ps','PAID','cod','COLLECTED','cod_collected',99800,'ago','5 hours','os','COMPLETED','fs','DELIVERED','delivered_by',ravi,'distance',9.4,
    'events',jsonb_build_array(jsonb_build_object('a','ACCEPT_AND_START_PREP','m','Order accepted and preparation started','after','2 minutes'),
                               jsonb_build_object('a','MARK_READY','m','Order marked ready','after','15 minutes'),
                               jsonb_build_object('a','MARK_DELIVERED','m','Delivered by agent','r','DELIVERY_AGENT','n','Ravi Kumar','after','40 minutes'),
                               jsonb_build_object('a','RECORD_COD_COLLECTED','m','COD collection recorded (₹998.00)','r','DELIVERY_AGENT','n','Ravi Kumar','after','1 minute'))));
  PERFORM pg_temp.assign(o, ravi, 'COMPLETED', interval '5 hours');
  INSERT INTO cod_collections (order_id, agent_id, amount_paise, collected_by_user_id, collected_at) VALUES (o, ravi, 99800, ravi, now() - interval '4 hours');
  o := pg_temp.mk(jsonb_build_object('customer',vignesh,'listing',coffee,'qty',4,'type','DELIVERY','pm','CASH','ps','PAID','cod','COLLECTED','cod_collected',24000,'ago','3 hours','os','COMPLETED','fs','DELIVERED','delivered_by',ravi,'distance',2.2,
    'events',jsonb_build_array(jsonb_build_object('a','ACCEPT_AND_START_PREP','m','Order accepted and preparation started','after','1 minute'),
                               jsonb_build_object('a','MARK_DELIVERED','m','Delivered by agent','r','DELIVERY_AGENT','n','Ravi Kumar','after','30 minutes'),
                               jsonb_build_object('a','RECORD_COD_COLLECTED','m','COD collection recorded (₹240.00)','r','DELIVERY_AGENT','n','Ravi Kumar','after','1 minute'))));
  PERFORM pg_temp.assign(o, ravi, 'COMPLETED', interval '3 hours');
  INSERT INTO cod_collections (order_id, agent_id, amount_paise, collected_by_user_id, collected_at) VALUES (o, ravi, 24000, ravi, now() - interval '2 hours 20 minutes');

  -- (b) Suresh submitted a handover that awaits verification
  INSERT INTO cash_handovers (id, workspace_id, agent_id, status, expected_paise, declared_paise, agent_note, submitted_at)
  VALUES ('d0000000-0000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111', suresh, 'SUBMITTED', 145000, 145000, 'End of morning shift', now() - interval '40 minutes');
  o := pg_temp.mk(jsonb_build_object('customer',deepak,'listing',planter,'type','DELIVERY','pm','CASH','ps','PAID','cod','HANDOVER_SUBMITTED','cod_collected',145000,'ago','1 day','os','COMPLETED','fs','DELIVERED','delivered_by',suresh,'distance',6.4,
    'events',jsonb_build_array(jsonb_build_object('a','ACCEPT_AND_START_PREP','m','Order accepted and preparation started','after','2 minutes'),
                               jsonb_build_object('a','MARK_DELIVERED','m','Delivered by agent','r','DELIVERY_AGENT','n','Suresh M','after','50 minutes'),
                               jsonb_build_object('a','RECORD_COD_COLLECTED','m','COD collection recorded (₹1,450.00)','r','DELIVERY_AGENT','n','Suresh M','after','1 minute'),
                               jsonb_build_object('a','SUBMIT_CASH_HANDOVER','m','Cash handover submitted','r','DELIVERY_AGENT','n','Suresh M','at_ago','40 minutes'))));
  PERFORM pg_temp.assign(o, suresh, 'COMPLETED', interval '1 day');
  INSERT INTO cod_collections (order_id, agent_id, amount_paise, collected_by_user_id, collected_at, handover_id)
  VALUES (o, suresh, 145000, suresh, now() - interval '23 hours', 'd0000000-0000-4000-8000-000000000001');

  -- (c) Ravi's earlier handover with a discrepancy (₹100 short)
  INSERT INTO cash_handovers (id, workspace_id, agent_id, status, expected_paise, declared_paise, received_paise, agent_note, discrepancy_reason, submitted_at, verified_by, verified_at)
  VALUES ('d0000000-0000-4000-8000-000000000002','11111111-1111-4111-8111-111111111111', ravi, 'DISCREPANCY', 99800, 99800, 89800, null,
          'Counted ₹898 — ₹100 short against the collected amount', now() - interval '1 day 2 hours', admin, now() - interval '1 day 1 hour');
  o := pg_temp.mk(jsonb_build_object('customer',lakshmi,'listing',mug,'type','DELIVERY','pm','CASH','ps','PAID','cod','DISCREPANCY','cod_collected',99800,'ago','2 days','os','COMPLETED','fs','DELIVERED','delivered_by',ravi,'distance',4.8,
    'events',jsonb_build_array(jsonb_build_object('a','ACCEPT_AND_START_PREP','m','Order accepted and preparation started','after','2 minutes'),
                               jsonb_build_object('a','MARK_DELIVERED','m','Delivered by agent','r','DELIVERY_AGENT','n','Ravi Kumar','after','45 minutes'),
                               jsonb_build_object('a','RECORD_COD_COLLECTED','m','COD collection recorded (₹998.00)','r','DELIVERY_AGENT','n','Ravi Kumar','after','1 minute'),
                               jsonb_build_object('a','RECORD_DISCREPANCY','m','Cash handover discrepancy recorded','at_ago','25 hours','reason','Counted ₹898 — ₹100 short against the collected amount'))));
  PERFORM pg_temp.assign(o, ravi, 'COMPLETED', interval '2 days');
  INSERT INTO cod_collections (order_id, agent_id, amount_paise, collected_by_user_id, collected_at, handover_id)
  VALUES (o, ravi, 99800, ravi, now() - interval '47 hours', 'd0000000-0000-4000-8000-000000000002');

  -- ===== COMPLETED / CANCELLED history =====
  PERFORM pg_temp.mk(jsonb_build_object('customer',lakshmi,'listing',mug,'type','TAKEAWAY','ago','1 day','os','COMPLETED','fs','COLLECTED',
    'events',jsonb_build_array(jsonb_build_object('a','ACCEPT_AND_START_PREP','m','Order accepted and preparation started'),
                               jsonb_build_object('a','MARK_READY','m','Order marked ready for pickup','after','14 minutes'),
                               jsonb_build_object('a','CONFIRM_PICKUP_HANDOVER','m','Order collected by customer','after','25 minutes'))));
  o := pg_temp.mk(jsonb_build_object('customer',vignesh,'listing',spa,'type','AT_PROVIDER_LOCATION','pm','CASH','ps','PAID','cod','SETTLED','cod_collected',180000,'ago','2 days','os','COMPLETED','fs','SERVICE_COMPLETED','start_in','-26 hours',
    'events',jsonb_build_array(jsonb_build_object('a','AUTO_CONFIRM','m','Booking confirmed automatically','r','SYSTEM','n','System','after','1 second'),
                               jsonb_build_object('a','MARK_ATTENDED','m','Customer attendance recorded','r','SERVICE_PROVIDER','n','Priya S','at_ago','26 hours'),
                               jsonb_build_object('a','START_SERVICE','m','Service started','r','SERVICE_PROVIDER','n','Priya S','at_ago','26 hours'),
                               jsonb_build_object('a','MARK_SERVICE_COMPLETED','m','Service marked completed by provider','r','SERVICE_PROVIDER','n','Priya S','at_ago','25 hours'))));
  INSERT INTO cod_collections (order_id, agent_id, amount_paise, collected_by_user_id, collected_at, settled) VALUES (o, NULL, 180000, 'a0000000-0000-4000-8000-000000000005', now() - interval '25 hours', true);
  PERFORM pg_temp.mk(jsonb_build_object('customer',farhan,'listing',online,'type','ONLINE','ago','3 days','os','COMPLETED','fs','SERVICE_COMPLETED','start_in','-50 hours',
    'events',jsonb_build_array(jsonb_build_object('a','AUTO_CONFIRM','m','Booking confirmed automatically','r','SYSTEM','n','System','after','1 second'),
                               jsonb_build_object('a','START_SERVICE','m','Service started','r','SERVICE_PROVIDER','n','Meena V','at_ago','50 hours'),
                               jsonb_build_object('a','MARK_SERVICE_COMPLETED','m','Service marked completed by provider','r','SERVICE_PROVIDER','n','Meena V','at_ago','49 hours'))));
  PERFORM pg_temp.mk(jsonb_build_object('customer',prem,'listing',consult,'type','CONSULTATION','ago','1 day','os','CANCELLED','fs','CANCELLED','refund','PENDING',
    'start_in','2 days','cancel_reason','Ordered by mistake',
    'events',jsonb_build_array(jsonb_build_object('a','ACCEPT','m','Booking confirmed','after','10 minutes'),
                               jsonb_build_object('a','CUSTOMER_REQUEST_CANCELLATION','m','Customer requested cancellation','r','CUSTOMER','n','Prem Kumar S','at_ago','5 hours','reason','Ordered by mistake'),
                               jsonb_build_object('a','CONFIRM_CANCELLATION','m','Customer cancellation approved','at_ago','4 hours','reason','Ordered by mistake'))));
  PERFORM pg_temp.mk(jsonb_build_object('customer',deepak,'listing',mug,'type','DELIVERY','ago','2 days','os','REJECTED','fs','CANCELLED','refund','REFUNDED','distance',18.5,
    'reject_reason','Address is outside our 15 km delivery radius',
    'events',jsonb_build_array(jsonb_build_object('a','REJECT','m','Order rejected','after','4 minutes','reason','Address is outside our 15 km delivery radius'),
                               jsonb_build_object('a','UPDATE_REFUND_STATUS','m','Refund marked refunded','after','3 hours'))));
END $$;

-- a few unread admin notifications
INSERT INTO notifications (workspace_id, audience, order_id, title, body, created_at)
SELECT o.workspace_id, 'ADMIN', o.id,
       CASE o.exception WHEN 'DELIVERY_FAILED' THEN 'Delivery failed' WHEN 'CANCELLATION_REQUESTED' THEN 'Cancellation requested'
                        WHEN 'RETURN_REQUESTED' THEN 'Return requested' WHEN 'NO_SHOW' THEN 'Customer missed appointment'
                        WHEN 'PAYMENT_FAILED' THEN 'Payment failed' WHEN 'RESCHEDULE_REQUESTED' THEN 'Reschedule requested' ELSE 'Needs attention' END,
       o.code, now() - interval '3 minutes'
FROM orders o WHERE o.exception IS NOT NULL AND o.exception NOT IN ('REFUND_PENDING');
INSERT INTO notifications (workspace_id, audience, recipient_user_id, order_id, title, body, created_at)
SELECT o.workspace_id, 'AGENT', a.agent_id, o.id, 'New delivery offer', o.code || ' · ' || coalesce(o.distance_km::text, '—') || ' km', a.offered_at
FROM delivery_assignments a JOIN orders o ON o.id = a.order_id WHERE a.status = 'OFFERED';

COMMIT;

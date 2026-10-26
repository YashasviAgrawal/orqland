-- Derived order state maintained by the database so it is always consistent,
-- whichever service writes to the table (API, jobs, future platform integration).
--
--   orders.exception  – exception code used by the dashboard "Exceptions" card & filter
--   orders.version    – optimistic-locking counter, incremented on every update
--   orders.updated_at – last change
--
-- Mirrors computeException() in src/domain/engine.ts (unit-tested there).

CREATE OR REPLACE FUNCTION order_exception(o orders) RETURNS text
LANGUAGE plpgsql STABLE AS $$
DECLARE
  active boolean := o.order_status NOT IN ('COMPLETED','CANCELLED','REJECTED');
  req text;
BEGIN
  IF o.cod_status = 'DISCREPANCY' THEN RETURN 'COD_DISCREPANCY'; END IF;
  IF o.fulfilment_status = 'RETURNING' THEN RETURN 'RETURNING'; END IF;
  IF o.fulfilment_status = 'RETURNED_TO_WORKSPACE' AND o.return_confirmed_at IS NULL THEN RETURN 'RETURN_TO_CONFIRM'; END IF;
  IF active AND o.fulfilment_status IN ('DELIVERY_FAILED','RETURNED_TO_WORKSPACE','NO_SHOW','PROVIDER_UNAVAILABLE','SERVICE_FAILED') THEN
    RETURN o.fulfilment_status;
  END IF;
  IF o.fulfilment_status = 'RETURN_APPROVED' THEN RETURN 'RETURN_IN_PROGRESS'; END IF;
  SELECT r.type || '_REQUESTED' INTO req FROM order_requests r
    WHERE r.order_id = o.id AND r.status = 'PENDING' ORDER BY r.created_at LIMIT 1;
  IF req IS NOT NULL THEN RETURN req; END IF;
  IF active AND o.payment_status = 'FAILED' THEN RETURN 'PAYMENT_FAILED'; END IF;
  IF o.refund_status = 'FAILED' THEN RETURN 'REFUND_FAILED'; END IF;
  IF o.refund_status = 'PENDING' THEN RETURN 'REFUND_PENDING'; END IF;
  IF o.cod_status = 'COLLECTED' AND o.payment_status <> 'PAID' THEN RETURN 'COD_SHORT_COLLECTED'; END IF;
  IF o.fulfilment_status IN ('DELIVERED','COLLECTED','SERVED','SERVICE_COMPLETED')
     AND o.payment_status <> 'PAID' AND o.order_status <> 'CANCELLED' THEN
    RETURN 'PAYMENT_PENDING';
  END IF;
  RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION orders_before_write() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.exception := order_exception(NEW);
  IF TG_OP = 'UPDATE' THEN
    NEW.updated_at := now();
    NEW.version := OLD.version + 1;
    -- Safety net (§7): terminal orders cannot move back into an active lifecycle.
    IF OLD.order_status IN ('CANCELLED','REJECTED') AND NEW.order_status <> OLD.order_status THEN
      RAISE EXCEPTION 'Order % is % and cannot change status', OLD.code, OLD.order_status
        USING ERRCODE = 'check_violation';
    END IF;
    IF OLD.order_status = 'COMPLETED' AND NEW.order_status NOT IN ('COMPLETED') THEN
      RAISE EXCEPTION 'Order % is completed and cannot change status', OLD.code
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER orders_before_write
  BEFORE INSERT OR UPDATE ON orders
  FOR EACH ROW EXECUTE FUNCTION orders_before_write();

-- Requests affect the exception flag → touch the parent order so it is recomputed.
CREATE OR REPLACE FUNCTION order_requests_touch_order() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE orders SET updated_at = now() WHERE id = NEW.order_id;
  RETURN NEW;
END $$;

CREATE TRIGGER order_requests_touch_order
  AFTER INSERT OR UPDATE ON order_requests
  FOR EACH ROW EXECUTE FUNCTION order_requests_touch_order();

import { Injectable } from '@nestjs/common';
import { DatabaseService, Db } from '../database/database.service';
import { AuditService } from '../database/audit.service';
import { NotificationsService, NewNotification } from '../notifications/notifications.service';
import { badRequest, conflict, notFound } from '../common/errors';
import type { AuthUser } from '../common/auth/auth.types';
import { workflowOf } from '../domain/workflows';
import { FulfilmentType, ONLINE_METHODS, PaymentMethod } from '../domain/enums';

export interface CreateOrderInput {
  customerId?: string;
  customer?: { name: string; phone: string; email?: string; address?: string };
  fulfilmentType: FulfilmentType;
  items: Array<{ listingId: string; quantity: number }>;
  paymentMethod: PaymentMethod;
  slotId?: string;
  scheduledStart?: string;
  deliveryAddress?: string;
  deliveryLat?: number;
  deliveryLng?: number;
  note?: string;
  tableNumber?: string;
  eventDetails?: { venue?: string; guests?: number; occasion?: string; requirements?: string };
}

interface ListingRow {
  id: string;
  kind: 'PRODUCT' | 'SERVICE';
  name: string;
  price_paise: number;
  fulfilment_types: string[];
  booking_mode: 'INSTANT' | 'SLOT';
  auto_confirm: boolean;
  prep_minutes: number;
  duration_minutes: number;
  instant_capacity: number;
  stock: number | null;
  default_provider_id: string | null;
  default_meeting_link: string | null;
  is_active: boolean;
}

/**
 * Order / booking creation with availability, capacity, stock and duplicate validation (§3).
 * In production the main Orqland checkout calls POST /orders (see integration guide);
 * in the standalone demo the customer simulator does.
 */
@Injectable()
export class OrderCreationService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  async create(actor: AuthUser, input: CreateOrderInput, idempotencyKey?: string): Promise<{ id: string; code: string; duplicate: boolean }> {
    const notes: NewNotification[] = [];
    const result = await this.db.tx(async (tx) => {
      // ---- duplicate request protection
      if (idempotencyKey) {
        const dup = await tx.query<{ id: string; code: string }>('SELECT id, code FROM orders WHERE workspace_id = $1 AND idempotency_key = $2', [actor.workspaceId, idempotencyKey]);
        if (dup.rows[0]) return { ...dup.rows[0], duplicate: true };
      }

      const wf = workflowOf(input.fulfilmentType);
      if (!input.items?.length) throw badRequest('Add at least one item.');
      if (input.items.length > 20) throw badRequest('Too many items in one order.');

      // ---- workspace open?
      const ws = (await tx.query<{ is_open: boolean; lat: number | null; lng: number | null }>('SELECT is_open, lat, lng FROM workspaces WHERE id = $1', [actor.workspaceId])).rows[0];
      if (!ws) throw notFound('Workspace');
      if (!ws.is_open && !wf.scheduled) throw conflict('WORKSPACE_CLOSED', 'The business is not accepting instant orders right now.');

      // ---- listings
      const ids = input.items.map((i) => i.listingId);
      const listings = (await tx.query<ListingRow>('SELECT * FROM listings WHERE id = ANY($1::uuid[]) AND workspace_id = $2', [ids, actor.workspaceId])).rows;
      const byId = new Map(listings.map((l) => [l.id, l]));
      for (const it of input.items) {
        const l = byId.get(it.listingId);
        if (!l || !l.is_active) throw badRequest('One of the items is no longer available.');
        if (!Number.isInteger(it.quantity) || it.quantity < 1 || it.quantity > 50) throw badRequest(`Invalid quantity for ${l.name}.`);
        if (l.kind !== wf.kind) throw badRequest(`${l.name} cannot be booked as “${wf.label}”.`);
        if (!l.fulfilment_types.includes(input.fulfilmentType)) throw badRequest(`${l.name} does not offer “${wf.label}”.`);
      }
      if (wf.kind === 'SERVICE' && input.items.length > 1) throw badRequest('Book one service at a time.');
      const primary = byId.get(input.items[0].listingId)!;

      // ---- customer
      const customerId = await this.resolveCustomer(tx, actor.workspaceId, input);
      const customer = (await tx.query<{ name: string; default_address: string | null }>('SELECT name, default_address FROM customers WHERE id = $1', [customerId])).rows[0];

      // ---- address
      const address =
        input.fulfilmentType === 'EVENT'
          ? input.eventDetails?.venue?.trim() || null
          : input.deliveryAddress?.trim() || (wf.requiresCustomerAddress ? customer.default_address : null) || null;
      if (wf.requiresCustomerAddress && !address && input.fulfilmentType !== 'EVENT') throw badRequest('A delivery / service address is required.');
      if (input.fulfilmentType === 'EVENT' && !input.eventDetails?.venue?.trim()) throw badRequest('Event venue is required.');

      // ---- stock (atomic decrement — never oversell)
      for (const it of input.items) {
        const l = byId.get(it.listingId)!;
        if (l.kind !== 'PRODUCT' || l.stock === null) continue;
        const r = await tx.query('UPDATE listings SET stock = stock - $2 WHERE id = $1 AND stock >= $2 RETURNING stock', [l.id, it.quantity]);
        if (!r.rowCount) throw conflict('OUT_OF_STOCK', `${l.name} is out of stock${l.stock > 0 ? ` (only ${l.stock} left)` : ''}.`);
      }

      // ---- schedule & capacity (§3 Instant / Slot-based booking)
      const seats = input.fulfilmentType === 'WORKSHOP' ? input.items[0].quantity : 1;
      let slotId: string | null = null;
      let start: string | null = null;
      let end: string | null = null;
      let providerId: string | null = wf.kind === 'SERVICE' ? primary.default_provider_id : null;
      let bookingMode: 'INSTANT' | 'SLOT' = 'INSTANT';

      if (wf.scheduled) {
        if (input.slotId) {
          const s = (
            await tx.query<{ id: string; kind: string; listing_id: string | null; provider_id: string | null; starts_at: Date; ends_at: Date; status: string; capacity: number; reserved: number }>(
              'SELECT * FROM slots WHERE id = $1 AND workspace_id = $2 FOR UPDATE',
              [input.slotId, actor.workspaceId],
            )
          ).rows[0];
          if (!s) throw notFound('Slot');
          if (s.kind !== wf.slotKind) throw badRequest('That slot cannot be used for this fulfilment type.');
          if (s.listing_id && s.listing_id !== primary.id) throw badRequest('That slot belongs to a different listing.');
          if (s.status !== 'OPEN') throw conflict('SLOT_CLOSED', 'That slot is no longer open.');
          if (new Date(s.starts_at).getTime() <= Date.now()) throw badRequest('That slot has already started.');
          const reserved = await tx.query('UPDATE slots SET reserved = reserved + $2 WHERE id = $1 AND reserved + $2 <= capacity RETURNING id', [s.id, seats]);
          if (!reserved.rowCount) {
            const left = s.capacity - s.reserved;
            throw conflict('CAPACITY_EXCEEDED', left > 0 ? `Only ${left} ${input.fulfilmentType === 'WORKSHOP' ? 'seat(s)' : 'place(s)'} left in this slot.` : 'This slot is fully booked.');
          }
          slotId = s.id;
          start = new Date(s.starts_at).toISOString();
          end = new Date(s.ends_at).toISOString();
          providerId = s.provider_id ?? providerId;
          bookingMode = 'SLOT';
        } else if (input.fulfilmentType === 'EVENT') {
          if (!input.scheduledStart || Number.isNaN(Date.parse(input.scheduledStart))) throw badRequest('Choose the event date & time.');
          if (Date.parse(input.scheduledStart) <= Date.now()) throw badRequest('The event date must be in the future.');
          start = new Date(input.scheduledStart).toISOString();
          end = new Date(Date.parse(start) + primary.duration_minutes * 60_000).toISOString();
          bookingMode = 'SLOT';
        } else if (wf.kind === 'SERVICE' && primary.booking_mode === 'INSTANT') {
          // instant booking: starts now, validated against concurrent capacity
          const now = new Date();
          now.setSeconds(0, 0);
          start = now.toISOString();
          end = new Date(now.getTime() + primary.duration_minutes * 60_000).toISOString();
          const busy = await tx.query<{ n: number }>(
            `SELECT count(*)::int AS n FROM orders o JOIN order_items i ON i.order_id = o.id
             WHERE i.listing_id = $1 AND o.order_status IN ('PENDING_REVIEW','CONFIRMED','IN_PROGRESS')
               AND tstzrange(o.scheduled_start, o.scheduled_end) && tstzrange($2::timestamptz, $3::timestamptz)`,
            [primary.id, start, end],
          );
          if ((busy.rows[0]?.n ?? 0) >= primary.instant_capacity) throw conflict('CAPACITY_EXCEEDED', 'Fully booked right now — please choose a slot.');
        } else {
          throw badRequest('Choose an available slot.');
        }
      }

      // ---- payment
      if (!['CASH', ...ONLINE_METHODS].includes(input.paymentMethod)) throw badRequest('Unsupported payment method.');
      const cash = input.paymentMethod === 'CASH';

      // ---- review / auto-confirm
      const autoConfirm = !wf.alwaysReview && input.items.every((i) => byId.get(i.listingId)!.auto_confirm);
      const orderStatus = autoConfirm ? 'CONFIRMED' : 'PENDING_REVIEW';
      const fulfilmentStatus = !autoConfirm
        ? 'NOT_STARTED'
        : wf.kind === 'PRODUCT'
          ? wf.scheduled
            ? 'SCHEDULED'
            : 'AWAITING_PREPARATION'
          : wf.scheduleConfirmation
            ? 'AWAITING_SCHEDULE'
            : 'SCHEDULED';

      const subtotal = input.items.reduce((sum, i) => sum + byId.get(i.listingId)!.price_paise * i.quantity, 0);
      const prepMinutes = wf.preparation ? Math.max(...input.items.map((i) => byId.get(i.listingId)!.prep_minutes)) : 0;
      const distance =
        input.deliveryLat !== undefined && input.deliveryLng !== undefined && ws.lat !== null && ws.lng !== null
          ? haversineKm(ws.lat, ws.lng, input.deliveryLat, input.deliveryLng)
          : null;

      const ins = await tx.query<{ id: string; code: string }>(
        `INSERT INTO orders (workspace_id, customer_id, kind, fulfilment_type, booking_mode, order_status, fulfilment_status,
           payment_status, payment_method, cod_status, subtotal_paise, total_paise, slot_id, seats, scheduled_start, scheduled_end,
           delivery_address, delivery_lat, delivery_lng, distance_km, customer_note, table_number, event_details, provider_id,
           blocks_provider, meeting_link, prep_minutes, idempotency_key)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'PENDING',$8,$9,$10,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26)
         RETURNING id, code`,
        [
          actor.workspaceId,
          customerId,
          wf.kind,
          input.fulfilmentType,
          bookingMode,
          orderStatus,
          fulfilmentStatus,
          input.paymentMethod,
          cash ? 'PENDING_COLLECTION' : 'NOT_APPLICABLE',
          subtotal,
          slotId,
          seats,
          start,
          end,
          address,
          input.deliveryLat ?? null,
          input.deliveryLng ?? null,
          distance,
          input.note?.trim() || null,
          wf.type === 'DINE_IN' ? input.tableNumber?.trim() || null : null,
          input.fulfilmentType === 'EVENT' ? JSON.stringify(input.eventDetails ?? {}) : null,
          providerId,
          wf.providerConflict && !!providerId && !!start,
          wf.online && autoConfirm ? primary.default_meeting_link : null,
          prepMinutes,
          idempotencyKey ?? null,
        ],
      );
      const order = ins.rows[0];

      for (const it of input.items) {
        const l = byId.get(it.listingId)!;
        await tx.query(
          'INSERT INTO order_items (order_id, listing_id, name, quantity, unit_price_paise, total_paise) VALUES ($1,$2,$3,$4,$5,$6)',
          [order.id, l.id, l.name, it.quantity, l.price_paise, l.price_paise * it.quantity],
        );
      }
      if (!cash) {
        await tx.query(
          `INSERT INTO payments (order_id, attempt, method, amount_paise, status, provider) VALUES ($1, 1, $2, $3, 'PENDING', 'sample')`,
          [order.id, input.paymentMethod, subtotal],
        );
      }

      await this.audit.log(tx, {
        workspaceId: actor.workspaceId,
        entityType: 'ORDER',
        entityId: order.id,
        orderId: order.id,
        action: 'ORDER_PLACED',
        message: wf.kind === 'PRODUCT' ? 'Order placed by customer' : 'Booking placed by customer',
        actor: actor.role === 'CUSTOMER' ? { id: customerId, role: 'CUSTOMER', name: customer.name } : actor,
        toState: { orderStatus: 'PENDING_REVIEW', fulfilmentStatus: 'NOT_STARTED', paymentStatus: 'PENDING' },
        data: { slotId, seats, scheduledStart: start },
      });
      if (autoConfirm) {
        await this.audit.log(tx, {
          workspaceId: actor.workspaceId,
          entityType: 'ORDER',
          entityId: order.id,
          orderId: order.id,
          action: 'AUTO_CONFIRM',
          message: `${wf.kind === 'PRODUCT' ? 'Order' : 'Booking'} confirmed automatically (listing set to instant confirmation)${seats > 1 ? ` — ${seats} seats reserved` : ''}`,
          actor: { id: 'system', role: 'SYSTEM', name: 'System' },
          fromState: { orderStatus: 'PENDING_REVIEW' },
          toState: { orderStatus, fulfilmentStatus },
        });
      }

      const noun = wf.kind === 'PRODUCT' ? 'order' : 'booking';
      notes.push(
        await this.notifications.create(tx, {
          workspaceId: actor.workspaceId,
          audience: 'ADMIN',
          orderId: order.id,
          title: autoConfirm ? `New ${noun} confirmed` : `New ${noun} to review`,
          body: `${order.code} · ${customer.name} · ${wf.label}`,
        }),
        await this.notifications.create(tx, {
          workspaceId: actor.workspaceId,
          audience: 'CUSTOMER',
          recipientCustomerId: customerId,
          orderId: order.id,
          title: autoConfirm ? `${capitalize(noun)} confirmed` : `${capitalize(noun)} received`,
          body: `${order.code} · we will keep you updated.`,
        }),
      );
      if (autoConfirm && providerId) {
        notes.push(
          await this.notifications.create(tx, {
            workspaceId: actor.workspaceId,
            audience: 'PROVIDER',
            recipientUserId: providerId,
            orderId: order.id,
            title: 'New booking assigned',
            body: `${order.code} · ${customer.name}`,
          }),
        );
      }
      return { ...order, duplicate: false };
    });
    this.notifications.dispatch(notes);
    return result;
  }

  private async resolveCustomer(tx: Db, workspaceId: string, input: CreateOrderInput): Promise<string> {
    if (input.customerId) {
      const r = await tx.query<{ id: string }>('SELECT id FROM customers WHERE id = $1 AND workspace_id = $2', [input.customerId, workspaceId]);
      if (!r.rows[0]) throw badRequest('Unknown customer.');
      return r.rows[0].id;
    }
    const c = input.customer;
    if (!c?.name?.trim() || !c.phone?.trim()) throw badRequest('Customer name and phone are required.');
    const existing = await tx.query<{ id: string }>('SELECT id FROM customers WHERE workspace_id = $1 AND phone = $2 LIMIT 1', [workspaceId, c.phone.trim()]);
    if (existing.rows[0]) return existing.rows[0].id;
    const created = await tx.query<{ id: string }>(
      'INSERT INTO customers (workspace_id, name, phone, email, default_address) VALUES ($1,$2,$3,$4,$5) RETURNING id',
      [workspaceId, c.name.trim(), c.phone.trim(), c.email ?? null, c.address ?? null],
    );
    return created.rows[0].id;
  }
}

function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)) * 10) / 10;
}

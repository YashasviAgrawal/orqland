import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { AuditService } from '../database/audit.service';
import { OrderActionsService } from '../orders/order-actions.service';
import { badRequest, conflict, notFound } from '../common/errors';
import type { AuthUser } from '../common/auth/auth.types';
import { SlotKind } from '../domain/enums';

interface SlotRow {
  id: string;
  listing_id: string | null;
  listing_name: string | null;
  kind: SlotKind;
  provider_id: string | null;
  provider_name: string | null;
  title: string | null;
  starts_at: Date;
  ends_at: Date;
  capacity: number;
  reserved: number;
  status: 'OPEN' | 'CLOSED' | 'COMPLETED';
  bookings: number;
}

const toSlot = (r: SlotRow) => ({
  id: r.id,
  listingId: r.listing_id,
  listingName: r.listing_name,
  kind: r.kind,
  providerId: r.provider_id,
  providerName: r.provider_name,
  title: r.title,
  startsAt: new Date(r.starts_at).toISOString(),
  endsAt: new Date(r.ends_at).toISOString(),
  capacity: r.capacity,
  reserved: r.reserved,
  remaining: Math.max(r.capacity - r.reserved, 0),
  status: r.status,
  bookings: r.bookings,
  isPast: new Date(r.starts_at).getTime() <= Date.now(),
});

const SLOT_SELECT = `
SELECT s.*, l.name AS listing_name, u.name AS provider_name,
  (SELECT count(*)::int FROM orders o WHERE o.slot_id = s.id AND o.order_status NOT IN ('CANCELLED','REJECTED')) AS bookings
FROM slots s LEFT JOIN listings l ON l.id = s.listing_id LEFT JOIN users u ON u.id = s.provider_id`;

/** Availability, capacity and session management (§3, §6 "View Availability", "Manage Capacity"). */
@Injectable()
export class ScheduleService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly actions: OrderActionsService,
  ) {}

  async listSlots(user: AuthUser, f: { from?: string; to?: string; listingId?: string; kind?: string; onlyAvailable?: boolean }) {
    const params: unknown[] = [user.workspaceId];
    const where = ['s.workspace_id = $1'];
    const from = f.from ? new Date(f.from) : startOfTodayIST();
    const to = f.to ? new Date(f.to) : new Date(from.getTime() + 7 * 86400_000);
    params.push(from.toISOString(), to.toISOString());
    where.push(`s.starts_at >= $2 AND s.starts_at < $3`);
    if (f.listingId) {
      params.push(f.listingId);
      where.push(`(s.listing_id = $${params.length} OR (s.listing_id IS NULL AND s.kind IN ('DELIVERY','PICKUP')))`);
    }
    if (f.kind) {
      params.push(f.kind.split(','));
      where.push(`s.kind = ANY($${params.length}::text[])`);
    }
    if (user.role === 'SERVICE_PROVIDER') {
      params.push(user.id);
      where.push(`s.provider_id = $${params.length}`);
    }
    if (f.onlyAvailable) where.push(`s.status = 'OPEN' AND s.reserved < s.capacity AND s.starts_at > now()`);
    const rows = await this.db.query<SlotRow>(`${SLOT_SELECT} WHERE ${where.join(' AND ')} ORDER BY s.starts_at, l.name NULLS FIRST LIMIT 1000`, params);
    return rows.map(toSlot);
  }

  /** Slot detail with attendees / bookings (workshop attendee list etc.). */
  async slot(user: AuthUser, id: string) {
    const row = await this.db.one<SlotRow>(`${SLOT_SELECT} WHERE s.id = $1 AND s.workspace_id = $2`, [id, user.workspaceId]);
    if (!row) throw notFound('Slot');
    const bookings = await this.db.query<{ id: string; code: string; customer_name: string; customer_phone: string; seats: number; order_status: string; fulfilment_status: string; payment_status: string }>(
      `SELECT o.id, o.code, c.name AS customer_name, c.phone AS customer_phone, o.seats, o.order_status, o.fulfilment_status, o.payment_status
       FROM orders o JOIN customers c ON c.id = o.customer_id WHERE o.slot_id = $1 ORDER BY o.created_at`,
      [id],
    );
    return {
      ...toSlot(row),
      attendees: bookings.map((b) => ({
        orderId: b.id,
        code: b.code,
        customerName: b.customer_name,
        customerPhone: b.customer_phone,
        seats: b.seats,
        orderStatus: b.order_status,
        fulfilmentStatus: b.fulfilment_status,
        paymentStatus: b.payment_status,
      })),
    };
  }

  async createSlot(user: AuthUser, dto: { listingId?: string | null; kind: SlotKind; providerId?: string | null; startsAt: string; endsAt: string; capacity: number; title?: string }) {
    const s = new Date(dto.startsAt);
    const e = new Date(dto.endsAt);
    if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime()) || e <= s) throw badRequest('End time must be after start time.');
    if (s.getTime() < Date.now()) throw badRequest('Slots must start in the future.');
    if (!Number.isInteger(dto.capacity) || dto.capacity < 1 || dto.capacity > 500) throw badRequest('Capacity must be between 1 and 500.');
    if ((dto.kind === 'SERVICE' || dto.kind === 'WORKSHOP_SESSION') && !dto.listingId) throw badRequest('Choose the service for this slot.');
    return this.db.tx(async (tx) => {
      const r = await tx.query<{ id: string }>(
        `INSERT INTO slots (workspace_id, listing_id, kind, provider_id, title, starts_at, ends_at, capacity)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
        [user.workspaceId, dto.listingId ?? null, dto.kind, dto.providerId ?? null, dto.title ?? null, s.toISOString(), e.toISOString(), dto.capacity],
      );
      await this.audit.log(tx, {
        workspaceId: user.workspaceId,
        entityType: 'SLOT',
        entityId: r.rows[0].id,
        action: 'SLOT_CREATED',
        message: `Slot created with capacity ${dto.capacity}`,
        actor: user,
        data: { ...dto },
      });
      return r.rows[0];
    });
  }

  /** Manage capacity / open-close a slot. Capacity can never drop below confirmed bookings. */
  async updateSlot(user: AuthUser, id: string, dto: { capacity?: number; status?: 'OPEN' | 'CLOSED'; reason?: string }) {
    return this.db.tx(async (tx) => {
      const cur = (await tx.query<{ capacity: number; reserved: number; status: string }>('SELECT capacity, reserved, status FROM slots WHERE id = $1 AND workspace_id = $2 FOR UPDATE', [id, user.workspaceId])).rows[0];
      if (!cur) throw notFound('Slot');
      if (dto.capacity !== undefined) {
        if (!Number.isInteger(dto.capacity) || dto.capacity < 1 || dto.capacity > 500) throw badRequest('Capacity must be between 1 and 500.');
        if (dto.capacity < cur.reserved) {
          throw conflict('CAPACITY_BELOW_BOOKINGS', `${cur.reserved} place(s) are already booked — capacity cannot be lower than that. Reschedule or cancel bookings first.`);
        }
      }
      if (cur.status === 'COMPLETED') throw conflict('SLOT_COMPLETED', 'This session is already completed.');
      await tx.query('UPDATE slots SET capacity = COALESCE($2, capacity), status = COALESCE($3, status) WHERE id = $1', [id, dto.capacity ?? null, dto.status ?? null]);
      const parts: string[] = [];
      if (dto.capacity !== undefined && dto.capacity !== cur.capacity) parts.push(`capacity ${cur.capacity} → ${dto.capacity}`);
      if (dto.status && dto.status !== cur.status) parts.push(dto.status === 'CLOSED' ? 'closed for new bookings' : 'reopened');
      await this.audit.log(tx, {
        workspaceId: user.workspaceId,
        entityType: 'SLOT',
        entityId: id,
        action: 'SLOT_UPDATED',
        message: `Slot ${parts.join(', ') || 'updated'}`,
        actor: user,
        reason: dto.reason ?? null,
        fromState: { capacity: cur.capacity, status: cur.status },
        toState: { capacity: dto.capacity ?? cur.capacity, status: dto.status ?? cur.status },
      });
      return { ok: true };
    });
  }

  /**
   * Workshop: "marked completed after the session" (§2B.4).
   * Attended bookings are completed; bookings never checked in are marked as no-show.
   */
  async completeSession(user: AuthUser, id: string) {
    const slot = await this.db.one<{ kind: string; status: string; starts_at: Date }>('SELECT kind, status, starts_at FROM slots WHERE id = $1 AND workspace_id = $2', [id, user.workspaceId]);
    if (!slot) throw notFound('Slot');
    if (slot.status === 'COMPLETED') throw conflict('SLOT_COMPLETED', 'This session is already completed.');
    if (new Date(slot.starts_at).getTime() > Date.now()) throw badRequest('A session can only be completed after it has started.');
    const bookings = await this.db.query<{ id: string; fulfilment_status: string }>(
      `SELECT id, fulfilment_status FROM orders WHERE slot_id = $1 AND order_status IN ('CONFIRMED','IN_PROGRESS')`,
      [id],
    );
    let completed = 0;
    let noShows = 0;
    const errors: string[] = [];
    for (const b of bookings) {
      try {
        if (b.fulfilment_status === 'SCHEDULED') {
          await this.actions.execute(user, b.id, 'REPORT_CUSTOMER_UNAVAILABLE', { reason: 'Customer did not show up', notes: 'Not checked in when the session was completed' });
          noShows++;
        } else if (['CHECKED_IN', 'IN_SERVICE'].includes(b.fulfilment_status)) {
          await this.actions.execute(user, b.id, 'CONFIRM_SERVICE_COMPLETION', {});
          completed++;
        }
      } catch (err) {
        errors.push(err instanceof Error ? err.message : String(err));
      }
    }
    await this.db.tx(async (tx) => {
      await tx.query(`UPDATE slots SET status = 'COMPLETED' WHERE id = $1`, [id]);
      await this.audit.log(tx, {
        workspaceId: user.workspaceId,
        entityType: 'SLOT',
        entityId: id,
        action: 'SESSION_COMPLETED',
        message: `Session completed — ${completed} attended, ${noShows} no-show`,
        actor: user,
      });
    });
    return { completed, noShows, errors };
  }

  async listings(user: AuthUser) {
    return this.db.query(
      `SELECT id, kind, name, description, tags, price_paise AS "pricePaise", fulfilment_types AS "fulfilmentTypes", booking_mode AS "bookingMode",
              auto_confirm AS "autoConfirm", prep_minutes AS "prepMinutes", duration_minutes AS "durationMinutes", stock,
              instant_capacity AS "instantCapacity", default_provider_id AS "defaultProviderId"
       FROM listings WHERE workspace_id = $1 AND is_active ORDER BY kind, name`,
      [user.workspaceId],
    );
  }

  async staff(user: AuthUser, role: 'SERVICE_PROVIDER' | 'DELIVERY_AGENT') {
    return this.db.query(
      `SELECT u.id, u.name, u.phone, u.title, u.is_available AS "isAvailable", u.avatar_color AS "avatarColor",
         (SELECT count(*)::int FROM delivery_assignments a WHERE a.agent_id = u.id AND a.status IN ('OFFERED','ACCEPTED')) AS "activeDeliveries",
         (SELECT count(*)::int FROM orders o WHERE o.provider_id = u.id AND o.order_status IN ('CONFIRMED','IN_PROGRESS')
             AND o.scheduled_start >= ist_day_start(ist_today()) AND o.scheduled_start < ist_day_start(ist_today() + 1)) AS "bookingsToday"
       FROM users u WHERE u.workspace_id = $1 AND u.role = $2 AND u.is_active ORDER BY u.name`,
      [user.workspaceId, role],
    );
  }
}

function startOfTodayIST(): Date {
  const now = new Date();
  const ist = new Date(now.getTime() + 330 * 60_000);
  ist.setUTCHours(0, 0, 0, 0);
  return new Date(ist.getTime() - 330 * 60_000);
}

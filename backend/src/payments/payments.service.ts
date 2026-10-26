import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { OrderActionsService, systemActor } from '../orders/order-actions.service';
import { NewNotification, NotificationsService } from '../notifications/notifications.service';
import { badRequest, conflict, notFound } from '../common/errors';

export interface PaymentEvent {
  orderId?: string;
  reference: string;
  status: 'SUCCEEDED' | 'FAILED';
  reason?: string;
}

/**
 * Payment status is only changed from verified provider events — never by hand (§7 Payment Failure).
 * The real gateway is out of scope; `SamplePaymentProvider` events arrive through the webhook.
 * Re-delivered webhooks are idempotent (unique provider_reference) and a second successful
 * charge for the same order is blocked by `payments_one_success_per_order`.
 */
@Injectable()
export class PaymentsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly actions: OrderActionsService,
    private readonly notifications: NotificationsService,
  ) {}

  async handleEvent(ev: PaymentEvent): Promise<{ ok: true; duplicate: boolean; orderId: string }> {
    if (!ev.reference?.trim()) throw badRequest('Missing payment reference.');
    const notes: NewNotification[] = [];
    const res = await this.db.tx(async (tx) => {
      // replayed webhook?
      const seen = await tx.query<{ order_id: string; status: string }>('SELECT order_id, status FROM payments WHERE provider_reference = $1', [ev.reference]);
      if (seen.rows[0] && seen.rows[0].status !== 'PENDING') return { ok: true as const, duplicate: true, orderId: seen.rows[0].order_id };

      let payment = seen.rows[0] ? (await tx.query<{ id: string; order_id: string; workspace_id: string }>(
        'SELECT p.id, p.order_id, o.workspace_id FROM payments p JOIN orders o ON o.id = p.order_id WHERE p.provider_reference = $1 FOR UPDATE OF p',
        [ev.reference],
      )).rows[0] : undefined;
      if (!payment) {
        if (!ev.orderId) throw notFound('Payment');
        payment = (await tx.query<{ id: string; order_id: string; workspace_id: string }>(
          `SELECT p.id, p.order_id, o.workspace_id FROM payments p JOIN orders o ON o.id = p.order_id
           WHERE p.order_id = $1 AND p.status = 'PENDING' ORDER BY p.attempt DESC LIMIT 1 FOR UPDATE OF p`,
          [ev.orderId],
        )).rows[0];
      }
      if (!payment) throw conflict('NO_PENDING_PAYMENT', 'There is no pending payment for this order.');

      if (ev.status === 'SUCCEEDED') {
        await tx.query(`UPDATE payments SET status = 'SUCCEEDED', provider_reference = $2, confirmed_at = now() WHERE id = $1`, [payment.id, ev.reference]);
      } else {
        await tx.query(`UPDATE payments SET status = 'FAILED', provider_reference = $2, failure_reason = $3 WHERE id = $1`, [payment.id, ev.reference, ev.reason ?? 'Payment failed']);
      }
      await this.actions.executeInTx(
        tx,
        systemActor(payment.workspace_id),
        payment.order_id,
        ev.status === 'SUCCEEDED' ? 'PAYMENT_CONFIRMED' : 'PAYMENT_FAILED',
        { reason: ev.reason },
        {},
        notes,
      );
      return { ok: true as const, duplicate: false, orderId: payment.order_id };
    });
    this.notifications.dispatch(notes);
    return res;
  }
}

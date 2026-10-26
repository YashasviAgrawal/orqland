import { Body, Controller, Get, Headers, NotFoundException, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, IsUUID } from 'class-validator';
import { randomUUID } from 'crypto';
import { config } from '../config';
import { CurrentUser, Roles } from '../common/auth/decorators';
import type { AuthUser } from '../common/auth/auth.types';
import { Role } from '../domain/enums';
import { workflowOf } from '../domain/workflows';
import { DatabaseService } from '../database/database.service';
import { OrderCreationService } from '../orders/order-creation.service';
import { OrderActionsService } from '../orders/order-actions.service';
import { ORDER_SELECT, OrderRow } from '../orders/order.repository';
import { toOrderView } from '../orders/order.view';
import { ActionDto, CreateOrderDto } from '../orders/dto';
import { ScheduleService } from '../schedule/schedule.service';
import { PaymentsService } from '../payments/payments.service';
import { NotificationsService } from '../notifications/notifications.service';
import { notFound } from '../common/errors';

class CustomerQuery {
  @IsOptional() @IsUUID() customerId?: string;
}
class AvailabilityQuery {
  @IsUUID() listingId: string;
  @IsString() fulfilmentType: string;
}
class PaymentOutcomeDto {
  @IsIn(['SUCCEEDED', 'FAILED']) outcome: 'SUCCEEDED' | 'FAILED';
}

/**
 * Customer-side SAMPLE API used only by the standalone demo (customer-facing UI is out of scope, §11).
 * It lets reviewers place orders of every fulfilment type and trigger customer requests
 * (cancel / reschedule / return / clarification reply) and payment outcomes.
 * Disabled when ENABLE_SIMULATOR=false.
 */
@ApiTags('simulator (demo only)')
@ApiBearerAuth()
@Controller('simulator')
@Roles(Role.ADMIN)
export class SimulatorController {
  constructor(
    private readonly db: DatabaseService,
    private readonly creation: OrderCreationService,
    private readonly actions: OrderActionsService,
    private readonly schedule: ScheduleService,
    private readonly payments: PaymentsService,
    private readonly notifications: NotificationsService,
  ) {}

  private guard() {
    if (!config.enableSimulator) throw new NotFoundException();
  }

  private customerActor(user: AuthUser, customerId: string): AuthUser {
    return { id: customerId, role: Role.CUSTOMER, name: 'Customer', workspaceId: user.workspaceId };
  }

  @Get('catalog')
  async catalog(@CurrentUser() user: AuthUser) {
    this.guard();
    const [listings, customers] = await Promise.all([
      this.schedule.listings(user),
      this.db.query(`SELECT id, name, phone, default_address AS "defaultAddress" FROM customers WHERE workspace_id = $1 ORDER BY name`, [user.workspaceId]),
    ]);
    return { listings, customers };
  }

  @Get('availability')
  @ApiOperation({ summary: 'Bookable slots for a listing & fulfilment type' })
  async availability(@CurrentUser() user: AuthUser, @Query() q: AvailabilityQuery) {
    this.guard();
    const wf = workflowOf(q.fulfilmentType as never);
    if (!wf.slotKind) return [];
    return this.schedule.listSlots(user, { listingId: q.listingId, kind: wf.slotKind, onlyAvailable: true, to: new Date(Date.now() + 8 * 86400_000).toISOString() });
  }

  @Post('orders')
  @ApiOperation({ summary: 'Place an order / booking as the customer' })
  async place(@CurrentUser() user: AuthUser, @Body() body: CreateOrderDto, @Headers('idempotency-key') key?: string) {
    this.guard();
    const customerId = body.customerId;
    const actor = this.customerActor(user, customerId ?? 'new');
    return this.creation.create(actor, body, key);
  }

  @Get('orders')
  async orders(@CurrentUser() user: AuthUser, @Query() q: CustomerQuery) {
    this.guard();
    const params: unknown[] = [user.workspaceId];
    let where = 'o.workspace_id = $1';
    if (q.customerId) {
      params.push(q.customerId);
      where += ' AND o.customer_id = $2';
    }
    const rows = await this.db.query<OrderRow>(`${ORDER_SELECT} WHERE ${where} ORDER BY o.created_at DESC LIMIT 40`, params);
    return rows.map((r) => toOrderView(r, this.customerActor(user, r.customer_id)));
  }

  @Post('orders/:id/actions')
  @ApiOperation({ summary: 'Customer request: cancellation, reschedule, return or clarification reply' })
  async act(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: ActionDto) {
    this.guard();
    if (!body.action.startsWith('CUSTOMER_')) throw new NotFoundException('Unknown customer action');
    const o = await this.db.one<{ customer_id: string }>('SELECT customer_id FROM orders WHERE id = $1 AND workspace_id = $2', [id, user.workspaceId]);
    if (!o) throw notFound('Order');
    await this.actions.execute(this.customerActor(user, o.customer_id), id, body.action, body.input ?? {});
    return { ok: true };
  }

  @Post('orders/:id/payment')
  @ApiOperation({ summary: 'Simulate the payment provider confirming or failing an online payment' })
  async pay(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: PaymentOutcomeDto) {
    this.guard();
    const o = await this.db.one('SELECT 1 FROM orders WHERE id = $1 AND workspace_id = $2', [id, user.workspaceId]);
    if (!o) throw notFound('Order');
    return this.payments.handleEvent({
      orderId: id,
      reference: `sim_${randomUUID().slice(0, 18)}`,
      status: body.outcome,
      reason: body.outcome === 'FAILED' ? 'Card declined by issuer (simulated)' : undefined,
    });
  }

  @Get('customers/:id/notifications')
  async customerNotifications(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    this.guard();
    return this.notifications.forCustomer(user.workspaceId, id);
  }
}

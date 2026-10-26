import { Body, Controller, Get, Headers, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, Roles } from '../common/auth/decorators';
import type { AuthUser } from '../common/auth/auth.types';
import { IdempotencyService } from '../common/idempotency.service';
import { forbidden } from '../common/errors';
import { Role } from '../domain/enums';
import { OrderQueryService } from './order-query.service';
import { OrderActionsService } from './order-actions.service';
import { OrderCreationService } from './order-creation.service';
import { ActionDto, BulkAcceptDto, CreateOrderDto, ListOrdersQuery, toList } from './dto';

@ApiTags('orders')
@ApiBearerAuth()
@Controller('orders')
export class OrdersController {
  constructor(
    private readonly queries: OrderQueryService,
    private readonly actions: OrderActionsService,
    private readonly creation: OrderCreationService,
    private readonly idempotency: IdempotencyService,
  ) {}

  @Get()
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'List orders & bookings (dashboard). Each item includes the actions available to the caller.' })
  list(@CurrentUser() user: AuthUser, @Query() q: ListOrdersQuery) {
    return this.queries.list(user, {
      view: q.view,
      kind: q.kind,
      fulfilmentTypes: toList(q.fulfilmentType),
      orderStatus: q.status,
      paymentStatus: q.paymentStatus,
      q: q.q,
      dateFrom: q.dateFrom,
      dateTo: q.dateTo,
      dateField: q.dateField,
      page: q.page,
      pageSize: q.pageSize,
    });
  }

  @Get('summary')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Counts for summary cards and tabs, revenue and outstanding COD' })
  summary(@CurrentUser() user: AuthUser, @Query() q: ListOrdersQuery) {
    return this.queries.summary(user, { kind: q.kind, fulfilmentTypes: toList(q.fulfilmentType), q: q.q, dateFrom: q.dateFrom, dateTo: q.dateTo, dateField: q.dateField });
  }

  @Get(':id')
  @ApiOperation({ summary: 'Order / booking detail with timeline, payments, COD, assignments and available actions' })
  detail(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.queries.detail(user, id);
  }

  @Post(':id/actions')
  @ApiHeader({ name: 'Idempotency-Key', required: false, description: 'Retry-safe key; repeated requests return the first result' })
  @ApiOperation({ summary: 'Perform a workflow action (accept, start preparation, assign agent, mark delivered…)' })
  async action(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: ActionDto,
    @Headers('idempotency-key') key?: string,
  ) {
    if (user.role === Role.CUSTOMER || user.role === Role.SYSTEM) throw forbidden();
    return this.idempotency.run(user, key, `order-action:${id}:${body.action}`, async () => {
      await this.actions.execute(user, id, body.action, body.input ?? {}, { expectedVersion: body.expectedVersion });
      return this.queries.detail(user, id);
    });
  }

  @Post('bulk-accept')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: '“Accept all” for new orders' })
  bulkAccept(@CurrentUser() user: AuthUser, @Body() body: BulkAcceptDto) {
    return this.actions.bulkAccept(user, body.orderIds, !!body.startPreparation);
  }

  @Post()
  @Roles(Role.ADMIN)
  @ApiHeader({ name: 'Idempotency-Key', required: false })
  @ApiOperation({ summary: 'Create an order/booking (used by the Orqland checkout integration or admin-created orders)' })
  async create(@CurrentUser() user: AuthUser, @Body() body: CreateOrderDto, @Headers('idempotency-key') key?: string) {
    const created = await this.creation.create(user, body, key);
    return this.queries.detail(user, created.id);
  }
}

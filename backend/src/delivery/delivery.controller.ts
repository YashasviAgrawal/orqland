import { Body, Controller, Get, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsArray, IsBoolean, IsNumber, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { CurrentUser, Roles } from '../common/auth/decorators';
import type { AuthUser } from '../common/auth/auth.types';
import { Role } from '../domain/enums';
import { DatabaseService } from '../database/database.service';
import { OrderQueryService } from '../orders/order-query.service';
import { SettlementsService } from '../settlements/settlements.service';
import { ScheduleService } from '../schedule/schedule.service';
import { ScopeQuery } from '../orders/dto';

class AvailabilityDto {
  @IsBoolean()
  isAvailable: boolean;
}

class LocationDto {
  @Type(() => Number) @IsNumber() @Min(-90) @Max(90) lat: number;
  @Type(() => Number) @IsNumber() @Min(-180) @Max(180) lng: number;
}

class HandoverDto {
  @IsOptional() @IsArray() @IsUUID('4', { each: true }) collectionIds?: string[];
  @Type(() => Number) @IsNumber() @Min(0) declaredAmount: number;
  @IsOptional() @IsString() @MaxLength(500) note?: string;
}

const DELIVERY_TYPES = `o.fulfilment_type IN ('DELIVERY','SCHEDULED_DELIVERY')`;
const ACTIVE = `o.order_status NOT IN ('COMPLETED','CANCELLED','REJECTED')`;

/** Workspace admin — delivery assignment & tracking board. */
@ApiTags('delivery')
@ApiBearerAuth()
@Controller('delivery')
@Roles(Role.ADMIN)
export class DeliveryController {
  constructor(
    private readonly queries: OrderQueryService,
    private readonly schedule: ScheduleService,
  ) {}

  @Get('board')
  @ApiOperation({ summary: 'Unassigned queue, pending offers, active deliveries, delivery exceptions and agent roster' })
  async board(@CurrentUser() user: AuthUser) {
    const [unassigned, offered, active, exceptions, agents] = await Promise.all([
      this.queries.listWhere(
        user,
        `${DELIVERY_TYPES} AND ${ACTIVE} AND o.order_status <> 'PENDING_REVIEW' AND o.order_status <> 'CLARIFICATION_REQUESTED'
         AND o.fulfilment_status IN ('AWAITING_PREPARATION','SCHEDULED','PREPARING','READY')
         AND NOT EXISTS (SELECT 1 FROM delivery_assignments a WHERE a.order_id = o.id AND a.status IN ('OFFERED','ACCEPTED'))`,
        [],
        `CASE o.fulfilment_status WHEN 'READY' THEN 0 WHEN 'PREPARING' THEN 1 ELSE 2 END, o.scheduled_start NULLS FIRST, o.created_at`,
      ),
      this.queries.listWhere(user, `EXISTS (SELECT 1 FROM delivery_assignments a WHERE a.order_id = o.id AND a.status = 'OFFERED')`, [], 'o.updated_at DESC'),
      this.queries.listWhere(
        user,
        `${ACTIVE} AND EXISTS (SELECT 1 FROM delivery_assignments a WHERE a.order_id = o.id AND a.status = 'ACCEPTED')
         AND o.fulfilment_status IN ('AWAITING_PREPARATION','SCHEDULED','PREPARING','READY','PICKED_UP','OUT_FOR_DELIVERY')`,
        [],
        `CASE o.fulfilment_status WHEN 'OUT_FOR_DELIVERY' THEN 0 WHEN 'PICKED_UP' THEN 1 ELSE 2 END, o.updated_at DESC`,
      ),
      this.queries.listWhere(
        user,
        `${DELIVERY_TYPES} AND (o.fulfilment_status IN ('DELIVERY_FAILED','RETURNING') OR (o.fulfilment_status = 'RETURNED_TO_WORKSPACE' AND (o.return_confirmed_at IS NULL OR ${ACTIVE})))`,
        [],
        'o.updated_at DESC',
      ),
      this.schedule.staff(user, 'DELIVERY_AGENT'),
    ]);
    return { unassigned, offered, active, exceptions, agents };
  }

  @Get('agents')
  agents(@CurrentUser() user: AuthUser) {
    return this.schedule.staff(user, 'DELIVERY_AGENT');
  }
}

/** Delivery agent interface. */
@ApiTags('agent')
@ApiBearerAuth()
@Controller('agent')
@Roles(Role.AGENT)
export class AgentController {
  constructor(
    private readonly queries: OrderQueryService,
    private readonly settlements: SettlementsService,
    private readonly db: DatabaseService,
  ) {}

  @Get('assignments')
  @ApiOperation({ summary: 'Assigned orders: scope=offers | active | completed' })
  async assignments(@CurrentUser() user: AuthUser, @Query() q: ScopeQuery) {
    const scope = q.scope ?? 'active';
    if (scope === 'offers') {
      return this.queries.listWhere(user, `EXISTS (SELECT 1 FROM delivery_assignments a WHERE a.order_id = o.id AND a.agent_id = $2 AND a.status = 'OFFERED')`, [user.id], 'o.updated_at DESC');
    }
    if (scope === 'completed') {
      return this.queries.listWhere(
        user,
        `EXISTS (SELECT 1 FROM delivery_assignments a WHERE a.order_id = o.id AND a.agent_id = $2 AND a.status IN ('COMPLETED','CANCELLED','REJECTED','EXPIRED')
                   AND a.offered_at > now() - interval '7 days')
         AND NOT EXISTS (SELECT 1 FROM delivery_assignments b WHERE b.order_id = o.id AND b.agent_id = $2 AND b.status IN ('OFFERED','ACCEPTED'))`,
        [user.id],
        'o.updated_at DESC',
        50,
      );
    }
    // active: accepted deliveries + delivered orders whose cash is still to be recorded
    return this.queries.listWhere(
      user,
      `EXISTS (SELECT 1 FROM delivery_assignments a WHERE a.order_id = o.id AND a.agent_id = $2 AND a.status = 'ACCEPTED')
       OR (o.delivered_by_agent_id = $2 AND o.payment_method = 'CASH' AND o.cod_status IN ('PENDING_COLLECTION','COLLECTED') AND o.payment_status <> 'PAID')`,
      [user.id],
      `CASE o.fulfilment_status WHEN 'OUT_FOR_DELIVERY' THEN 0 WHEN 'PICKED_UP' THEN 1 WHEN 'READY' THEN 2 WHEN 'RETURNING' THEN 3 ELSE 4 END, o.updated_at DESC`,
    );
  }

  @Get('summary')
  async summary(@CurrentUser() user: AuthUser) {
    const r = await this.db.one<{ offers: number; active: number; delivered_today: number; is_available: boolean }>(
      `SELECT
         (SELECT count(*)::int FROM delivery_assignments WHERE agent_id = $1 AND status = 'OFFERED') AS offers,
         (SELECT count(*)::int FROM delivery_assignments WHERE agent_id = $1 AND status = 'ACCEPTED') AS active,
         (SELECT count(*)::int FROM delivery_assignments WHERE agent_id = $1 AND status = 'COMPLETED' AND closed_at >= ist_day_start(ist_today())) AS delivered_today,
         (SELECT is_available FROM users WHERE id = $1) AS is_available`,
      [user.id],
    );
    const cash = await this.settlements.agentCash(user);
    return { offers: r?.offers ?? 0, active: r?.active ?? 0, deliveredToday: r?.delivered_today ?? 0, isAvailable: r?.is_available ?? false, cashInHandPaise: cash.inHandPaise };
  }

  @Patch('availability')
  @ApiOperation({ summary: 'Go on / off duty (only available agents receive automatic assignments)' })
  async availability(@CurrentUser() user: AuthUser, @Body() body: AvailabilityDto) {
    await this.db.query('UPDATE users SET is_available = $2 WHERE id = $1', [user.id, body.isAvailable]);
    return { isAvailable: body.isAvailable };
  }

  @Post('location')
  @ApiOperation({ summary: 'Integration hook for live GPS tracking (out of scope until agreed) — stores the latest position on active assignments' })
  async location(@CurrentUser() user: AuthUser, @Body() body: LocationDto) {
    await this.db.query(
      `UPDATE delivery_assignments SET last_lat = $2, last_lng = $3, last_location_at = now() WHERE agent_id = $1 AND status = 'ACCEPTED'`,
      [user.id, body.lat, body.lng],
    );
    return { ok: true };
  }

  @Get('cash')
  cash(@CurrentUser() user: AuthUser) {
    return this.settlements.agentCash(user);
  }

  @Post('cash-handovers')
  @ApiOperation({ summary: 'Submit cash handover' })
  handover(@CurrentUser() user: AuthUser, @Body() body: HandoverDto) {
    return this.settlements.submitHandover(user, body);
  }
}

/** Service provider / workspace staff interface. */
@ApiTags('provider')
@ApiBearerAuth()
@Controller('provider')
@Roles(Role.STAFF)
export class ProviderController {
  constructor(
    private readonly queries: OrderQueryService,
    private readonly db: DatabaseService,
  ) {}

  @Get('bookings')
  @ApiOperation({ summary: 'Assigned bookings: scope=today | upcoming | attention | past' })
  bookings(@CurrentUser() user: AuthUser, @Query() q: ScopeQuery) {
    const scope = q.scope ?? 'today';
    const mine = 'o.provider_id = $2';
    const todayStart = `ist_day_start(ist_today())`;
    const todayEnd = `ist_day_start(ist_today() + 1)`;
    if (scope === 'upcoming') {
      return this.queries.listWhere(user, `${mine} AND ${ACTIVE} AND o.scheduled_start >= ${todayEnd}`, [user.id], 'o.scheduled_start', 100);
    }
    if (scope === 'attention') {
      return this.queries.listWhere(
        user,
        `${mine} AND ${ACTIVE} AND (o.order_status = 'PENDING_REVIEW' OR o.fulfilment_status IN ('NO_SHOW','SERVICE_FAILED','PROVIDER_UNAVAILABLE')
          OR (o.fulfilment_status = 'SCHEDULED' AND o.provider_confirmed_at IS NULL))`,
        [user.id],
        'o.scheduled_start NULLS LAST',
      );
    }
    if (scope === 'past') {
      return this.queries.listWhere(user, `${mine} AND (o.order_status IN ('COMPLETED','CANCELLED','REJECTED'))`, [user.id], 'o.scheduled_start DESC NULLS LAST', 50);
    }
    return this.queries.listWhere(
      user,
      `${mine} AND ${ACTIVE} AND ((o.scheduled_start >= ${todayStart} AND o.scheduled_start < ${todayEnd})
        OR o.fulfilment_status IN ('PROVIDER_EN_ROUTE','CHECKED_IN','IN_SERVICE'))`,
      [user.id],
      'o.scheduled_start',
    );
  }

  @Get('summary')
  async summary(@CurrentUser() user: AuthUser) {
    return this.db.one(
      `SELECT
        count(*) FILTER (WHERE order_status IN ('CONFIRMED','IN_PROGRESS') AND scheduled_start >= ist_day_start(ist_today()) AND scheduled_start < ist_day_start(ist_today() + 1))::int AS "today",
        count(*) FILTER (WHERE order_status IN ('CONFIRMED','IN_PROGRESS') AND scheduled_start >= ist_day_start(ist_today() + 1))::int AS "upcoming",
        count(*) FILTER (WHERE fulfilment_status IN ('IN_SERVICE','CHECKED_IN','PROVIDER_EN_ROUTE') AND order_status = 'IN_PROGRESS')::int AS "inProgress",
        count(*) FILTER (WHERE order_status = 'COMPLETED' AND completed_at >= ist_day_start(ist_today()))::int AS "completedToday"
       FROM orders WHERE provider_id = $1`,
      [user.id],
    );
  }
}

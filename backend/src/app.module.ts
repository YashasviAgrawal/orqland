import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { config } from './config';
import { DatabaseModule } from './database/database.module';
import { AuthGuard } from './common/auth/auth.guard';
import { AuthController } from './common/auth/auth.controller';
import { AllExceptionsFilter } from './common/errors';
import { IdempotencyService } from './common/idempotency.service';
import { NotificationsService } from './notifications/notifications.service';
import { NotificationsController } from './notifications/notifications.controller';
import { OrderQueryService } from './orders/order-query.service';
import { OrderActionsService } from './orders/order-actions.service';
import { OrderCreationService } from './orders/order-creation.service';
import { OrdersController } from './orders/orders.controller';
import { AssignmentService } from './delivery/assignment.service';
import { AgentController, DeliveryController, ProviderController } from './delivery/delivery.controller';
import { ScheduleService } from './schedule/schedule.service';
import { ScheduleController } from './schedule/schedule.controller';
import { SettlementsService } from './settlements/settlements.service';
import { SettlementsController } from './settlements/settlements.controller';
import { PaymentsService } from './payments/payments.service';
import { PaymentsController } from './payments/payments.controller';
import { SimulatorController } from './simulator/simulator.controller';
import { MetaController } from './meta/meta.controller';
import { WorkspaceController } from './meta/workspace.controller';
import { AssignmentExpiryJob } from './jobs/assignment-expiry.job';

/**
 * Order Management module. Everything is self-contained so it can be mounted into the
 * Orqland NestJS application as a single feature module (see docs/INTEGRATION_GUIDE.md).
 */
@Module({
  imports: [DatabaseModule, JwtModule.register({ secret: config.jwtSecret })],
  controllers: [
    AuthController,
    MetaController,
    WorkspaceController,
    OrdersController,
    DeliveryController,
    AgentController,
    ProviderController,
    ScheduleController,
    SettlementsController,
    PaymentsController,
    NotificationsController,
    SimulatorController,
  ],
  providers: [
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    IdempotencyService,
    NotificationsService,
    AssignmentService,
    OrderQueryService,
    OrderActionsService,
    OrderCreationService,
    ScheduleService,
    SettlementsService,
    PaymentsService,
    AssignmentExpiryJob,
  ],
})
export class AppModule {}

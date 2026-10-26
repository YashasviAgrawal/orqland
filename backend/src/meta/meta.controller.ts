import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../common/auth/decorators';
import { DatabaseService } from '../database/database.service';
import { ACTION_CODES, actionKind, actionRoles, EXCEPTION_LABEL } from '../domain/engine';
import { FULFILMENT_STATUS_LABEL, ORDER_STATUS_LABEL, WORKFLOWS } from '../domain/workflows';
import { CodStatus, PaymentMethod, PaymentStatus, RefundStatus } from '../domain/enums';

@ApiTags('meta')
@Controller()
export class MetaController {
  constructor(private readonly db: DatabaseService) {}

  @Public()
  @Get('health')
  async health() {
    await this.db.query('SELECT 1');
    return { status: 'ok', time: new Date().toISOString() };
  }

  @Public()
  @Get('meta')
  @ApiOperation({ summary: 'Status definitions, workflow configuration and the action catalogue (for UI & integration)' })
  meta() {
    return {
      workflows: WORKFLOWS,
      orderStatus: ORDER_STATUS_LABEL,
      fulfilmentStatus: FULFILMENT_STATUS_LABEL,
      paymentStatus: Object.values(PaymentStatus),
      paymentMethods: Object.values(PaymentMethod),
      codStatus: Object.values(CodStatus),
      refundStatus: Object.values(RefundStatus),
      exceptions: EXCEPTION_LABEL,
      actions: ACTION_CODES.map((code) => ({ code, roles: actionRoles(code), kind: actionKind(code) })),
    };
  }
}

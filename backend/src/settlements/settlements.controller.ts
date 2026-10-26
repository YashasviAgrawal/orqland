import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsNumber, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import { CurrentUser, Roles } from '../common/auth/decorators';
import type { AuthUser } from '../common/auth/auth.types';
import { Role } from '../domain/enums';
import { Resolution, SettlementsService } from './settlements.service';

class AmountDto {
  @Type(() => Number) @IsNumber() @Min(0) receivedAmount: number;
}
class DiscrepancyDto extends AmountDto {
  @IsString() @MaxLength(500) reason: string;
}
class ResolveDto {
  @IsIn(['AGENT_PAID_DIFFERENCE', 'RECOUNT_CORRECTED', 'WRITTEN_OFF', 'DEDUCTED_FROM_PAYOUT']) resolution: Resolution;
  @IsString() @MaxLength(500) note: string;
}
class HandoverQuery {
  @IsOptional() @IsString() status?: string;
}

@ApiTags('settlements')
@ApiBearerAuth()
@Controller('settlements')
@Roles(Role.ADMIN)
export class SettlementsController {
  constructor(private readonly settlements: SettlementsService) {}

  @Get()
  @ApiOperation({ summary: 'Outstanding cash by agent and order, pending handovers, cash awaiting collection' })
  overview(@CurrentUser() user: AuthUser) {
    return this.settlements.overview(user);
  }

  @Get('handovers')
  handovers(@CurrentUser() user: AuthUser, @Query() q: HandoverQuery) {
    return this.settlements.handovers(user, q.status ? q.status.split(',') : undefined);
  }

  @Post('handovers/:id/confirm')
  @ApiOperation({ summary: 'Confirm Cash Received' })
  confirm(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: AmountDto) {
    return this.settlements.confirm(user, id, body.receivedAmount);
  }

  @Post('handovers/:id/discrepancy')
  @ApiOperation({ summary: 'Record Discrepancy — settlement stays pending' })
  discrepancy(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: DiscrepancyDto) {
    return this.settlements.recordDiscrepancy(user, id, body.receivedAmount, body.reason);
  }

  @Post('handovers/:id/resolve')
  @ApiOperation({ summary: 'Resolve Discrepancy' })
  resolve(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: ResolveDto) {
    return this.settlements.resolve(user, id, body.resolution, body.note);
  }
}

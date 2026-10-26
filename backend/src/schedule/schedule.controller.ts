import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';
import { CurrentUser, Roles } from '../common/auth/decorators';
import type { AuthUser } from '../common/auth/auth.types';
import { Role, SlotKind } from '../domain/enums';
import { ScheduleService } from './schedule.service';

class SlotsQuery {
  @IsOptional() @IsString() from?: string;
  @IsOptional() @IsString() to?: string;
  @IsOptional() @IsUUID() listingId?: string;
  @IsOptional() @IsString() kind?: string;
  @IsOptional() @IsIn(['true', 'false']) available?: string;
}

class CreateSlotDto {
  @IsOptional() @IsUUID() listingId?: string;
  @IsIn(Object.values(SlotKind)) kind: SlotKind;
  @IsOptional() @IsUUID() providerId?: string;
  @IsString() startsAt: string;
  @IsString() endsAt: string;
  @Type(() => Number) @IsInt() @Min(1) @Max(500) capacity: number;
  @IsOptional() @IsString() @MaxLength(120) title?: string;
}

class UpdateSlotDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(500) capacity?: number;
  @IsOptional() @IsIn(['OPEN', 'CLOSED']) status?: 'OPEN' | 'CLOSED';
  @IsOptional() @IsString() @MaxLength(500) reason?: string;
}

@ApiTags('schedule')
@ApiBearerAuth()
@Controller('schedule')
export class ScheduleController {
  constructor(private readonly schedule: ScheduleService) {}

  @Get('slots')
  @Roles(Role.ADMIN, Role.STAFF)
  @ApiOperation({ summary: 'Availability & capacity for delivery windows, pickup windows, service slots and workshop sessions' })
  slots(@CurrentUser() user: AuthUser, @Query() q: SlotsQuery) {
    return this.schedule.listSlots(user, { from: q.from, to: q.to, listingId: q.listingId, kind: q.kind, onlyAvailable: q.available === 'true' });
  }

  @Get('slots/:id')
  @Roles(Role.ADMIN, Role.STAFF)
  @ApiOperation({ summary: 'Slot detail with attendees' })
  slot(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.schedule.slot(user, id);
  }

  @Post('slots')
  @Roles(Role.ADMIN)
  create(@CurrentUser() user: AuthUser, @Body() body: CreateSlotDto) {
    return this.schedule.createSlot(user, body);
  }

  @Patch('slots/:id')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Manage capacity / open or close a slot (never below existing bookings)' })
  update(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: UpdateSlotDto) {
    return this.schedule.updateSlot(user, id, body);
  }

  @Post('slots/:id/complete')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Mark a workshop session completed (attended → completed, not checked-in → no-show)' })
  complete(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.schedule.completeSession(user, id);
  }

  @Get('listings')
  @Roles(Role.ADMIN, Role.STAFF)
  listings(@CurrentUser() user: AuthUser) {
    return this.schedule.listings(user);
  }

  @Get('providers')
  @Roles(Role.ADMIN)
  providers(@CurrentUser() user: AuthUser) {
    return this.schedule.staff(user, 'SERVICE_PROVIDER');
  }
}

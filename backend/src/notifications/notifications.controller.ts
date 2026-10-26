import { Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/auth/decorators';
import type { AuthUser } from '../common/auth/auth.types';
import { NotificationsService } from './notifications.service';

@ApiTags('notifications')
@ApiBearerAuth()
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.notifications.listFor(user);
  }

  @Post('read-all')
  async readAll(@CurrentUser() user: AuthUser) {
    await this.notifications.markRead(user);
    return { ok: true };
  }

  @Post(':id/read')
  async read(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    await this.notifications.markRead(user, id);
    return { ok: true };
  }
}

import { Body, Controller, Get, NotFoundException, Patch } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsBoolean } from 'class-validator';
import { CurrentUser, Roles } from '../common/auth/decorators';
import type { AuthUser } from '../common/auth/auth.types';
import { AuditService } from '../database/audit.service';
import { DatabaseService } from '../database/database.service';
import { Role } from '../domain/enums';

class WorkspaceStatusDto {
  @IsBoolean() isOpen: boolean;
}

interface WorkspaceRow {
  id: string;
  name: string;
  code: string;
  address: string;
  is_open: boolean;
}

const toWorkspace = (r: WorkspaceRow) => ({ id: r.id, name: r.name, code: r.code, address: r.address, isOpen: r.is_open });

/**
 * Whether the workspace is taking instant orders right now (Figma header “Open / Closed”).
 * Scheduled orders and bookings are still accepted while closed — see OrderCreationService.
 */
@ApiTags('workspace')
@ApiBearerAuth()
@Controller('workspace')
export class WorkspaceController {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  async get(@CurrentUser() user: AuthUser) {
    const r = await this.db.one<WorkspaceRow>('SELECT id, name, code, address, is_open FROM workspaces WHERE id = $1', [user.workspaceId]);
    if (!r) throw new NotFoundException('Workspace not found');
    return toWorkspace(r);
  }

  @Patch('status')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Open or close the workspace for instant orders' })
  async setStatus(@CurrentUser() user: AuthUser, @Body() body: WorkspaceStatusDto) {
    return this.db.tx(async (tx) => {
      const before = await tx.query<WorkspaceRow>('SELECT id, name, code, address, is_open FROM workspaces WHERE id = $1 FOR UPDATE', [user.workspaceId]);
      if (!before.rows[0]) throw new NotFoundException('Workspace not found');
      const after = await tx.query<WorkspaceRow>('UPDATE workspaces SET is_open = $2 WHERE id = $1 RETURNING id, name, code, address, is_open', [user.workspaceId, body.isOpen]);
      if (before.rows[0].is_open !== body.isOpen) {
        await this.audit.log(tx, {
          workspaceId: user.workspaceId,
          entityType: 'WORKSPACE',
          entityId: user.workspaceId,
          action: body.isOpen ? 'WORKSPACE_OPENED' : 'WORKSPACE_CLOSED',
          message: body.isOpen ? 'Workspace opened for instant orders' : 'Workspace closed for instant orders',
          actor: user,
          fromState: { isOpen: before.rows[0].is_open },
          toState: { isOpen: body.isOpen },
        });
      }
      return toWorkspace(after.rows[0]);
    });
  }
}

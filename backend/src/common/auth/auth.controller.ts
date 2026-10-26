import { Body, Controller, ForbiddenException, Get, NotFoundException, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtService } from '@nestjs/jwt';
import { IsUUID } from 'class-validator';
import { DatabaseService } from '../../database/database.service';
import { config } from '../../config';
import { CurrentUser, Public } from './decorators';
import type { AuthUser, JwtPayload } from './auth.types';
import type { Role } from '../../domain/enums';

class DemoLoginDto {
  @IsUUID()
  userId: string;
}

interface UserRow {
  id: string;
  name: string;
  role: Role;
  title: string | null;
  workspace_id: string;
  workspace_name: string;
  workspace_code: string;
  workspace_address: string;
  is_available: boolean;
  avatar_color: string | null;
  phone: string | null;
}

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly db: DatabaseService,
    private readonly jwt: JwtService,
  ) {}

  /** Demo users for the sign-in screen (disabled in production). */
  @Public()
  @Get('demo-users')
  async demoUsers() {
    if (!config.enableDemoLogin) throw new ForbiddenException('Demo login is disabled');
    const rows = await this.db.query<UserRow>(
      `SELECT u.id, u.name, u.role, u.title, u.workspace_id, w.name AS workspace_name, w.code AS workspace_code, w.address AS workspace_address, u.is_available, u.avatar_color, u.phone
       FROM users u JOIN workspaces w ON w.id = u.workspace_id WHERE u.is_active ORDER BY
       CASE u.role WHEN 'WORKSPACE_ADMIN' THEN 0 WHEN 'DELIVERY_AGENT' THEN 1 ELSE 2 END, u.name`,
    );
    return rows.map(toUser);
  }

  @Public()
  @Post('demo-login')
  async demoLogin(@Body() body: DemoLoginDto) {
    if (!config.enableDemoLogin) throw new ForbiddenException('Demo login is disabled');
    const row = await this.db.one<UserRow>(
      `SELECT u.id, u.name, u.role, u.title, u.workspace_id, w.name AS workspace_name, w.code AS workspace_code, w.address AS workspace_address, u.is_available, u.avatar_color, u.phone
       FROM users u JOIN workspaces w ON w.id = u.workspace_id WHERE u.id = $1 AND u.is_active`,
      [body.userId],
    );
    if (!row) throw new NotFoundException('User not found');
    const payload: JwtPayload = { sub: row.id, role: row.role, name: row.name, ws: row.workspace_id };
    const token = await this.jwt.signAsync(payload, { secret: config.jwtSecret, expiresIn: config.jwtExpiresIn });
    return { token, user: toUser(row) };
  }

  @ApiBearerAuth()
  @Get('me')
  async me(@CurrentUser() user: AuthUser) {
    const row = await this.db.one<UserRow>(
      `SELECT u.id, u.name, u.role, u.title, u.workspace_id, w.name AS workspace_name, w.code AS workspace_code, w.address AS workspace_address, u.is_available, u.avatar_color, u.phone
       FROM users u JOIN workspaces w ON w.id = u.workspace_id WHERE u.id = $1`,
      [user.id],
    );
    if (!row) throw new NotFoundException('User not found');
    return toUser(row);
  }
}

function toUser(r: UserRow) {
  return {
    id: r.id,
    name: r.name,
    role: r.role,
    title: r.title,
    phone: r.phone,
    isAvailable: r.is_available,
    avatarColor: r.avatar_color,
    workspace: { id: r.workspace_id, name: r.workspace_name, code: r.workspace_code, address: r.workspace_address },
  };
}

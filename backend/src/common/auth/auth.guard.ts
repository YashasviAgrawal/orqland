import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { Role } from '../../domain/enums';
import { config } from '../../config';
import { IS_PUBLIC, ROLES } from './decorators';
import type { AuthUser, JwtPayload } from './auth.types';

/**
 * Global guard: verifies the bearer token, then enforces @Roles().
 * To plug into Orqland, replace token verification with the platform's identity provider
 * (see docs/INTEGRATION_GUIDE.md §Auth) — the rest of the module only depends on AuthUser.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;

    const req = ctx.switchToHttp().getRequest<{ headers: Record<string, string | undefined>; user?: AuthUser }>();
    const header = req.headers['authorization'] ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (!token) throw new UnauthorizedException('Sign in required');

    let payload: JwtPayload;
    try {
      payload = await this.jwt.verifyAsync<JwtPayload>(token, { secret: config.jwtSecret });
    } catch {
      throw new UnauthorizedException('Session expired — please sign in again');
    }
    req.user = { id: payload.sub, role: payload.role, name: payload.name, workspaceId: payload.ws };

    const roles = this.reflector.getAllAndOverride<Role[] | undefined>(ROLES, targets);
    if (roles && roles.length && !roles.includes(payload.role)) {
      throw new ForbiddenException('You do not have permission to do this');
    }
    return true;
  }
}

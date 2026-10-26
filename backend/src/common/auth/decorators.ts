import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { Role } from '../../domain/enums';
import type { AuthUser } from './auth.types';

export const IS_PUBLIC = 'isPublic';
export const ROLES = 'roles';

/** Skip authentication for this route. */
export const Public = () => SetMetadata(IS_PUBLIC, true);

/** Restrict a route to the given roles. */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES, roles);

/** Inject the authenticated user. */
export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext): AuthUser => {
  const req = ctx.switchToHttp().getRequest<{ user: AuthUser }>();
  return req.user;
});

import type { Role } from '../../domain/enums';

/** The authenticated principal. In production this comes from Orqland's identity provider. */
export interface AuthUser {
  id: string;
  role: Role;
  name: string;
  workspaceId: string;
}

export interface JwtPayload {
  sub: string;
  role: Role;
  name: string;
  ws: string;
}

/** Permission matrix (role-based access control, §9). */
export const PERMISSIONS = {
  'orders.read.all': ['WORKSPACE_ADMIN'],
  'orders.review': ['WORKSPACE_ADMIN'],
  'orders.create': ['WORKSPACE_ADMIN', 'CUSTOMER', 'SYSTEM'],
  'schedule.manage': ['WORKSPACE_ADMIN'],
  'schedule.read': ['WORKSPACE_ADMIN', 'SERVICE_PROVIDER'],
  'delivery.manage': ['WORKSPACE_ADMIN'],
  'delivery.reassign_after_pickup': ['WORKSPACE_ADMIN'],
  'settlements.manage': ['WORKSPACE_ADMIN'],
  'agent.self': ['DELIVERY_AGENT'],
  'provider.self': ['SERVICE_PROVIDER'],
} as const;
export type Permission = keyof typeof PERMISSIONS;

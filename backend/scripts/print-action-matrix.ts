/** Generates docs/ACTION_MATRIX.md from the workflow engine (single source of truth). */
import { ACTION_CODES, actionKind, actionRoles } from '../src/domain/engine';

const ROLE: Record<string, string> = {
  WORKSPACE_ADMIN: 'Workspace Admin',
  DELIVERY_AGENT: 'Delivery Agent',
  SERVICE_PROVIDER: 'Service Provider / Staff',
  CUSTOMER: 'Customer (sample API)',
  SYSTEM: 'System',
};
const lines = [
  '# Action matrix',
  '',
  'Generated from `backend/src/domain/engine.ts` (`npm run docs:actions`). Each code is a button the API returns in an order’s `actions` list only when it is valid for that order’s fulfilment type, current statuses and the caller’s role.',
  '',
  '| Action code | Roles | Kind |',
  '|---|---|---|',
  ...ACTION_CODES.map((c) => `| \`${c}\` | ${actionRoles(c).map((r) => ROLE[r] ?? r).join(', ')} | ${actionKind(c) === 'link' ? 'navigation / view' : 'state change'} |`),
  '',
];
process.stdout.write(lines.join('\n'));

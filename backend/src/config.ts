import 'dotenv/config';

function bool(v: string | undefined, def: boolean): boolean {
  if (v === undefined || v === '') return def;
  return ['1', 'true', 'yes', 'on'].includes(v.toLowerCase());
}

export const config = {
  port: Number(process.env.PORT ?? 4000),
  databaseUrl: process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/orqland_om',
  corsOrigin: (process.env.CORS_ORIGIN ?? 'http://localhost:3000').split(',').map((s) => s.trim()),
  jwtSecret: process.env.JWT_SECRET ?? 'change-me-in-production',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? '12h',
  paymentWebhookSecret: process.env.PAYMENT_WEBHOOK_SECRET ?? 'dev-webhook-secret',
  enableSimulator: bool(process.env.ENABLE_SIMULATOR, true),
  enableDemoLogin: bool(process.env.ENABLE_DEMO_LOGIN, true),
  assignmentExpirySweepMs: Number(process.env.ASSIGNMENT_EXPIRY_SWEEP_MS ?? 15000),
};

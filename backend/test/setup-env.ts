// Must be imported first by integration tests: points the module at the TEST database.
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/orqland_om_test';
process.env.ENABLE_SIMULATOR = 'true';
process.env.ASSIGNMENT_EXPIRY_SWEEP_MS = '0';

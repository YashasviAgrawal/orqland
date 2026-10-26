import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { DomainError } from '../domain/engine';

/** Errors with a stable `code` the frontend can react to. */
export class AppError extends HttpException {
  constructor(status: HttpStatus, code: string, message: string, details?: Record<string, unknown>) {
    super({ statusCode: status, code, message, details }, status);
  }
}

export const conflict = (code: string, message: string, details?: Record<string, unknown>) =>
  new AppError(HttpStatus.CONFLICT, code, message, details);
export const notFound = (what: string) => new AppError(HttpStatus.NOT_FOUND, 'NOT_FOUND', `${what} not found`);
export const badRequest = (message: string, details?: Record<string, unknown>) =>
  new AppError(HttpStatus.BAD_REQUEST, 'VALIDATION', message, details);
export const forbidden = (message = 'You do not have access to this') => new AppError(HttpStatus.FORBIDDEN, 'FORBIDDEN', message);

interface PgError {
  code?: string;
  constraint?: string;
  message?: string;
  detail?: string;
}

/** Translate PostgreSQL constraint violations into user-friendly 409s. */
export function translateDbError(err: PgError): { status: number; code: string; message: string } | null {
  if (!err || typeof err.code !== 'string' || err.code.length !== 5) return null;
  const c = err.constraint ?? '';
  switch (err.code) {
    case '23505': // unique_violation
      if (c === 'orders_customer_slot_active_uq') return { status: 409, code: 'DUPLICATE_BOOKING', message: 'This customer already has a booking for that slot.' };
      if (c === 'orders_idempotency') return { status: 409, code: 'DUPLICATE_REQUEST', message: 'This order was already submitted.' };
      if (c === 'delivery_one_active_assignment') return { status: 409, code: 'ALREADY_ASSIGNED', message: 'This order already has an active delivery assignment.' };
      if (c === 'payments_one_success_per_order') return { status: 409, code: 'ALREADY_PAID', message: 'A successful payment already exists for this order.' };
      if (c === 'order_requests_one_open_per_type') return { status: 409, code: 'REQUEST_EXISTS', message: 'A similar request is already pending.' };
      return { status: 409, code: 'DUPLICATE', message: 'This record already exists.' };
    case '23P01': // exclusion_violation
      return { status: 409, code: 'PROVIDER_CONFLICT', message: 'The service provider already has a booking at that time.' };
    case '23514': // check_violation
      if (c === 'slot_capacity_ok') return { status: 409, code: 'CAPACITY_EXCEEDED', message: 'Not enough capacity left in this slot.' };
      if (c === 'listings_stock_check') return { status: 409, code: 'OUT_OF_STOCK', message: 'Not enough stock.' };
      return { status: 409, code: 'INVALID_STATE', message: err.message ?? 'The change violates a business rule.' };
    case '40001':
    case '40P01':
      return { status: 409, code: 'CONCURRENT_UPDATE', message: 'Someone else changed this at the same time — please retry.' };
    default:
      return null;
  }
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Errors');

  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<{ status: (n: number) => { json: (b: unknown) => void } }>();

    if (exception instanceof DomainError) {
      const status =
        exception.code === 'FORBIDDEN' ? 403 : exception.code === 'UNKNOWN_ACTION' || exception.code === 'VALIDATION' ? 400 : exception.code === 'CONFLICT' ? 409 : 422;
      res.status(status).json({ statusCode: status, code: exception.code, message: exception.message, details: exception.details });
      return;
    }
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      if (typeof body === 'object' && body !== null) {
        const b = body as { message?: string | string[]; code?: string; details?: unknown };
        const message = Array.isArray(b.message) ? b.message.join(', ') : b.message ?? exception.message;
        res.status(status).json({ statusCode: status, code: b.code ?? HttpStatus[status] ?? 'ERROR', message, details: b.details });
      } else {
        res.status(status).json({ statusCode: status, code: HttpStatus[status] ?? 'ERROR', message: String(body) });
      }
      return;
    }
    const pg = translateDbError(exception as PgError);
    if (pg) {
      res.status(pg.status).json({ statusCode: pg.status, code: pg.code, message: pg.message });
      return;
    }
    this.logger.error(exception instanceof Error ? exception.stack ?? exception.message : String(exception));
    res.status(500).json({ statusCode: 500, code: 'INTERNAL', message: 'Something went wrong. Please try again.' });
  }
}

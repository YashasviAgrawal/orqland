import { Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { config } from '../config';
import { OrderActionsService } from '../orders/order-actions.service';

/**
 * Expires delivery offers that were not accepted within the configurable period (§7) and
 * (optionally) re-offers them to the next available agent. Offers are also expired lazily
 * whenever the order is touched, so the sweep interval only affects how fast the queue updates.
 */
@Injectable()
export class AssignmentExpiryJob implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(AssignmentExpiryJob.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(private readonly actions: OrderActionsService) {}

  onApplicationBootstrap(): void {
    if (config.assignmentExpirySweepMs <= 0) return;
    this.timer = setInterval(() => void this.tick(), config.assignmentExpirySweepMs);
  }

  onApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const n = await this.actions.expireDueAssignments();
      if (n) this.logger.log(`Expired ${n} unaccepted delivery offer(s)`);
    } catch (err) {
      this.logger.error(`Expiry sweep failed: ${err instanceof Error ? err.message : err}`);
    } finally {
      this.running = false;
    }
  }
}

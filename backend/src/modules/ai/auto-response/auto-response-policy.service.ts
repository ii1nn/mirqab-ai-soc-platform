import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { ResponseSlaService } from '../response-sla/response-sla.service';

/**
 * The scheduler tick for automated containment — and nothing else. Every
 * ~30s it calls ResponseSlaService.sweep(), the single authoritative 5-minute
 * response window (see that service for the full state machine).
 *
 * Previously this service owned two independent isolation paths with
 * different timings; both have been removed and must not be reintroduced:
 *  - a 3-minute similarity-gated "AI auto-response" window
 *    (applyAiAutoResponseIfDue / AiService.evaluateAiAutoResponse), and
 *  - a 15/30-minute severity SLA (applyContainmentPolicy /
 *    isPastResponseDeadline) that ignored both acknowledgement and the
 *    policy kill switch.
 * The "AI Auto-Response (3-Minute Isolation Window)" policy row is kept in
 * the database for history but no longer controls any execution.
 */
@Injectable()
export class AutoResponsePolicyService {
  private readonly logger = new Logger(AutoResponsePolicyService.name);

  constructor(private readonly responseSla: ResponseSlaService) {}

  @Interval('auto-response-policy-sweep', 30_000)
  async sweep(): Promise<void> {
    try {
      await this.responseSla.sweep();
    } catch (error) {
      this.logger.error(
        `Response-window sweep failed: ${error instanceof Error ? error.message : error}`,
      );
    }
  }
}

import { IsISO8601, IsOptional } from 'class-validator';

export class GetWeeklySummaryDto {
  /** Any date within the target week (Sunday-Saturday, UTC) — omit for the
   * current (possibly still in-progress) week, matching the Weekly SOC
   * Summary card's existing default behavior. */
  @IsOptional()
  @IsISO8601()
  weekStart?: string;
}

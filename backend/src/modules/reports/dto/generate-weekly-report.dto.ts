import { IsISO8601, IsOptional } from 'class-validator';

export class GenerateWeeklyReportDto {
  /** Any date within the target week (Sunday-Saturday, UTC) — omit to
   * regenerate/generate the most recently completed week. */
  @IsOptional()
  @IsISO8601()
  weekStart?: string;
}

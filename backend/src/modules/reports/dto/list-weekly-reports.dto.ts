import { IsISO8601, IsOptional } from 'class-validator';

/** Requirement #38: "Report search by reporting period." */
export class ListWeeklyReportsDto {
  @IsOptional()
  @IsISO8601()
  from?: string;

  @IsOptional()
  @IsISO8601()
  to?: string;
}

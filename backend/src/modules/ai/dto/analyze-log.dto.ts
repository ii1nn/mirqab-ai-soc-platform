import { IsIn, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

export class AnalyzeLogDto {
  @IsString()
  @MinLength(10, { message: 'sourceExcerpt must be at least 10 characters' })
  @MaxLength(50_000, { message: 'sourceExcerpt must be at most 50,000 characters' })
  sourceExcerpt!: string;

  /** departmentId is deliberately not accepted here — AiService derives it from the device relation. */
  @IsOptional()
  @IsUUID()
  deviceId?: string;

  /** The only provenance a client of this endpoint may self-declare — used
   * by Simulation Mode to tag its synthetic traffic so it never looks
   * identical to real open-source-dataset-derived evidence in the DB/UI.
   * Anything else (OPEN_SOURCE_DATASET, LIVE_AGENT) can only be set by
   * trusted server-side ingestion code, never from a request body — an
   * omitted value here defaults to MANUAL_TEST server-side. */
  @IsOptional()
  @IsIn(['SIMULATION'])
  source?: 'SIMULATION';
}

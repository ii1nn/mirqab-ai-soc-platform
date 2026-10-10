import { IncidentActionOutcome, IncidentActionType } from '@prisma/client';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateIncidentActionDto {
  @IsEnum(IncidentActionType)
  type!: IncidentActionType;

  @IsOptional()
  @IsEnum(IncidentActionOutcome)
  outcome?: IncidentActionOutcome;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}

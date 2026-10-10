import { IncidentActionOutcome } from '@prisma/client';
import { IsEnum } from 'class-validator';

export class UpdateIncidentActionDto {
  @IsEnum(IncidentActionOutcome)
  outcome!: IncidentActionOutcome;
}

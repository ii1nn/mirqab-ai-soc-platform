import { IncidentStatus } from '@prisma/client';
import { IsEnum } from 'class-validator';

export class UpdateIncidentStatusDto {
  @IsEnum(IncidentStatus)
  status!: IncidentStatus;
}

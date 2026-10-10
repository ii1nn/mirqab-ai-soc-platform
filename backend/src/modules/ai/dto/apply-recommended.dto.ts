import { IncidentActionType } from '@prisma/client';
import { ArrayMinSize, IsEnum } from 'class-validator';

export class ApplyRecommendedDto {
  @ArrayMinSize(1)
  @IsEnum(IncidentActionType, { each: true })
  types!: IncidentActionType[];
}

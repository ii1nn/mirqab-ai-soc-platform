import { IsOptional, IsString, MaxLength } from 'class-validator';

export class RejectIncidentActionDto {
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  reason?: string;
}

import { IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateIncidentResolutionDto {
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  rootCause?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  finalResolution?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  lessonsLearned?: string;
}

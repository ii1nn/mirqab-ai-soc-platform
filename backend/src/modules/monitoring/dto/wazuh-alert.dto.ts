import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, MaxLength, Min, ValidateNested } from 'class-validator';

/** Mirrors the fields Wazuh's custom-integration script forwards from an alert JSON. */
class WazuhRuleDto {
  @IsString()
  @MaxLength(255)
  id!: string;

  @IsInt()
  @Min(0)
  level!: number;

  @IsString()
  @MaxLength(2000)
  description!: string;
}

class WazuhAgentDto {
  @IsString()
  @MaxLength(255)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  id?: string;
}

export class WazuhAlertDto {
  @ValidateNested()
  @Type(() => WazuhRuleDto)
  rule!: WazuhRuleDto;

  @ValidateNested()
  @Type(() => WazuhAgentDto)
  agent!: WazuhAgentDto;

  @IsString()
  @MaxLength(20_000)
  full_log!: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  location?: string;
}

import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, MaxLength, Min, ValidateNested } from 'class-validator';

class SuricataAlertDetailsDto {
  @IsString()
  @MaxLength(500)
  signature!: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  category?: string;

  @IsInt()
  @Min(1)
  severity!: number;
}

/**
 * Suricata's native eve.json "alert" event has no field identifying which
 * monitored host it came from — that's added by whatever ships the log
 * (Filebeat/Vector) as `host`, which is what we key device lookup on.
 */
export class SuricataAlertDto {
  @IsString()
  @MaxLength(255)
  host!: string;

  @IsIn(['alert'])
  event_type!: string;

  @IsString()
  @MaxLength(64)
  src_ip!: string;

  @IsString()
  @MaxLength(64)
  dest_ip!: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  proto?: string;

  @ValidateNested()
  @Type(() => SuricataAlertDetailsDto)
  alert!: SuricataAlertDetailsDto;
}

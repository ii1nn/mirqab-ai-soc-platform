import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

/**
 * Fields vary by Sysmon Event ID (1 = ProcessCreate, 3 = NetworkConnect,
 * 11 = FileCreate, ...) — only Computer/EventID are guaranteed present,
 * everything else is optional depending on which event fired.
 */
export class SysmonEventDto {
  @IsString()
  @MaxLength(255)
  Computer!: string;

  @IsInt()
  EventID!: number;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  Image?: string;

  @IsOptional()
  @IsString()
  @MaxLength(8000)
  CommandLine?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  User?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  ParentImage?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  TargetFilename?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  DestinationIp?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(65535)
  DestinationPort?: number;
}

import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

/**
 * A normalized network event as a real PcapMonkey deployment (pcap ->
 * Zeek/Suricata -> Elasticsearch, in Elastic Common Schema) would emit.
 * `dataset` mirrors ECS's `event.dataset` (e.g. "zeek.notice", "zeek.dns");
 * `detail` is a normalized, protocol-specific one-line summary — same
 * decoded/raw split every other monitoring DTO uses.
 */
export class PcapEventDto {
  @IsString()
  @MaxLength(255)
  dataset!: string;

  @IsString()
  @MaxLength(64)
  sourceIp!: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(65535)
  sourcePort?: number;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  destinationIp?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(65535)
  destinationPort?: number;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  transport?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  detail?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  timestamp?: string;
}

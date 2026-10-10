import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * Generic syslog-family source (rsyslog/syslog-ng-style forwarders) —
 * distinct from the vendor-specific DTOs (Wazuh/Suricata/Sysmon) since
 * SSH/Linux/Apache auth logs aren't produced by any single agent. `summary`
 * is a normalized, human-readable description of `rawLine` (the same
 * decoded-description/raw-log split WazuhAlertDto uses for `rule.description`
 * vs `full_log`).
 */
export class SyslogEventDto {
  @IsString()
  @MaxLength(255)
  host!: string;

  @IsIn(['ssh', 'linux', 'apache'])
  program!: 'ssh' | 'linux' | 'apache';

  @IsString()
  @MaxLength(2000)
  summary!: string;

  @IsString()
  @MaxLength(20_000)
  rawLine!: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  timestamp?: string;
}

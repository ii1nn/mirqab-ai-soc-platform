import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

/** Body the isolation/unisolation script itself POSTs back after it actually
 * runs — see infra/monitoring/wazuh/active-response/isolate-host.sh. This is
 * the real evidence WazuhActiveResponseProvider.isolate() waits on; the
 * Wazuh manager's own "dispatched" response is deliberately not trusted
 * alone (see that class's doc comment for why). */
export class ActiveResponseResultDto {
  @IsString()
  @MaxLength(255)
  hostname!: string;

  @IsBoolean()
  success!: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  detail?: string;
}

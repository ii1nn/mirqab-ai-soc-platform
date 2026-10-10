import { Body, Controller, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../../common/decorators/public.decorator';
import { PcapEventDto } from './dto/pcap-event.dto';
import { SuricataAlertDto } from './dto/suricata-alert.dto';
import { SyslogEventDto } from './dto/syslog-event.dto';
import { SysmonEventDto } from './dto/sysmon-event.dto';
import { WazuhAlertDto } from './dto/wazuh-alert.dto';
import { MonitoringApiKeyGuard } from './guards/monitoring-api-key.guard';
import { MonitoringService } from './monitoring.service';

/**
 * Called by headless monitoring agents/forwarders, not the SOC Dashboard —
 * @Public() opts these routes out of the global JwtAuthGuard, and
 * MonitoringApiKeyGuard is the actual gate (see docs/phases/phase-8.md).
 * A real incident can burst far more than 100 events/min (the app-wide
 * default — see AppModule), so this raises the ceiling well above normal
 * human-driven traffic without removing the DoS backstop entirely.
 */
@Controller('monitoring')
@Public()
@UseGuards(MonitoringApiKeyGuard)
@Throttle({ default: { limit: 1000, ttl: 60_000 } })
export class MonitoringController {
  constructor(private readonly monitoringService: MonitoringService) {}

  @Post('wazuh')
  @HttpCode(HttpStatus.CREATED)
  ingestWazuh(@Body() dto: WazuhAlertDto) {
    return this.monitoringService.ingestWazuh(dto);
  }

  @Post('suricata')
  @HttpCode(HttpStatus.CREATED)
  ingestSuricata(@Body() dto: SuricataAlertDto) {
    return this.monitoringService.ingestSuricata(dto);
  }

  @Post('sysmon')
  @HttpCode(HttpStatus.CREATED)
  ingestSysmon(@Body() dto: SysmonEventDto) {
    return this.monitoringService.ingestSysmon(dto);
  }

  @Post('syslog')
  @HttpCode(HttpStatus.CREATED)
  ingestSyslog(@Body() dto: SyslogEventDto) {
    return this.monitoringService.ingestSyslog(dto);
  }

  @Post('pcap')
  @HttpCode(HttpStatus.CREATED)
  ingestPcap(@Body() dto: PcapEventDto) {
    return this.monitoringService.ingestPcap(dto);
  }
}

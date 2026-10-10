import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { DevicesModule } from '../devices/devices.module';
import { EvtxSamplesController } from './evtx-samples/evtx-samples.controller';
import { EvtxSamplesService } from './evtx-samples/evtx-samples.service';
import { MonitoringApiKeyGuard } from './guards/monitoring-api-key.guard';
import { LoghubSamplesController } from './loghub-samples/loghub-samples.controller';
import { LoghubSamplesService } from './loghub-samples/loghub-samples.service';
import { MonitoringController } from './monitoring.controller';
import { MonitoringService } from './monitoring.service';
import { PcapSamplesController } from './pcap-samples/pcap-samples.controller';
import { PcapSamplesService } from './pcap-samples/pcap-samples.service';
import { WazuhLogtestClient } from './wazuh-logtest/wazuh-logtest.client';
import { WazuhSamplesController } from './wazuh-samples/wazuh-samples.controller';
import { WazuhSamplesService } from './wazuh-samples/wazuh-samples.service';

@Module({
  imports: [AiModule, DevicesModule],
  controllers: [
    MonitoringController,
    WazuhSamplesController,
    LoghubSamplesController,
    PcapSamplesController,
    EvtxSamplesController,
  ],
  providers: [
    MonitoringService,
    MonitoringApiKeyGuard,
    WazuhSamplesService,
    LoghubSamplesService,
    PcapSamplesService,
    EvtxSamplesService,
    WazuhLogtestClient,
  ],
  // Reused by DemoDataService so demo PCAP events go through the exact same
  // ingestPcap() parser path as live/sample traffic.
  exports: [MonitoringService],
})
export class MonitoringModule {}

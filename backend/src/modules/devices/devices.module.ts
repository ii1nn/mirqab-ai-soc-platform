import { Module } from '@nestjs/common';
import { DeviceAccessGuard } from '../../common/guards/device-access.guard';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { MonitoringApiKeyGuard } from '../monitoring/guards/monitoring-api-key.guard';
import { DevicesController } from './devices.controller';
import { DevicesService } from './devices.service';
import { EndpointControlController } from './endpoint-control/endpoint-control.controller';
import { EndpointControlService } from './endpoint-control/endpoint-control.service';
import { WazuhActiveResponseProvider } from './endpoint-control/wazuh-active-response.provider';

@Module({
  imports: [AuditLogsModule],
  controllers: [DevicesController, EndpointControlController],
  providers: [
    DevicesService,
    DeviceAccessGuard,
    EndpointControlService,
    WazuhActiveResponseProvider,
    MonitoringApiKeyGuard,
  ],
  exports: [DevicesService, EndpointControlService],
})
export class DevicesModule {}

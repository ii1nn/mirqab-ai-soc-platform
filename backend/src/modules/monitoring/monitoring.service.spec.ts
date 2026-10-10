import { Test } from '@nestjs/testing';
import { EventSource } from '@prisma/client';
import { AiService } from '../ai/ai.service';
import { DevicesService } from '../devices/devices.service';
import { MonitoringService } from './monitoring.service';

describe('MonitoringService', () => {
  let service: MonitoringService;
  let aiService: { analyzeLog: jest.Mock };
  let devicesService: { findByHostname: jest.Mock; findByIpAddress: jest.Mock };

  beforeEach(async () => {
    aiService = { analyzeLog: jest.fn().mockResolvedValue({ incident: { id: 'incident-1' } }) };
    devicesService = { findByHostname: jest.fn(), findByIpAddress: jest.fn() };

    const moduleRef = await Test.createTestingModule({
      providers: [
        MonitoringService,
        { provide: AiService, useValue: aiService },
        { provide: DevicesService, useValue: devicesService },
      ],
    }).compile();

    service = moduleRef.get(MonitoringService);
  });

  describe('ingestWazuh', () => {
    it('builds a log excerpt from the rule/agent fields and resolves the device by agent name', async () => {
      devicesService.findByHostname.mockResolvedValue({ id: 'device-1' });

      await service.ingestWazuh({
        rule: { id: '5710', level: 10, description: 'Multiple authentication failures' },
        agent: { name: 'FIN-WKS-04', id: '004' },
        full_log: 'sshd: Failed password for invalid user admin from 10.0.0.5',
        location: '/var/log/auth.log',
      });

      expect(devicesService.findByHostname).toHaveBeenCalledWith('FIN-WKS-04');
      expect(aiService.analyzeLog).toHaveBeenCalledWith(
        expect.objectContaining({
          sourceExcerpt: expect.stringContaining('Multiple authentication failures'),
          deviceId: 'device-1',
          rawEvent: 'sshd: Failed password for invalid user admin from 10.0.0.5',
          ingestSource: 'LIVE_AGENT',
        }),
      );
      expect(aiService.analyzeLog.mock.calls[0][0].sourceExcerpt).toContain(
        'sshd: Failed password',
      );
    });

    it('ingests without a deviceId when the hostname has no registered device', async () => {
      devicesService.findByHostname.mockResolvedValue(null);

      await service.ingestWazuh({
        rule: { id: '100', level: 3, description: 'Test rule' },
        agent: { name: 'UNKNOWN-HOST' },
        full_log: 'some log line',
      });

      expect(aiService.analyzeLog).toHaveBeenCalledWith(
        expect.objectContaining({
          sourceExcerpt: expect.any(String),
          deviceId: undefined,
        }),
      );
    });

    it('tags a dataset-seed call with OPEN_SOURCE_DATASET provenance and preserves the raw line', async () => {
      devicesService.findByHostname.mockResolvedValue(null);

      await service.ingestWazuh(
        {
          rule: { id: '100', level: 3, description: 'Test rule' },
          agent: { name: 'UNKNOWN-HOST' },
          full_log: 'some log line',
        },
        {
          ingestSource: EventSource.OPEN_SOURCE_DATASET,
          datasetOrigin: 'wazuh-sample-logs',
          rawEvent: 'original raw line',
        },
      );

      expect(aiService.analyzeLog).toHaveBeenCalledWith(
        expect.objectContaining({
          ingestSource: 'OPEN_SOURCE_DATASET',
          datasetOrigin: 'wazuh-sample-logs',
          rawEvent: 'original raw line',
        }),
      );
    });
  });

  describe('ingestSuricata', () => {
    it('builds a log excerpt from the alert/flow fields and resolves the device by host', async () => {
      devicesService.findByHostname.mockResolvedValue({ id: 'device-2' });

      await service.ingestSuricata({
        host: 'ACCT-LAPTOP-12',
        event_type: 'alert',
        src_ip: '10.0.0.9',
        dest_ip: '203.0.113.4',
        proto: 'TCP',
        alert: {
          signature: 'ET SCAN Nmap Scripting Engine',
          category: 'Attempted Information Leak',
          severity: 2,
        },
      });

      expect(devicesService.findByHostname).toHaveBeenCalledWith('ACCT-LAPTOP-12');
      const excerpt = aiService.analyzeLog.mock.calls[0][0].sourceExcerpt;
      expect(excerpt).toContain('ET SCAN Nmap Scripting Engine');
      expect(excerpt).toContain('10.0.0.9 -> 203.0.113.4');
    });
  });

  describe('ingestSysmon', () => {
    it('builds a log excerpt naming the Sysmon event type and resolves the device by Computer', async () => {
      devicesService.findByHostname.mockResolvedValue({ id: 'device-3' });

      await service.ingestSysmon({
        Computer: 'HR-DESKTOP-02',
        EventID: 1,
        Image: 'C:\\Windows\\System32\\cmd.exe',
        CommandLine: 'cmd.exe /c whoami',
        User: 'CORP\\jsmith',
        ParentImage: 'C:\\Windows\\explorer.exe',
      });

      expect(devicesService.findByHostname).toHaveBeenCalledWith('HR-DESKTOP-02');
      const excerpt = aiService.analyzeLog.mock.calls[0][0].sourceExcerpt;
      expect(excerpt).toContain('Process Create');
      expect(excerpt).toContain('cmd.exe /c whoami');
    });

    it('labels an unmapped event ID generically rather than failing', async () => {
      devicesService.findByHostname.mockResolvedValue({ id: 'device-4' });

      await service.ingestSysmon({ Computer: 'HOST-1', EventID: 255 });

      const excerpt = aiService.analyzeLog.mock.calls[0][0].sourceExcerpt;
      expect(excerpt).toContain('Sysmon Event ID 255');
    });
  });

  describe('ingestPcap', () => {
    it('builds a log excerpt from the flow/detail fields and resolves the device by source IP', async () => {
      devicesService.findByIpAddress.mockResolvedValue({ id: 'device-5' });

      await service.ingestPcap({
        dataset: 'zeek.notice',
        sourceIp: '10.12.1.101',
        sourcePort: 49804,
        destinationIp: '167.71.138.137',
        destinationPort: 443,
        transport: 'tcp',
        detail:
          'Zeek security notice "SSL::Invalid_Server_Cert": SSL certificate validation failed',
      });

      expect(devicesService.findByIpAddress).toHaveBeenCalledWith('10.12.1.101');
      const excerpt = aiService.analyzeLog.mock.calls[0][0].sourceExcerpt;
      expect(excerpt).toContain('zeek.notice');
      expect(excerpt).toContain('SSL::Invalid_Server_Cert');
      expect(excerpt).toContain('10.12.1.101:49804 -> 167.71.138.137:443 (tcp)');
      expect(aiService.analyzeLog.mock.calls[0][0].deviceId).toBe('device-5');
    });

    it('ingests without a deviceId when the source IP has no registered device', async () => {
      devicesService.findByIpAddress.mockResolvedValue(null);

      await service.ingestPcap({ dataset: 'zeek.dns', sourceIp: '203.0.113.9' });

      expect(aiService.analyzeLog).toHaveBeenCalledWith(
        expect.objectContaining({
          sourceExcerpt: expect.any(String),
          deviceId: undefined,
        }),
      );
    });
  });
});

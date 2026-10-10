import { apiClient } from './api-client';

export interface WazuhSampleSeedResult {
  ingested: number;
  skipped?: number;
  totalLines?: number;
  error?: string;
  incidents: Array<{
    agent: string;
    incidentId: string;
    caseId?: string;
    severity: string;
    ticketCreated: boolean;
    /** true only if a configured, reachable Wazuh Logtest API produced this event's rule/MITRE
     * mapping (Integration Phase 3) — false means the bundled heuristic decoder was used instead. */
    enrichedByLogtest: boolean;
  }>;
}

export interface LoghubSampleSeedResult {
  ingested: number;
  skipped?: number;
  totalLines?: number;
  error?: string;
  incidents: Array<{
    category: string;
    host: string;
    incidentId: string;
    caseId?: string;
    severity: string;
    mitreTechniqueId: string;
    ticketCreated: boolean;
    enrichedByLogtest: boolean;
  }>;
}

export interface PcapSampleSeedResult {
  ingested: number;
  totalEvents?: number;
  error?: string;
  incidents: Array<{
    dataset: string;
    sourceIp: string;
    incidentId: string;
    caseId?: string;
    severity: string;
    mitreTechniqueId: string;
    ticketCreated: boolean;
  }>;
}

export interface EvtxSampleSeedResult {
  ingested: number;
  error?: string;
  incidents: Array<{
    file: string;
    eventId: string;
    incidentId: string;
    caseId?: string;
    severity: string;
    ticketCreated: boolean;
  }>;
}

export const monitoringService = {
  /** Reads every line of the real datasets/wazuh-sample-logs files from disk and replays each
   * one through /monitoring/wazuh — see backend MonitoringModule's wazuh-samples submodule. */
  async seedWazuhSamples(): Promise<WazuhSampleSeedResult> {
    const { data } = await apiClient.post<WazuhSampleSeedResult>('/monitoring/wazuh-samples/seed');
    return data;
  },

  /** Reads every line of the real datasets/loghub SSH/Linux/Apache files from disk and replays
   * each one through /monitoring/syslog — see backend MonitoringModule's loghub-samples submodule. */
  async seedLoghubSamples(): Promise<LoghubSampleSeedResult> {
    const { data } = await apiClient.post<LoghubSampleSeedResult>(
      '/monitoring/loghub-samples/seed',
    );
    return data;
  },

  /** Reads the real datasets/PcapMonkey/zeek-sample-events.json file from disk and replays every
   * record through /monitoring/pcap — see backend MonitoringModule's pcap-samples submodule. */
  async seedPcapSamples(): Promise<PcapSampleSeedResult> {
    const { data } = await apiClient.post<PcapSampleSeedResult>('/monitoring/pcap-samples/seed');
    return data;
  },

  /** Decodes the real datasets/EVTX-to-MITRE-Attack binary .evtx file via the backend's native
   * `wevtutil`-based parser and feeds every event through the real AI pipeline — see backend
   * MonitoringModule's evtx-samples submodule. Only succeeds on a Windows-hosted backend; on
   * Linux (e.g. this project's Docker deployment) it returns `error` explaining why, rather than
   * fabricating a result. */
  async seedEvtxSamples(): Promise<EvtxSampleSeedResult> {
    const { data } = await apiClient.post<EvtxSampleSeedResult>('/monitoring/evtx-samples/seed');
    return data;
  },
};

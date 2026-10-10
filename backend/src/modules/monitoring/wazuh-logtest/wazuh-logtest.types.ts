/**
 * Shapes taken directly from Wazuh's own published OpenAPI spec —
 * `api/api/spec/spec.yaml` in wazuh/wazuh (verified against the v4.9.0 tag:
 * `LogtestRequest` schema and the `/logtest` PUT response example). Not
 * guessed from memory; field names/nesting match the real API so a real
 * manager's response deserializes into these types unchanged.
 */

/** Request body for `PUT /logtest`. */
export interface LogtestRequest {
  /** Continues a prior session so repeated-rule "frequency" logic works — omitted on the first call. */
  token?: string;
  /** One of: syslog, json, snort-full, squid, eventlog, eventchannel, audit, mysql_log,
   * postgresql_log, nmapg, iis, command, full_command, djb-multilog, multi-line. */
  log_format: string;
  /** Free-form path-like string identifying the log source, e.g. "master->/var/log/syslog". */
  location: string;
  /** The raw log line to test. */
  event: string;
}

export interface LogtestRuleMitre {
  id?: string[];
  tactic?: string[];
  technique?: string[];
}

export interface LogtestRule {
  id: number;
  level: number;
  description: string;
  groups?: string[];
  firedtimes?: number;
  mitre?: LogtestRuleMitre;
}

export interface LogtestOutput {
  timestamp?: string;
  rule?: LogtestRule;
  agent?: { id?: string; name?: string };
  manager?: { name?: string };
  id?: string;
  full_log?: string;
  decoder?: { name?: string } | null;
  location?: string;
}

export interface LogtestResponseData {
  messages?: string[];
  token?: string;
  output?: LogtestOutput;
  alert?: boolean;
  codemsg?: number;
}

export interface LogtestApiResponse {
  error: number;
  data: LogtestResponseData;
}

import { SyslogEventDto } from '../dto/syslog-event.dto';

/**
 * Turns one raw LogHub sample line (see datasets/loghub) into the
 * `SyslogEventDto` shape a real syslog forwarder would send to
 * `/monitoring/syslog`. `summary` is a normalized, analyst-style
 * description of the raw line — same decoded/raw split as the Wazuh sample
 * parser (Integration Phase 1) — written accurately enough that genuine
 * brute-force bursts naturally read as such to the existing MITRE keyword
 * matcher (MitreMappingService), without hardcoding a technique ID here.
 */

const SYSLOG_LINE =
  /^(\w{3}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2})\s+(\S+)\s+([^:[]+?)(?:\[(\d+)\])?:\s*(.*)$/;
const APACHE_LINE = /^\[(.+?)\]\s\[(\w+)\]\s(.*)$/;

export function parseLoghubSampleLine(
  raw: string,
  category: 'ssh' | 'linux' | 'apache',
): SyslogEventDto | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  return category === 'apache' ? parseApacheLine(trimmed) : parseSyslogLine(trimmed, category);
}

function parseSyslogLine(line: string, category: 'ssh' | 'linux'): SyslogEventDto | null {
  const match = SYSLOG_LINE.exec(line);
  if (!match) return null;

  const [, timestamp, host, , , message] = match;
  return {
    host,
    program: category,
    summary: summarizeAuthMessage(message),
    rawLine: line,
    timestamp,
  };
}

function summarizeAuthMessage(message: string): string {
  const lower = message.toLowerCase();

  if (
    lower.includes('possible break-in attempt') ||
    lower.includes('too many authentication failures')
  ) {
    return `Repeated failed authentication attempt flagged as a possible break-in (${message})`;
  }
  if (lower.includes('failed password') || lower.includes('authentication failure')) {
    return `Failed authentication attempt (${message})`;
  }
  if (lower.includes('invalid user')) {
    return `Failed login attempt for an invalid user account (${message})`;
  }
  if (lower.includes('accepted password') || lower.includes('accepted publickey')) {
    return `Successful login (${message})`;
  }
  if (lower.includes('session opened')) {
    return `Privileged session opened (${message})`;
  }
  return `Linux system event (${message})`;
}

function parseApacheLine(line: string): SyslogEventDto | null {
  const match = APACHE_LINE.exec(line);
  if (!match) return null;

  const [, timestamp, level, message] = match;
  const summary = level === 'error' ? `Apache error: ${message}` : `Apache ${level}: ${message}`;

  // Apache's error log format carries no hostname (unlike syslog) — it's a
  // per-server local file, so this is a fixed placeholder, not a parsed field.
  return { host: 'apache-web-01', program: 'apache', summary, rawLine: line, timestamp };
}

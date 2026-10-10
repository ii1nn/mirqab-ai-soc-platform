import { WazuhAlertDto } from '../dto/wazuh-alert.dto';

/**
 * A real Wazuh manager decodes/matches a raw log line against its
 * decoders/rules before ever calling out (see datasets/wazuh-sample-logs's
 * custom-decoders.xml/custom-rules.xml) — this replicates just enough of
 * that step for the bundled sample lines, producing the same
 * `{ rule, agent, full_log }` shape a real Wazuh integration script would
 * POST to `/monitoring/wazuh`. Phase 3's Logtest client is the real
 * decode/rule-match path; this is a lightweight stand-in for these specific
 * sample formats only.
 */

const AWS_SENSITIVE_EVENTS = new Set([
  'CreateUser',
  'DeleteUser',
  'AddUserToGroup',
  'AttachUserPolicy',
  'CreateAccessKey',
  'CreateKeyPair',
  'StopInstances',
  'StartInstances',
  'DeleteTrail',
  'ConsoleLogin',
  'PutBucketPolicy',
  'DeleteBucket',
]);

const FORTIGATE_LEVEL_MAP: Record<string, number> = {
  emergency: 15,
  alert: 14,
  critical: 13,
  error: 10,
  warning: 7,
  notice: 5,
  information: 3,
  debug: 1,
};

export function parseWazuhSampleLine(raw: string): WazuhAlertDto | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  if (trimmed.startsWith('{')) {
    return parseJsonLine(trimmed);
  }
  if (trimmed.startsWith('date=')) {
    return parseFortigateLine(trimmed);
  }
  return null;
}

function parseJsonLine(line: string): WazuhAlertDto | null {
  let data: Record<string, any>;
  try {
    data = JSON.parse(line);
  } catch {
    return null;
  }

  if (data.Type === 'KubeEvents' || data.KubeEventType) {
    const level = data.KubeEventType === 'Warning' ? 8 : 3;
    return {
      rule: {
        id: 'k8s-event',
        level,
        description: `Kubernetes ${data.ObjectKind ?? 'object'} event: ${data.Reason}`,
      },
      agent: { name: data.Computer ?? data.ClusterName ?? 'kubernetes-cluster' },
      full_log: line,
      location: data.ClusterName,
    };
  }

  if (data.integration === 'aws' && data.aws) {
    const evt = data.aws;
    const eventName: string = evt.eventName ?? 'UnknownEvent';
    const level = AWS_SENSITIVE_EVENTS.has(eventName) ? 9 : 3;
    const user = evt.userIdentity?.userName ?? evt.userIdentity?.type ?? 'unknown';
    return {
      rule: {
        id: 'aws-cloudtrail',
        level,
        description: `AWS CloudTrail: ${eventName} on ${evt.eventSource ?? 'unknown-service'} by ${user}`,
      },
      agent: { name: `aws-account-${evt.recipientAccountId ?? 'unknown'}` },
      full_log: line,
      location: evt.awsRegion,
    };
  }

  return null;
}

function parseFortigateLine(line: string): WazuhAlertDto | null {
  const fields: Record<string, string> = {};
  const regex = /(\w+)=("(?:[^"\\]|\\.)*"|\S+)/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(line))) {
    fields[match[1]] = match[2].replace(/^"|"$/g, '');
  }

  if (!fields.devname && !fields.logid) return null;

  const level = FORTIGATE_LEVEL_MAP[fields.level] ?? 5;
  return {
    rule: {
      id: `fortigate-${fields.logid ?? 'unknown'}`,
      level,
      description: fields.logdesc ?? fields.msg ?? 'Fortigate event',
    },
    agent: { name: fields.devname ?? 'fortigate-fw' },
    full_log: line,
  };
}

import { readFileSync } from 'fs';
import { datasetPath } from '../dataset-path.util';

/**
 * Reads every line of the real datasets/wazuh-sample-logs files from disk at
 * call time — the full bundled sample (both the JSON/Kubernetes+CloudTrail
 * file and the Fortigate plaintext file), not a hand-picked subset baked
 * into source. BOM-stripped (the upstream files ship a UTF-8 BOM on their
 * first line). Throws if the dataset can't be read — callers surface that as
 * an honest failure rather than silently ingesting nothing.
 */
export function loadWazuhSampleLines(): string[] {
  const files = ['sample-logs.json.txt', 'sample-logs.plain.txt'];
  const lines: string[] = [];
  for (const file of files) {
    let raw = readFileSync(datasetPath('wazuh-sample-logs', file), 'utf-8');
    if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1);
    lines.push(
      ...raw
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean),
    );
  }
  return lines;
}

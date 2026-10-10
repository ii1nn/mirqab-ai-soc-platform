import { readFileSync } from 'fs';
import { datasetPath } from '../dataset-path.util';

/**
 * Reads the real datasets/loghub sample files from disk at call time — all
 * 40 lines of each file, not a hand-picked subset baked into source.
 * `linux-sample.log` doubles as the "Authentication" category per this
 * integration's scope (loghub has no separate Authentication folder and
 * these lines are exactly that — see datasets/loghub/NOTES.md).
 */
function loadLines(file: string): string[] {
  let raw = readFileSync(datasetPath('loghub', file), 'utf-8');
  if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1);
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

export function loadLoghubSshLines(): string[] {
  return loadLines('openssh-sample.log');
}

export function loadLoghubLinuxLines(): string[] {
  return loadLines('linux-sample.log');
}

export function loadLoghubApacheLines(): string[] {
  return loadLines('apache-sample.log');
}

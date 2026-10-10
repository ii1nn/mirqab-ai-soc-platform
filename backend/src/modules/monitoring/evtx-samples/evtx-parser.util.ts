import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

export interface EvtxEvent {
  eventId: string;
  date: string;
  computer: string;
  logName: string;
  /** The structured, human-readable per-event text Windows itself resolved
   * (Subject/Logon Type/Failure Information/etc.), with the generic
   * multi-paragraph help text Microsoft appends to every rendering trimmed
   * off. Real, OS-resolved content — never authored or guessed here. */
  description: string;
  /** The complete, untouched per-event `wevtutil` text block, verbatim. */
  raw: string;
}

/** wevtutil is a Windows-only, OS-native tool — there is no cross-platform
 * equivalent bundled here. Callers must check this first and degrade
 * gracefully (report "cannot parse", never fabricate) when it's false. */
export function isWevtutilAvailable(): boolean {
  return process.platform === 'win32';
}

/**
 * Decodes a real .evtx file using Windows' own native `wevtutil` — the exact
 * tool (via `Get-WinEvent`) a human would use to read the same file. No
 * bundled EVTX parser library, no reimplementation of Microsoft's binary
 * format, no invented field values: every field either comes from wevtutil's
 * own resolved output or is left absent.
 */
export async function parseEvtxFile(path: string): Promise<EvtxEvent[]> {
  const { stdout } = await execFileAsync('wevtutil', ['qe', path, '/lf:true', '/f:text'], {
    maxBuffer: 10 * 1024 * 1024,
  });
  return parseWevtutilText(stdout);
}

/** Exported separately from parseEvtxFile so the text-parsing logic can be
 * unit-tested without shelling out to a real wevtutil binary. */
export function parseWevtutilText(output: string): EvtxEvent[] {
  const blocks = output
    .split(/(?=^Event\[\d+\]$)/m)
    .map((block) => block.trim())
    .filter(Boolean);

  return blocks.map((block) => {
    const eventId = /Event ID:\s*(\d+)/.exec(block)?.[1] ?? 'unknown';
    const date = /Date:\s*(\S+)/.exec(block)?.[1] ?? '';
    const computer = /Computer:\s*(\S+)/.exec(block)?.[1] ?? '';
    const logName = /Log Name:\s*(\S+)/.exec(block)?.[1] ?? '';

    const descMatch = /Description:\s*\n([\s\S]*)$/.exec(block);
    let description = descMatch ? descMatch[1].trim() : block;
    const boilerplateIndex = description.indexOf('This event is generated');
    if (boilerplateIndex > 0) {
      description = description.slice(0, boilerplateIndex).trim();
    }

    return { eventId, date, computer, logName, description, raw: block };
  });
}

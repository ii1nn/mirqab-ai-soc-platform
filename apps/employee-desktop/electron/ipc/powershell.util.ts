import { execFile } from 'node:child_process';

/**
 * Runs a fixed PowerShell command (every call site in this codebase passes a
 * hardcoded string, never one built from user input) and returns stdout.
 * Windows-only; callers must catch and degrade gracefully on other platforms
 * or when the underlying cmdlet/module is unavailable (e.g. Defender absent,
 * insufficient privileges).
 */
export function runPowerShell(command: string, timeoutMs = 15_000): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', command],
      { timeout: timeoutMs, maxBuffer: 10 * 1024 * 1024, windowsHide: true },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(stderr || error.message));
          return;
        }
        resolve(stdout.trim());
      },
    );
  });
}

export function parsePowerShellJson<T>(raw: string): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/** ConvertTo-Json emits a single object (not an array) when there's exactly one row. */
export function asArray<T>(value: T | T[] | null): T[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

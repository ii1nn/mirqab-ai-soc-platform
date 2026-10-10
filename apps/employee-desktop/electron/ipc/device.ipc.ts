import * as os from 'node:os';
import { ipcMain } from 'electron';
import { IpcChannel } from './channels';
import { asArray, parsePowerShellJson, runPowerShell } from './powershell.util';

const IS_WINDOWS = process.platform === 'win32';

export interface DeviceInfo {
  hostname: string;
  platform: NodeJS.Platform;
  osRelease: string;
  arch: string;
  cpuModel: string;
  cpuCores: number;
  totalMemoryBytes: number;
}

export interface DiskInfo {
  drive: string;
  totalBytes: number;
  freeBytes: number;
}

export interface DefenderStatus {
  supported: boolean;
  antivirusEnabled?: boolean;
  realTimeProtectionEnabled?: boolean;
  signatureLastUpdated?: string;
}

export interface FirewallProfileStatus {
  supported: boolean;
  profiles: { name: string; enabled: boolean }[];
}

export interface DeviceMetrics {
  cpuLoadPercent: number;
  memoryUsedPercent: number;
  totalMemoryBytes: number;
  freeMemoryBytes: number;
  uptimeSeconds: number;
  disks: DiskInfo[];
  defender: DefenderStatus;
  firewall: FirewallProfileStatus;
}

export interface ProcessInfo {
  pid: number;
  name: string;
  cpuSeconds: number;
  memoryBytes: number;
}

export interface InstalledApp {
  name: string;
  version: string | null;
  publisher: string | null;
}

function cpuTimesSnapshot() {
  return os.cpus().map((cpu) => {
    const total = Object.values(cpu.times).reduce((sum, value) => sum + value, 0);
    return { idle: cpu.times.idle, total };
  });
}

/** os.loadavg() is always [0,0,0] on Windows, so load is derived by sampling
 *  os.cpus() twice a short interval apart and measuring the idle-time delta. */
async function getCpuLoadPercent(sampleWindowMs = 300): Promise<number> {
  const start = cpuTimesSnapshot();
  await new Promise((resolve) => setTimeout(resolve, sampleWindowMs));
  const end = cpuTimesSnapshot();

  let idleDelta = 0;
  let totalDelta = 0;
  for (let i = 0; i < start.length; i++) {
    idleDelta += end[i].idle - start[i].idle;
    totalDelta += end[i].total - start[i].total;
  }

  if (totalDelta <= 0) return 0;
  return Math.round((1 - idleDelta / totalDelta) * 100);
}

async function getDisks(): Promise<DiskInfo[]> {
  if (!IS_WINDOWS) return [];

  try {
    const raw = await runPowerShell(
      'Get-CimInstance Win32_LogicalDisk -Filter "DriveType=3" | ' +
        'Select-Object DeviceID,Size,FreeSpace | ConvertTo-Json -Compress',
    );
    const rows = asArray<Record<string, unknown>>(parsePowerShellJson<Record<string, unknown>>(raw));

    return rows.map((row) => ({
      drive: String(row.DeviceID ?? '?'),
      totalBytes: Number(row.Size ?? 0),
      freeBytes: Number(row.FreeSpace ?? 0),
    }));
  } catch {
    return [];
  }
}

async function getDefenderStatus(): Promise<DefenderStatus> {
  if (!IS_WINDOWS) return { supported: false };

  try {
    const raw = await runPowerShell(
      'Get-MpComputerStatus | Select-Object AntivirusEnabled,RealTimeProtectionEnabled,' +
        'AntivirusSignatureLastUpdated | ConvertTo-Json -Compress',
    );
    const parsed = parsePowerShellJson<Record<string, unknown>>(raw);
    if (!parsed) return { supported: false };

    return {
      supported: true,
      antivirusEnabled: Boolean(parsed.AntivirusEnabled),
      realTimeProtectionEnabled: Boolean(parsed.RealTimeProtectionEnabled),
      signatureLastUpdated: parsed.AntivirusSignatureLastUpdated
        ? String(parsed.AntivirusSignatureLastUpdated)
        : undefined,
    };
  } catch {
    // Get-MpComputerStatus fails when Defender is absent/disabled by a
    // third-party AV, or the module isn't available (non-Windows dev boxes).
    return { supported: false };
  }
}

async function getFirewallStatus(): Promise<FirewallProfileStatus> {
  if (!IS_WINDOWS) return { supported: false, profiles: [] };

  try {
    const raw = await runPowerShell(
      'Get-NetFirewallProfile | Select-Object Name,Enabled | ConvertTo-Json -Compress',
    );
    const rows = asArray<Record<string, unknown>>(parsePowerShellJson<Record<string, unknown>>(raw));

    return {
      supported: true,
      profiles: rows.map((row) => ({
        name: String(row.Name ?? 'Unknown'),
        enabled: Boolean(row.Enabled),
      })),
    };
  } catch {
    return { supported: false, profiles: [] };
  }
}

export function registerDeviceIpcHandlers(): void {
  ipcMain.handle(IpcChannel.DeviceGetInfo, (): DeviceInfo => {
    const cpus = os.cpus();
    return {
      hostname: os.hostname(),
      platform: os.platform(),
      osRelease: os.release(),
      arch: os.arch(),
      cpuModel: cpus[0]?.model ?? 'Unknown CPU',
      cpuCores: cpus.length,
      totalMemoryBytes: os.totalmem(),
    };
  });

  ipcMain.handle(IpcChannel.DeviceGetMetrics, async (): Promise<DeviceMetrics> => {
    const [cpuLoadPercent, disks, defender, firewall] = await Promise.all([
      getCpuLoadPercent(),
      getDisks(),
      getDefenderStatus(),
      getFirewallStatus(),
    ]);

    const totalMemoryBytes = os.totalmem();
    const freeMemoryBytes = os.freemem();

    return {
      cpuLoadPercent,
      memoryUsedPercent: Math.round(
        ((totalMemoryBytes - freeMemoryBytes) / totalMemoryBytes) * 100,
      ),
      totalMemoryBytes,
      freeMemoryBytes,
      uptimeSeconds: Math.round(os.uptime()),
      disks,
      defender,
      firewall,
    };
  });

  ipcMain.handle(IpcChannel.DeviceGetProcesses, async (): Promise<ProcessInfo[]> => {
    if (!IS_WINDOWS) return [];

    try {
      const raw = await runPowerShell(
        'Get-Process | Sort-Object CPU -Descending | Select-Object -First 15 ' +
          'Id,ProcessName,CPU,WorkingSet | ConvertTo-Json -Compress',
      );
      const rows = asArray<Record<string, unknown>>(parsePowerShellJson<Record<string, unknown>>(raw));

      return rows.map((row) => ({
        pid: Number(row.Id ?? 0),
        name: String(row.ProcessName ?? 'unknown'),
        cpuSeconds: Number(row.CPU ?? 0),
        memoryBytes: Number(row.WorkingSet ?? 0),
      }));
    } catch {
      return [];
    }
  });

  ipcMain.handle(IpcChannel.DeviceGetInstalledApps, async (): Promise<InstalledApp[]> => {
    if (!IS_WINDOWS) return [];

    try {
      const raw = await runPowerShell(
        "Get-ItemProperty 'HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*'," +
          "'HKLM:\\Software\\Wow6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*' " +
          '-ErrorAction SilentlyContinue | Where-Object { $_.DisplayName } | ' +
          'Select-Object DisplayName,DisplayVersion,Publisher | Sort-Object DisplayName | ' +
          'ConvertTo-Json -Compress',
      );
      const rows = asArray<Record<string, unknown>>(parsePowerShellJson<Record<string, unknown>>(raw));

      return rows
        .map((row) => ({
          name: String(row.DisplayName ?? 'Unknown'),
          version: row.DisplayVersion ? String(row.DisplayVersion) : null,
          publisher: row.Publisher ? String(row.Publisher) : null,
        }))
        .slice(0, 200);
    } catch {
      return [];
    }
  });
}

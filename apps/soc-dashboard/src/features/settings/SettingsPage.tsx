import {
  CheckCircle2,
  Database,
  type LucideIcon,
  Loader2,
  Monitor,
  Moon,
  Play,
  Square,
  Sun,
  XCircle,
} from 'lucide-react';
import { useState } from 'react';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { useDevices } from '../../hooks/useDevices';
import { useLanguage } from '../../i18n/LanguageContext';
import { authService } from '../../services/auth.service';
import {
  monitoringService,
  type EvtxSampleSeedResult,
  type LoghubSampleSeedResult,
  type PcapSampleSeedResult,
  type WazuhSampleSeedResult,
} from '../../services/monitoring.service';
import { useSimulationStore } from '../../simulation/simulationEngine';
import { useAuthStore } from '../../store/auth.store';
import { useTheme } from '../../theme/ThemeContext';

type ConnectionState = { status: 'idle' | 'checking' | 'ok' | 'error'; latencyMs?: number };
type WazuhSeedState = {
  status: 'idle' | 'loading' | 'done' | 'error';
  result?: WazuhSampleSeedResult;
};
type LoghubSeedState = {
  status: 'idle' | 'loading' | 'done' | 'error';
  result?: LoghubSampleSeedResult;
};
type PcapSeedState = {
  status: 'idle' | 'loading' | 'done' | 'error';
  result?: PcapSampleSeedResult;
};
type EvtxSeedState = {
  status: 'idle' | 'loading' | 'done' | 'error';
  result?: EvtxSampleSeedResult;
};

export function SettingsPage() {
  const user = useAuthStore((state) => state.user);
  const { t } = useLanguage();
  const { preference, setPreference } = useTheme();
  const { data: devices = [] } = useDevices();
  const isRunning = useSimulationStore((state) => state.isRunning);
  const start = useSimulationStore((state) => state.start);
  const stop = useSimulationStore((state) => state.stop);
  const [connection, setConnection] = useState<ConnectionState>({ status: 'idle' });
  const [wazuhSeed, setWazuhSeed] = useState<WazuhSeedState>({ status: 'idle' });
  const [loghubSeed, setLoghubSeed] = useState<LoghubSeedState>({ status: 'idle' });
  const [pcapSeed, setPcapSeed] = useState<PcapSeedState>({ status: 'idle' });
  const [evtxSeed, setEvtxSeed] = useState<EvtxSeedState>({ status: 'idle' });

  async function testConnection() {
    setConnection({ status: 'checking' });
    const startedAt = performance.now();
    try {
      await authService.me();
      setConnection({ status: 'ok', latencyMs: Math.round(performance.now() - startedAt) });
    } catch {
      setConnection({ status: 'error' });
    }
  }

  async function seedWazuhSamples() {
    setWazuhSeed({ status: 'loading' });
    try {
      const result = await monitoringService.seedWazuhSamples();
      setWazuhSeed({ status: 'done', result });
    } catch {
      setWazuhSeed({ status: 'error' });
    }
  }

  async function seedLoghubSamples() {
    setLoghubSeed({ status: 'loading' });
    try {
      const result = await monitoringService.seedLoghubSamples();
      setLoghubSeed({ status: 'done', result });
    } catch {
      setLoghubSeed({ status: 'error' });
    }
  }

  async function seedPcapSamples() {
    setPcapSeed({ status: 'loading' });
    try {
      const result = await monitoringService.seedPcapSamples();
      setPcapSeed({ status: 'done', result });
    } catch {
      setPcapSeed({ status: 'error' });
    }
  }

  async function seedEvtxSamples() {
    setEvtxSeed({ status: 'loading' });
    try {
      const result = await monitoringService.seedEvtxSamples();
      setEvtxSeed({ status: 'done', result });
    } catch {
      setEvtxSeed({ status: 'error' });
    }
  }

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      <Card>
        <h2 className="mb-4 text-sm font-semibold text-white">Profile</h2>
        <dl className="space-y-3 text-sm">
          <Row label="Name" value={user ? `${user.firstName} ${user.lastName}` : '—'} />
          <Row label="Email" value={user?.email ?? '—'} />
          <Row label="Role" value={user?.role ?? '—'} />
        </dl>
      </Card>

      <Card>
        <h2 className="mb-1 text-sm font-semibold text-white">{t('settings.appearance.title')}</h2>
        <p className="mb-4 text-xs text-slate-400">{t('settings.appearance.description')}</p>
        <div className="flex items-center gap-2" role="radiogroup" aria-label={t('settings.appearance.title')}>
          <ThemeOptionButton
            active={preference === 'dark'}
            icon={Moon}
            label={t('settings.appearance.dark')}
            onClick={() => setPreference('dark')}
          />
          <ThemeOptionButton
            active={preference === 'light'}
            icon={Sun}
            label={t('settings.appearance.light')}
            onClick={() => setPreference('light')}
          />
          <ThemeOptionButton
            active={preference === 'system'}
            icon={Monitor}
            label={t('settings.appearance.system')}
            onClick={() => setPreference('system')}
          />
        </div>
      </Card>

      <Card>
        <h2 className="mb-4 text-sm font-semibold text-white">Simulation Mode</h2>
        <p className="mb-4 text-xs text-slate-400">
          Posts realistic <strong className="text-mirqab-warning">synthetic</strong> log excerpts
          through the real <code>/ai/analyze</code> pipeline every few seconds — every alert,
          incident, and ticket it produces is genuinely persisted, not simulated client-side, but
          the underlying event content is generated, not real open-source evidence. Tagged{' '}
          <code>SIMULATION</code> in the database and clearly badged on every incident it creates,
          so it's never mistaken for the real dataset sources below.
        </p>
        <div className="flex items-center gap-3">
          <Badge status={isRunning ? 'success' : 'unknown'}>
            {isRunning ? 'Running' : 'Stopped'}
          </Badge>
          <Button
            variant={isRunning ? 'danger' : 'primary'}
            disabled={!isRunning && devices.length === 0}
            onClick={() => (isRunning ? stop() : start(devices))}
          >
            {isRunning ? <Square className="h-4 w-4" /> : <Play className="h-4 w-4" />}
            {isRunning ? 'Stop simulation' : 'Start simulation'}
          </Button>
        </div>
      </Card>

      <Card>
        <h2 className="mb-4 text-sm font-semibold text-white">Wazuh Sample Data</h2>
        <p className="mb-4 text-xs text-slate-400">
          Reads every line of the real <code>datasets/wazuh-sample-logs</code> files from disk at
          request time (Kubernetes/AWS CloudTrail JSON events, Fortigate VPN/firewall logs) and
          replays each one through the real <code>/monitoring/wazuh</code> ingestion pipeline —
          same classification/ticketing path as a live Wazuh manager, without needing one running.
          Tagged <code>OPEN_SOURCE_DATASET</code> on every incident it creates. Each line is first
          offered to the real Wazuh Logtest API for decoding when one is configured (
          <code>WAZUH_API_URL</code>); otherwise a bundled heuristic decoder is used instead.
        </p>
        <div className="flex items-center gap-3">
          <Button
            variant="secondary"
            onClick={seedWazuhSamples}
            disabled={wazuhSeed.status === 'loading'}
          >
            {wazuhSeed.status === 'loading' ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Database className="h-4 w-4" />
            )}
            Load Wazuh sample data
          </Button>
          {wazuhSeed.status === 'done' && wazuhSeed.result && !wazuhSeed.result.error && (
            <span className="flex items-center gap-1 text-xs text-mirqab-success">
              <CheckCircle2 className="h-4 w-4" /> Ingested {wazuhSeed.result.ingested} of{' '}
              {wazuhSeed.result.totalLines ?? wazuhSeed.result.ingested} real sample event(s) (
              {wazuhSeed.result.incidents.filter((i) => i.enrichedByLogtest).length} via Logtest)
            </span>
          )}
          {(wazuhSeed.status === 'error' || wazuhSeed.result?.error) && (
            <span className="flex items-center gap-1 text-xs text-mirqab-danger">
              <XCircle className="h-4 w-4" />
              {wazuhSeed.result?.error ?? 'Failed to seed sample data'}
            </span>
          )}
        </div>
      </Card>

      <Card>
        <h2 className="mb-4 text-sm font-semibold text-white">LogHub Sample Data</h2>
        <p className="mb-4 text-xs text-slate-400">
          Reads every line of the real SSH, Linux/Authentication, and Apache log files from{' '}
          <code>datasets/loghub</code> on disk at request time and replays each one through the
          real <code>/monitoring/syslog</code> ingestion pipeline — severity and MITRE ATT&amp;CK
          mapping (e.g. T1110 Brute Force for the SSH burst) come from the same AI triage pipeline
          every other source uses. Tagged <code>OPEN_SOURCE_DATASET</code> on every incident it
          creates.
        </p>
        <div className="flex items-center gap-3">
          <Button
            variant="secondary"
            onClick={seedLoghubSamples}
            disabled={loghubSeed.status === 'loading'}
          >
            {loghubSeed.status === 'loading' ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Database className="h-4 w-4" />
            )}
            Load LogHub sample data
          </Button>
          {loghubSeed.status === 'done' && loghubSeed.result && !loghubSeed.result.error && (
            <span className="flex items-center gap-1 text-xs text-mirqab-success">
              <CheckCircle2 className="h-4 w-4" /> Ingested {loghubSeed.result.ingested} of{' '}
              {loghubSeed.result.totalLines ?? loghubSeed.result.ingested} real sample event(s) (
              {loghubSeed.result.incidents.filter((i) => i.enrichedByLogtest).length} via Logtest)
            </span>
          )}
          {(loghubSeed.status === 'error' || loghubSeed.result?.error) && (
            <span className="flex items-center gap-1 text-xs text-mirqab-danger">
              <XCircle className="h-4 w-4" />
              {loghubSeed.result?.error ?? 'Failed to seed sample data'}
            </span>
          )}
        </div>
      </Card>

      <Card>
        <h2 className="mb-4 text-sm font-semibold text-white">PCAP Sample Data</h2>
        <p className="mb-4 text-xs text-slate-400">
          Reads the real <code>datasets/PcapMonkey/zeek-sample-events.json</code> file (Zeek output,
          Elastic Common Schema — connection, DNS, HTTP, TLS, a security notice, and a protocol
          anomaly) from disk at request time and replays every record through the real{' '}
          <code>/monitoring/pcap</code> ingestion pipeline — no PCAP tooling installed, PcapMonkey's
          own test fixture stands in for its output. Tagged <code>OPEN_SOURCE_DATASET</code> on
          every incident it creates.
        </p>
        <div className="flex items-center gap-3">
          <Button
            variant="secondary"
            onClick={seedPcapSamples}
            disabled={pcapSeed.status === 'loading'}
          >
            {pcapSeed.status === 'loading' ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Database className="h-4 w-4" />
            )}
            Load PCAP sample data
          </Button>
          {pcapSeed.status === 'done' && pcapSeed.result && !pcapSeed.result.error && (
            <span className="flex items-center gap-1 text-xs text-mirqab-success">
              <CheckCircle2 className="h-4 w-4" /> Ingested {pcapSeed.result.ingested} of{' '}
              {pcapSeed.result.totalEvents ?? pcapSeed.result.ingested} real network event(s)
            </span>
          )}
          {(pcapSeed.status === 'error' || pcapSeed.result?.error) && (
            <span className="flex items-center gap-1 text-xs text-mirqab-danger">
              <XCircle className="h-4 w-4" />
              {pcapSeed.result?.error ?? 'Failed to seed sample data'}
            </span>
          )}
        </div>
      </Card>

      <Card>
        <h2 className="mb-4 text-sm font-semibold text-white">EVTX Sample Data</h2>
        <p className="mb-4 text-xs text-slate-400">
          Decodes the real, binary <code>datasets/EVTX-to-MITRE-Attack</code> Windows Event Log
          file using the backend's native Windows <code>wevtutil</code> tool (no bundled EVTX
          parser library, no reimplementation of the binary format) and feeds every decoded event
          through the real AI pipeline. Tagged <code>OPEN_SOURCE_DATASET</code> on every incident
          it creates. Only works when the backend runs on a Windows host — on Linux (e.g. this
          project's Docker deployment) it reports why it can't, rather than fabricating a result.
        </p>
        <div className="flex items-center gap-3">
          <Button
            variant="secondary"
            onClick={seedEvtxSamples}
            disabled={evtxSeed.status === 'loading'}
          >
            {evtxSeed.status === 'loading' ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Database className="h-4 w-4" />
            )}
            Load EVTX sample data
          </Button>
          {evtxSeed.status === 'done' && evtxSeed.result && !evtxSeed.result.error && (
            <span className="flex items-center gap-1 text-xs text-mirqab-success">
              <CheckCircle2 className="h-4 w-4" /> Ingested {evtxSeed.result.ingested} real Windows
              event(s)
            </span>
          )}
          {(evtxSeed.status === 'error' || evtxSeed.result?.error) && (
            <span className="flex items-center gap-1 text-xs text-mirqab-danger">
              <XCircle className="h-4 w-4" />
              {evtxSeed.result?.error ?? 'Failed to seed sample data'}
            </span>
          )}
        </div>
      </Card>

      <Card>
        <h2 className="mb-4 text-sm font-semibold text-white">Backend connection</h2>
        <p className="mb-3 text-xs text-slate-400">
          API base URL: <code className="text-slate-300">{import.meta.env.VITE_API_BASE_URL}</code>
        </p>
        <div className="flex items-center gap-3">
          <Button
            variant="secondary"
            onClick={testConnection}
            disabled={connection.status === 'checking'}
          >
            {connection.status === 'checking' && <Loader2 className="h-4 w-4 animate-spin" />}
            Test connection
          </Button>
          {connection.status === 'ok' && (
            <span className="flex items-center gap-1 text-xs text-mirqab-success">
              <CheckCircle2 className="h-4 w-4" /> Reachable ({connection.latencyMs}ms via /auth/me)
            </span>
          )}
          {connection.status === 'error' && (
            <span className="flex items-center gap-1 text-xs text-mirqab-danger">
              <XCircle className="h-4 w-4" /> Could not reach the backend
            </span>
          )}
        </div>
      </Card>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between border-b border-white/5 pb-2">
      <dt className="text-slate-500">{label}</dt>
      <dd className="text-slate-200">{value}</dd>
    </div>
  );
}

function ThemeOptionButton({
  active,
  icon: Icon,
  label,
  onClick,
}: {
  active: boolean;
  icon: LucideIcon;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      onClick={onClick}
      className={
        active
          ? 'flex items-center gap-2 rounded-xl border border-mirqab-accent/50 bg-mirqab-accent/15 px-3.5 py-2 text-sm font-medium text-mirqab-accent transition'
          : 'flex items-center gap-2 rounded-xl border border-mirqab-border bg-white/5 px-3.5 py-2 text-sm font-medium text-slate-400 transition hover:bg-white/10 hover:text-slate-200'
      }
    >
      <Icon className="h-4 w-4" />
      {label}
    </button>
  );
}

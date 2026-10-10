import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Building2, Database, Globe, Laptop2, Network, Server, ShieldCheck, Unplug } from 'lucide-react';
import ReactFlow, {
  Background,
  Controls,
  Handle,
  Position,
  useReactFlow,
  type Edge,
  type Node,
  type NodeProps,
} from 'reactflow';
import 'reactflow/dist/style.css';
import clsx from 'clsx';
import { SEVERITY_COLOR } from '../ui/Badge';
import { deriveDeviceState, DEVICE_STATE_DOT_CLASS } from '../../features/citadel/deviceState';
import { useLanguage } from '../../i18n/LanguageContext';
import type { AlertRecord, Department, Severity, VirtualDevice } from '../../types/domain';

const SEVERITY_RANK: Record<Severity, number> = { low: 0, medium: 1, high: 2, critical: 3 };

function worstSeverity(alerts: AlertRecord[]): Severity | null {
  return alerts.reduce<Severity | null>((worst, alert) => {
    if (!worst || SEVERITY_RANK[alert.severity] > SEVERITY_RANK[worst]) return alert.severity;
    return worst;
  }, null);
}

/**
 * Internet/Firewall/Core Switch/App Server/DB Server have no backing
 * database model — MIRQAB doesn't track network infrastructure devices,
 * only Department/Device/Incident. They exist purely to orient the analyst
 * (where does traffic conceptually enter before reaching a department).
 * Labeled and styled as reference/static so nobody mistakes them for real
 * live telemetry — see the "REAL DATA ONLY" requirement this map must honor.
 */
interface InfraNodeData {
  label: string;
  icon: typeof Globe;
  onAttackPath: boolean;
  referenceLabel: string;
}

function InfraNode({ data }: NodeProps<InfraNodeData>) {
  const Icon = data.icon;
  return (
    <div className="nodrag nopan flex w-32 flex-col items-center gap-1.5 text-center">
      <Handle type="target" position={Position.Top} className="!h-2 !w-2 !border-0 !bg-white/20" />
      <div
        className={clsx(
          'flex h-20 w-20 items-center justify-center rounded-full border-2 border-dashed backdrop-blur-md transition-all duration-300',
          data.onAttackPath
            ? 'border-mirqab-danger/70 bg-mirqab-danger/10 text-mirqab-danger'
            : 'border-slate-500/40 bg-slate-500/10 text-slate-400',
        )}
      >
        <Icon className="h-9 w-9" />
      </div>
      <p className="text-sm font-medium leading-tight text-slate-300">{data.label}</p>
      <p className="text-[9px] uppercase tracking-wide text-slate-600">{data.referenceLabel}</p>
      <Handle
        type="source"
        position={Position.Bottom}
        className="!h-2 !w-2 !border-0 !bg-white/20"
      />
    </div>
  );
}

interface DeptNodeData {
  label: string;
  /** Worst severity among this department's OWN real open/investigating
   * incidents (whether or not each one resolved to a specific device) —
   * real Incident rows, never invented. */
  severity: Severity | null;
  deviceCount: number;
  isolatedCount: number;
  selected: boolean;
  onSelect: () => void;
}

function DeptNode({ data }: NodeProps<DeptNodeData>) {
  const color = data.severity ? SEVERITY_COLOR[data.severity] : undefined;
  const compromised = Boolean(data.severity);

  return (
    <div className="nodrag nopan flex w-36 flex-col items-center gap-1.5 text-center">
      <Handle type="target" position={Position.Top} className="!h-2 !w-2 !border-0 !bg-white/20" />
      <button
        type="button"
        onClick={data.onSelect}
        className={clsx(
          'relative flex h-20 w-20 items-center justify-center rounded-full border-2 backdrop-blur-md transition-all duration-300',
          'cursor-pointer',
          compromised && 'animate-pulse-glow',
          data.selected && 'ring-2 ring-white/70 ring-offset-2 ring-offset-mirqab-topology',
        )}
        style={{
          borderColor: color ?? 'rgba(124,58,237,0.4)',
          backgroundColor: color ? `${color}22` : 'rgba(124,58,237,0.1)',
          color: color ?? '#7C3AED',
          boxShadow: compromised ? `0 0 24px -4px ${color}99` : undefined,
        }}
        title="Open department details"
      >
        <Building2 className="h-9 w-9" />
        {data.isolatedCount > 0 && (
          // text-slate-50 (not text-slate-300): bg-slate-700 is an intentionally
          // fixed-dark badge in both themes (not remapped — see
          // tailwind.config.ts), so its icon needs an equally fixed-light
          // color, not one that flips dark in light mode and disappears.
          <span className="absolute -bottom-1 -end-1 flex h-6 w-6 items-center justify-center rounded-full border-2 border-mirqab-topology bg-slate-700 text-slate-50">
            <Unplug className="h-3.5 w-3.5" />
          </span>
        )}
      </button>
      <p className="text-sm font-medium leading-tight text-slate-300">{data.label}</p>
      <p className="text-[10px] text-slate-500">{data.deviceCount} device(s)</p>
    </div>
  );
}

/** Whether this non-isolated device's real open/investigating incident
 * justifies the stronger "Isolation Required" claim, or only the neutral
 * "Active threat — review required" one — reusing the exact same real
 * signals (Device.isolated, Incident.severity) already used elsewhere in
 * the app, never a new scoring algorithm. HIGH/CRITICAL is the same
 * threshold the rest of the UI already treats as urgent (dashboard
 * critical/high tiles, SEVERITY_COLOR); LOW/MEDIUM gets the neutral label
 * rather than overclaiming that isolation is required. */
export type DeviceAlertLevel = 'isolation-required' | 'review-required' | null;

export function deriveDeviceAlertLevel(device: VirtualDevice, severity: Severity | null): DeviceAlertLevel {
  if (device.isolated || !severity) return null;
  return severity === 'critical' || severity === 'high' ? 'isolation-required' : 'review-required';
}

interface DeviceNodeData {
  device: VirtualDevice;
  /** Worst severity among THIS device's own real open/investigating
   * incidents — null when it has none right now. */
  severity: Severity | null;
  alertLevel: DeviceAlertLevel;
  alertLabel: string | null;
  selected: boolean;
  onSelectDevice: () => void;
  onSelectIncident: (() => void) | null;
}

function DeviceNode({ data }: NodeProps<DeviceNodeData>) {
  const { device } = data;
  const state = deriveDeviceState(device);
  // Badge/glow color follows the alert level (isolation-required → the
  // existing danger-red token, review-required → the existing amber
  // warning token), not the raw per-incident severity — so a HIGH-severity
  // "isolation required" device reads as consistently red, not amber.
  const color =
    data.alertLevel === 'isolation-required'
      ? SEVERITY_COLOR.critical
      : data.alertLevel === 'review-required'
        ? SEVERITY_COLOR.high
        : undefined;

  return (
    <div className="nodrag nopan flex w-28 flex-col items-center gap-1 text-center">
      <Handle type="target" position={Position.Top} className="!h-1.5 !w-1.5 !border-0 !bg-white/15" />
      <button
        type="button"
        onClick={data.onSelectDevice}
        className={clsx(
          'relative flex h-12 w-12 items-center justify-center rounded-xl border backdrop-blur-md transition-all duration-300',
          'cursor-pointer border-white/10 bg-white/5 text-slate-300 hover:border-white/25',
          data.alertLevel === 'isolation-required' && 'animate-pulse-glow',
          data.selected && 'ring-2 ring-white/70 ring-offset-1 ring-offset-mirqab-topology',
        )}
        style={color ? { boxShadow: `0 0 14px -2px ${color}` } : undefined}
        title={data.alertLabel ?? `Open ${device.hostname} details`}
      >
        <Laptop2 className="h-5 w-5" />
        <span
          className={clsx(
            'absolute -bottom-0.5 -end-0.5 h-2.5 w-2.5 rounded-full border border-mirqab-topology',
            DEVICE_STATE_DOT_CLASS[state],
          )}
        />
        {data.severity && data.onSelectIncident && (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              data.onSelectIncident?.();
            }}
            title={data.alertLabel ?? 'Open the incident affecting this device'}
            className="absolute -top-1.5 -end-1.5 flex h-4 w-4 items-center justify-center rounded-full border border-mirqab-topology"
            style={{ backgroundColor: color }}
          >
            <AlertTriangle className="h-2.5 w-2.5 text-mirqab-topology" />
          </button>
        )}
      </button>
      <p className="w-full truncate text-[10px] font-medium text-slate-400">{device.hostname}</p>
    </div>
  );
}

const nodeTypes = { infra: InfraNode, dept: DeptNode, device: DeviceNode };

interface ThreatTopologyProps {
  departments: Department[];
  devices: VirtualDevice[];
  alerts: AlertRecord[];
  height?: number | string;
  /** Opens the Incident Response panel for the incident currently driving a department's alert state. */
  onOpenIncident?: (incidentId: string, departmentId: string) => void;
  /** Opens a device detail drawer — reuse the existing DevicePanel (Citadel), never a new component. */
  onSelectDevice?: (deviceId: string) => void;
  /** Opens a department detail drawer. */
  onSelectDepartment?: (departmentId: string) => void;
}

/** Focuses the viewport on a specific node once it's selected — the "Focus
 * selected" navigation behavior, implemented via ReactFlow's own instance
 * rather than a second animation system. Must render as a child of
 * <ReactFlow> to reach its context. */
function FocusOnSelect({ nodeId }: { nodeId: string | null }) {
  const { fitView, getNode } = useReactFlow();
  useEffect(() => {
    if (!nodeId) return;
    const node = getNode(nodeId);
    if (node) fitView({ nodes: [{ id: nodeId }], duration: 350, maxZoom: 1.4 });
  }, [nodeId, fitView, getNode]);
  return null;
}

export function ThreatTopology({
  departments,
  devices,
  alerts,
  height = 420,
  onOpenIncident,
  onSelectDevice,
  onSelectDepartment,
}: ThreatTopologyProps) {
  const { t } = useLanguage();
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

  // Real Incident rows only, grouped by the real boundary they belong to —
  // never sampled, never invented. "Active" = genuinely unresolved (OPEN or
  // INVESTIGATING), matching a real SOC wallboard: an incident nobody has
  // addressed stays visible for as long as it remains unaddressed.
  const unresolved = useMemo(
    () => alerts.filter((alert) => alert.status === 'open' || alert.status === 'investigating'),
    [alerts],
  );
  const openByDept = useMemo(() => {
    const map = new Map<string, AlertRecord[]>();
    for (const alert of unresolved) {
      if (!alert.departmentId) continue;
      const list = map.get(alert.departmentId) ?? [];
      list.push(alert);
      map.set(alert.departmentId, list);
    }
    return map;
  }, [unresolved]);
  const openByDevice = useMemo(() => {
    const map = new Map<string, AlertRecord[]>();
    for (const alert of unresolved) {
      if (!alert.deviceId) continue;
      const list = map.get(alert.deviceId) ?? [];
      list.push(alert);
      map.set(alert.deviceId, list);
    }
    return map;
  }, [unresolved]);
  const isolatedByDept = useMemo(() => {
    const map = new Map<string, number>();
    for (const device of devices) {
      if (!device.isolated) continue;
      map.set(device.departmentId, (map.get(device.departmentId) ?? 0) + 1);
    }
    return map;
  }, [devices]);
  const anyActive = unresolved.length > 0;

  const colGap = 130;
  const deptGap = 220;
  const rowGap = 130;
  const n = Math.max(departments.length, 1);
  const centerX = ((n - 1) * deptGap) / 2;

  function select(id: string, action: () => void) {
    setSelectedNodeId(id);
    action();
  }

  const nodes: Node[] = useMemo(() => {
    const infra = (
      id: string,
      label: string,
      icon: typeof Globe,
      x: number,
      y: number,
      onAttackPath: boolean,
    ): Node => ({
      id,
      type: 'infra',
      position: { x, y },
      draggable: false,
      selectable: false,
      data: { label, icon, onAttackPath, referenceLabel: t('topology.reference') },
    });

    const deptAndDeviceNodes: Node[] = departments.flatMap((dept, deptIndex) => {
      const deptDevices = devices.filter((device) => device.departmentId === dept.id);
      const deptOpen = openByDept.get(dept.id) ?? [];
      const deptX = deptIndex * deptGap;

      const deptNode: Node = {
        id: dept.id,
        type: 'dept',
        position: { x: deptX, y: rowGap * 3 },
        draggable: false,
        selectable: true,
        data: {
          label: dept.name,
          severity: worstSeverity(deptOpen),
          deviceCount: deptDevices.length,
          isolatedCount: isolatedByDept.get(dept.id) ?? 0,
          selected: selectedNodeId === dept.id,
          onSelect: () => select(dept.id, () => onSelectDepartment?.(dept.id)),
        },
      };

      const deviceWidth = deptDevices.length > 0 ? (deptDevices.length - 1) * colGap : 0;
      const deviceStartX = deptX - deviceWidth / 2;
      const deviceNodes: Node[] = deptDevices.map((device, deviceIndex) => {
        const deviceOpen = openByDevice.get(device.id) ?? [];
        const primaryIncidentId = deviceOpen[0]?.id ?? null;
        const severity = worstSeverity(deviceOpen);
        const alertLevel = deriveDeviceAlertLevel(device, severity);
        const alertLabel =
          alertLevel === 'isolation-required'
            ? t('topology.isolationRequired')
            : alertLevel === 'review-required'
              ? t('topology.activeThreatReviewRequired')
              : null;
        return {
          id: `device-${device.id}`,
          type: 'device',
          position: { x: deviceStartX + deviceIndex * colGap, y: rowGap * 4.2 },
          draggable: false,
          selectable: true,
          data: {
            device,
            severity,
            alertLevel,
            alertLabel,
            selected: selectedNodeId === `device-${device.id}`,
            onSelectDevice: () =>
              select(`device-${device.id}`, () => onSelectDevice?.(device.id)),
            onSelectIncident: primaryIncidentId
              ? () => onOpenIncident?.(primaryIncidentId, dept.id)
              : null,
          },
        };
      });

      return [deptNode, ...deviceNodes];
    });

    return [
      infra('internet', t('topology.internet'), Globe, centerX, 0, anyActive),
      infra('firewall', t('topology.firewall'), ShieldCheck, centerX, rowGap, anyActive),
      infra('coreswitch', t('topology.coreSwitch'), Network, centerX, rowGap * 2, anyActive),
      infra('appserver', t('topology.appServer'), Server, centerX - 130, -rowGap, false),
      infra('dbserver', t('topology.dbServer'), Database, centerX + 130, -rowGap, false),
      ...deptAndDeviceNodes,
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    departments,
    devices,
    openByDept,
    openByDevice,
    isolatedByDept,
    centerX,
    anyActive,
    selectedNodeId,
    onSelectDevice,
    onSelectDepartment,
    onOpenIncident,
    t,
  ]);

  const edges: Edge[] = useMemo(() => {
    const trunk: Edge[] = [
      { id: 'e-internet-firewall', source: 'internet', target: 'firewall' },
      { id: 'e-firewall-core', source: 'firewall', target: 'coreswitch' },
    ].map((edge) => ({
      ...edge,
      animated: anyActive,
      style: {
        stroke: anyActive ? '#FF3B5C' : 'var(--mirqab-track-stroke)',
        strokeWidth: anyActive ? 2.5 : 1.5,
        strokeDasharray: '6 4',
      },
    }));

    const serverEdges: Edge[] = [
      { id: 'e-core-app', source: 'coreswitch', target: 'appserver' },
      { id: 'e-core-db', source: 'coreswitch', target: 'dbserver' },
    ].map((edge) => ({
      ...edge,
      animated: false,
      style: { stroke: 'var(--mirqab-track-stroke)', strokeWidth: 1.2, strokeDasharray: '4 4' },
    }));

    // No edge from the reference infrastructure cluster to real department
    // nodes — MIRQAB's data model has no field saying a department's real
    // traffic actually flows through this decorative switch, so drawing
    // that connection would fabricate a relationship the backend doesn't
    // provide (see this component's "REAL DATA ONLY" requirement). The
    // reference nodes stay visually above the real hierarchy for
    // orientation only, unconnected to it.

    const deviceEdges: Edge[] = devices.map((device) => {
      const deviceOpen = openByDevice.get(device.id) ?? [];
      const severity = worstSeverity(deviceOpen);
      const color = severity ? SEVERITY_COLOR[severity] : 'var(--mirqab-track-stroke)';
      return {
        id: `e-dept-${device.id}`,
        source: device.departmentId,
        target: `device-${device.id}`,
        animated: Boolean(severity),
        style: {
          stroke: color,
          strokeWidth: severity ? 2 : 1,
          strokeDasharray: severity ? '4 3' : undefined,
        },
      };
    });

    return [...trunk, ...serverEdges, ...deviceEdges];
  }, [departments, devices, openByDept, openByDevice, anyActive]);

  return (
    <div
      style={{ height }}
      className="overflow-hidden rounded-xl2 border border-white/10 bg-mirqab-topology"
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        fitView
        proOptions={{ hideAttribution: true }}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable
        panOnDrag
        zoomOnScroll
        minZoom={0.3}
        maxZoom={2}
      >
        <Background color="var(--mirqab-topology-grid-dot)" gap={28} />
        <Controls showInteractive={false} />
        <FocusOnSelect nodeId={selectedNodeId} />
      </ReactFlow>
    </div>
  );
}

import { useMemo } from 'react';
import { Laptop2, Skull } from 'lucide-react';
import ReactFlow, {
  Background,
  Handle,
  MarkerType,
  Position,
  type Edge,
  type Node,
  type NodeProps,
} from 'reactflow';
import 'reactflow/dist/style.css';
import clsx from 'clsx';
import type { AttackChain } from '../../citadel/attackChains.data';

interface HostNodeData {
  label: string;
  isAttacker: boolean;
  localStepCount: number;
}

function HostNode({ data }: NodeProps<HostNodeData>) {
  const Icon = data.isAttacker ? Skull : Laptop2;
  return (
    <div className="flex w-32 flex-col items-center gap-2 text-center">
      <Handle type="target" position={Position.Left} className="!h-2 !w-2 !border-0 !bg-white/20" />
      <div
        className={clsx(
          'flex h-16 w-16 items-center justify-center rounded-full border-2 backdrop-blur-md',
          data.isAttacker
            ? 'border-mirqab-danger bg-mirqab-danger/15 text-mirqab-danger shadow-glow-red'
            : 'border-mirqab-accent/40 bg-mirqab-accent/10 text-mirqab-accent shadow-glow-sm',
        )}
      >
        <Icon className="h-7 w-7" />
      </div>
      <p className="text-xs font-medium leading-tight text-slate-300">{data.label}</p>
      {data.localStepCount > 0 && (
        <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] text-slate-400">
          {data.localStepCount} local step{data.localStepCount === 1 ? '' : 's'}
        </span>
      )}
      <Handle
        type="source"
        position={Position.Right}
        className="!h-2 !w-2 !border-0 !bg-white/20"
      />
    </div>
  );
}

const nodeTypes = { host: HostNode };

interface AttackPathGraphProps {
  chain: AttackChain;
  height?: number | string;
}

/**
 * Renders one attack chain (see citadel/attackChains.data.ts) as a
 * host-to-host movement graph: one node per distinct host, one edge per
 * step where the attacker actually moved (source !== target). Steps that
 * happen on a single host (recon, persistence, credential dumping, ...)
 * are counted on that host's node rather than drawn as a self-loop edge.
 */
export function AttackPathGraph({ chain, height = 320 }: AttackPathGraphProps) {
  const hostOrder = useMemo(() => {
    const order: string[] = [];
    const seen = new Set<string>();
    for (const step of chain.steps) {
      for (const host of [step.source, step.target]) {
        if (!seen.has(host)) {
          seen.add(host);
          order.push(host);
        }
      }
    }
    return order;
  }, [chain]);

  const localStepCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const step of chain.steps) {
      if (step.source === step.target) {
        counts.set(step.source, (counts.get(step.source) ?? 0) + 1);
      }
    }
    return counts;
  }, [chain]);

  const nodes: Node[] = useMemo(() => {
    const colGap = 190;
    return hostOrder.map((host, index) => ({
      id: host,
      type: 'host',
      position: { x: index * colGap, y: (index % 2) * 110 },
      draggable: false,
      selectable: false,
      data: {
        label: host === 'attacker' ? 'Attacker' : host,
        isAttacker: host === 'attacker',
        localStepCount: localStepCounts.get(host) ?? 0,
      },
    }));
  }, [hostOrder, localStepCounts]);

  const edges: Edge[] = useMemo(() => {
    return chain.steps
      .filter((step) => step.source !== step.target)
      .map((step, index) => ({
        id: `e-${step.step}-${index}`,
        source: step.source,
        target: step.target,
        label: step.step,
        animated: true,
        markerEnd: { type: MarkerType.ArrowClosed, color: '#FF3B5C' },
        style: { stroke: '#FF3B5C', strokeWidth: 2 },
        labelStyle: { fill: '#e2e8f0', fontSize: 11 },
        labelBgStyle: { fill: '#0f0a1f', fillOpacity: 0.85 },
      }));
  }, [chain]);

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
        zoomOnScroll={true}
        panOnDrag={true}
      >
        <Background color="var(--mirqab-topology-grid-dot)" gap={28} />
      </ReactFlow>
    </div>
  );
}

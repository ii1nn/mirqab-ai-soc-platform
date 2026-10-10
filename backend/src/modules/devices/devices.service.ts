import { Injectable, NotFoundException } from '@nestjs/common';
import {
  Device,
  IncidentActionOutcome,
  IncidentActionType,
  IncidentStatus,
  Prisma,
  Role,
  Severity,
} from '@prisma/client';
import { PrismaService } from '../../database/prisma/prisma.service';
import { assertDepartmentAccess, assertOrganizationAccess } from '../../common/guards/department-access.util';
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';

const ACTIVE_WINDOW_MS = 5 * 60_000;
const SEVERITY_PENALTY: Record<Severity, number> = {
  [Severity.LOW]: 2,
  [Severity.MEDIUM]: 8,
  [Severity.HIGH]: 18,
  [Severity.CRITICAL]: 30,
};

export interface DeviceWithStatus extends Device {
  status: 'ONLINE' | 'AT_RISK';
  currentScore: number;
  activeIncidentCount: number;
  /** Derived from the latest successful ISOLATE_DEVICE action across this
   * device's incidents — never a stored column, same "no stale status"
   * design as `status`/`currentScore`. Mirrors the per-incident equivalent
   * already computed in AiService.composeHistory. */
  isolated: boolean;
  isolatedAt: Date | null;
  isolatedBy: string | null;
}

/**
 * Device status/score are never persisted columns — they're derived at
 * query time from recent open incidents, the same "no stale status" design
 * the SOC Dashboard used client-side in Phase 4, now authoritative here.
 */
@Injectable()
export class DevicesService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Phase 1 RBAC/IDOR remediation: previously trusted a client-supplied
   * `?departmentId=` query parameter outright — an IT_TECHNICIAN could
   * request `?departmentId=<any-other-department>` (or omit it entirely)
   * and receive every device in that department, or org-wide, with no
   * server-side check at all. Now: an explicit departmentId is validated
   * through the same assertDepartmentAccess() rule DeviceAccessGuard
   * already enforces on GET /devices/:id (ADMIN/SECURITY_ANALYST may query
   * any department; IT_TECHNICIAN only their own — a mismatch throws 403,
   * it is never silently substituted or widened). Omitting the parameter
   * falls back to the caller's own default scope via departmentScopeWhere().
   */
  async findAll(user: AuthenticatedUser, departmentId?: string): Promise<DeviceWithStatus[]> {
    const devices = await this.prisma.device.findMany({
      where: {
        // Phase 2.6B: organization boundary applies to every role, always
        // — a device row without a matching organizationId is never
        // returned, regardless of department scope below. Device.organizationId
        // is a required column, so this is a strict equality filter, never
        // an OR-with-null the way department scoping allows.
        organizationId: user.organizationId ?? '__no_organization_assigned__',
        ...this.resolveDepartmentScope(user, departmentId),
      },
      orderBy: { hostname: 'asc' },
    });

    return this.withComputedStatusBatch(devices);
  }

  /**
   * Unlike departmentScopeWhere() (Incident/Ticket, both nullable
   * departmentId), Device.departmentId is required in the schema — every
   * device belongs to exactly one department, there's no "undepartmented
   * device" to include via an OR. A departmentless IT_TECHNICIAN (should
   * never normally happen, but assertDepartmentAccess treats it as a real
   * case to fail closed for) is scoped to a departmentId value no real
   * Device row can ever have, returning zero devices rather than every
   * device — the same fail-closed principle, expressed for a non-nullable
   * column instead of a nullable one.
   *
   * Phase 2.6B: renamed from resolveListScope — the organization boundary
   * is now applied separately, unconditionally, by the caller (findAll)
   * as a top-level `organizationId` filter ANDed with whatever this method
   * returns, so a cross-organization departmentId supplied here can never
   * actually match any row (its devices all carry the other organization's
   * id) even before assertDepartmentAccess's own department-only check runs.
   */
  private resolveDepartmentScope(
    user: AuthenticatedUser,
    departmentId?: string,
  ): Prisma.DeviceWhereInput | undefined {
    if (departmentId) {
      assertDepartmentAccess(user, departmentId);
      return { departmentId };
    }
    if (user.role !== Role.IT_TECHNICIAN) {
      return undefined;
    }
    return { departmentId: user.departmentId ?? '__no_department_assigned__' };
  }

  async findById(id: string): Promise<DeviceWithStatus> {
    const device = await this.prisma.device.findUnique({ where: { id } });
    if (!device) {
      throw new NotFoundException('Device not found');
    }
    return this.withComputedStatus(device);
  }

  /** Used by monitoring ingestion (see modules/monitoring) to resolve an agent's
   * reported hostname to a registered device. Returns null rather than throwing —
   * an event from an unenrolled host is still a real event worth triaging. */
  async findByHostname(hostname: string): Promise<Device | null> {
    return this.prisma.device.findUnique({ where: { hostname } });
  }

  /** Used by PCAP ingestion (see modules/monitoring/pcap-samples), which only ever
   * has an IP, not a hostname. `ipAddress` isn't unique in the schema — findFirst,
   * same "return null rather than reject" contract as findByHostname. */
  async findByIpAddress(ipAddress: string): Promise<Device | null> {
    return this.prisma.device.findFirst({ where: { ipAddress } });
  }

  private async withComputedStatus(device: Device): Promise<DeviceWithStatus> {
    const [activeIncidents, latestIsolation] = await Promise.all([
      this.prisma.incident.findMany({
        where: {
          deviceId: device.id,
          status: IncidentStatus.OPEN,
          createdAt: { gte: new Date(Date.now() - ACTIVE_WINDOW_MS) },
        },
        select: { severity: true },
      }),
      this.prisma.incidentAction.findFirst({
        where: {
          type: IncidentActionType.ISOLATE_DEVICE,
          outcome: IncidentActionOutcome.SUCCESS,
          incident: { deviceId: device.id },
        },
        orderBy: { updatedAt: 'desc' },
      }),
    ]);

    const penalty = activeIncidents.reduce(
      (sum, incident) => sum + SEVERITY_PENALTY[incident.severity],
      0,
    );
    const currentScore = Math.max(10, Math.min(100, device.baselineScore - penalty));

    return {
      ...device,
      status: activeIncidents.length > 0 ? 'AT_RISK' : 'ONLINE',
      currentScore,
      activeIncidentCount: activeIncidents.length,
      isolated: Boolean(latestIsolation),
      isolatedAt: latestIsolation?.updatedAt ?? null,
      isolatedBy: latestIsolation?.performedBy ?? null,
    };
  }

  /**
   * Phase 16 (performance/scale review): `findAll()` originally called
   * `withComputedStatus()` once per device via `Promise.all` — 2 separate
   * queries per device (N+1). `findAll()` has no `take` limit at all (unlike
   * every other list endpoint in this codebase — `TicketsService.findAll`/
   * `AuditLogsService.findAll`/`AiService.listIncidents` all cap at 200),
   * because silently hiding part of a SOC's own device inventory from an
   * admin is a worse blind spot than a slower query — so the fix here makes
   * the *query count* constant instead of limiting how many devices come
   * back. Two queries total, covering every device in `devices`, replace
   * the 2N queries the old per-device loop issued. `findById()` (a single
   * device) still uses the original `withComputedStatus()` above — no N+1
   * concern exists for one row, and its exact query shape/tests are
   * unchanged.
   */
  private async withComputedStatusBatch(devices: Device[]): Promise<DeviceWithStatus[]> {
    if (devices.length === 0) {
      return [];
    }

    const deviceIds = devices.map((device) => device.id);

    const [activeIncidents, isolationActions] = await Promise.all([
      this.prisma.incident.findMany({
        where: {
          deviceId: { in: deviceIds },
          status: IncidentStatus.OPEN,
          createdAt: { gte: new Date(Date.now() - ACTIVE_WINDOW_MS) },
        },
        select: { deviceId: true, severity: true },
      }),
      // Ordered so the first entry seen per device below is the most recent
      // one — replicates the single-device path's `findFirst({orderBy:
      // {updatedAt: 'desc'}})` "latest SUCCESS wins" semantics in one query.
      this.prisma.incidentAction.findMany({
        where: {
          type: IncidentActionType.ISOLATE_DEVICE,
          outcome: IncidentActionOutcome.SUCCESS,
          incident: { deviceId: { in: deviceIds } },
        },
        orderBy: { updatedAt: 'desc' },
        include: { incident: { select: { deviceId: true } } },
      }),
    ]);

    const incidentsByDevice = new Map<string, { severity: Severity }[]>();
    for (const incident of activeIncidents) {
      if (!incident.deviceId) continue;
      const list = incidentsByDevice.get(incident.deviceId) ?? [];
      list.push(incident);
      incidentsByDevice.set(incident.deviceId, list);
    }

    const latestIsolationByDevice = new Map<string, (typeof isolationActions)[number]>();
    for (const action of isolationActions) {
      const deviceId = action.incident.deviceId;
      if (!deviceId || latestIsolationByDevice.has(deviceId)) continue;
      latestIsolationByDevice.set(deviceId, action);
    }

    return devices.map((device) => {
      const deviceIncidents = incidentsByDevice.get(device.id) ?? [];
      const penalty = deviceIncidents.reduce(
        (sum, incident) => sum + SEVERITY_PENALTY[incident.severity],
        0,
      );
      const currentScore = Math.max(10, Math.min(100, device.baselineScore - penalty));
      const latestIsolation = latestIsolationByDevice.get(device.id);

      return {
        ...device,
        status: deviceIncidents.length > 0 ? ('AT_RISK' as const) : ('ONLINE' as const),
        currentScore,
        activeIncidentCount: deviceIncidents.length,
        isolated: Boolean(latestIsolation),
        isolatedAt: latestIsolation?.updatedAt ?? null,
        isolatedBy: latestIsolation?.performedBy ?? null,
      };
    });
  }
}

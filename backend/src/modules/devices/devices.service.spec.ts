import { ForbiddenException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Role } from '@prisma/client';
import { PrismaService } from '../../database/prisma/prisma.service';
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';
import { DevicesService } from './devices.service';

describe('DevicesService', () => {
  let service: DevicesService;
  let prisma: {
    device: { findMany: jest.Mock; findUnique: jest.Mock };
    incident: { findMany: jest.Mock };
    incidentAction: { findFirst: jest.Mock; findMany: jest.Mock };
  };

  const rawDevice = {
    id: 'device-1',
    hostname: 'WEB-01',
    departmentId: 'dept-1',
    organizationId: 'org-1',
    os: 'Windows 11',
    deviceType: 'workstation',
    ipAddress: '10.0.0.5',
    baselineScore: 85,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const admin: AuthenticatedUser = {
    id: 'admin-1',
    email: 'admin@mirqab.local',
    role: Role.ADMIN,
    departmentId: null,
    organizationId: 'org-1',
  };
  const techDeptA: AuthenticatedUser = {
    id: 'tech-a',
    email: 'tech-a@mirqab.local',
    role: Role.IT_TECHNICIAN,
    departmentId: 'dept-1',
    organizationId: 'org-1',
  };
  const techDeptB: AuthenticatedUser = {
    id: 'tech-b',
    email: 'tech-b@mirqab.local',
    role: Role.IT_TECHNICIAN,
    departmentId: 'dept-2',
    organizationId: 'org-1',
  };
  const otherOrgAdmin: AuthenticatedUser = {
    id: 'admin-2',
    email: 'admin@org-b.local',
    role: Role.ADMIN,
    departmentId: null,
    organizationId: 'org-B',
  };

  beforeEach(async () => {
    prisma = {
      device: {
        findMany: jest.fn().mockResolvedValue([rawDevice]),
        findUnique: jest.fn().mockResolvedValue(rawDevice),
      },
      incident: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      incidentAction: {
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
      },
    };

    const moduleRef = await Test.createTestingModule({
      providers: [DevicesService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = moduleRef.get(DevicesService);
  });

  it('reports isolated: false when no successful ISOLATE_DEVICE action exists for the device', async () => {
    const [device] = await service.findAll(admin);

    expect(device.isolated).toBe(false);
    expect(device.isolatedAt).toBeNull();
    expect(device.isolatedBy).toBeNull();
    // findAll() uses the batched query path (Phase 16) — see the
    // 'batched status computation' block below for its own dedicated
    // query-count/attribution coverage.
    expect(prisma.incidentAction.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          type: 'ISOLATE_DEVICE',
          outcome: 'SUCCESS',
          incident: { deviceId: { in: ['device-1'] } },
        }),
      }),
    );
  });

  it('reports isolated: true, with attribution, when a successful ISOLATE_DEVICE action exists', async () => {
    const isolatedAt = new Date('2026-08-15T12:00:00Z');
    prisma.incidentAction.findFirst.mockResolvedValue({
      id: 'action-1',
      updatedAt: isolatedAt,
      performedBy: 'analyst@mirqab.local',
    });

    const device = await service.findById('device-1');

    expect(device.isolated).toBe(true);
    expect(device.isolatedAt).toBe(isolatedAt);
    expect(device.isolatedBy).toBe('analyst@mirqab.local');
  });

  it('does not report isolated: true for a PENDING or FAILED isolate action (findFirst is scoped to SUCCESS only)', async () => {
    // The Prisma query itself filters on outcome: SUCCESS, so a PENDING/FAILED
    // action never matches — simulated here by the mock returning null, the
    // same as a real query would for a device with only non-SUCCESS actions.
    prisma.incidentAction.findFirst.mockResolvedValue(null);

    const device = await service.findById('device-1');

    expect(device.isolated).toBe(false);
  });

  /**
   * Phase 16 (performance/scale review): findAll() previously computed each
   * device's status via a separate withComputedStatus() call per device —
   * 2 DB queries per device (N+1), unbounded by device count. Now it issues
   * exactly 2 queries total regardless of how many devices are returned,
   * and correctly attributes each device's own incidents/isolation state
   * from the batched result — not mixed up across devices.
   */
  describe('batched status computation (Phase 16 N+1 fix)', () => {
    const deviceA = { ...rawDevice, id: 'device-a', hostname: 'A' };
    const deviceB = { ...rawDevice, id: 'device-b', hostname: 'B' };
    const deviceC = { ...rawDevice, id: 'device-c', hostname: 'C' };

    it('issues exactly 2 queries total for any number of devices, not 2 per device', async () => {
      prisma.device.findMany.mockResolvedValue([deviceA, deviceB, deviceC]);

      await service.findAll(admin);

      expect(prisma.incident.findMany).toHaveBeenCalledTimes(1);
      expect(prisma.incidentAction.findMany).toHaveBeenCalledTimes(1);
      expect(prisma.incidentAction.findFirst).not.toHaveBeenCalled();
      // Both batched queries must cover every returned device's id, not just one.
      expect(prisma.incident.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ deviceId: { in: ['device-a', 'device-b', 'device-c'] } }),
        }),
      );
    });

    it('attributes incidents and isolation state to the correct device, never mixed up', async () => {
      prisma.device.findMany.mockResolvedValue([deviceA, deviceB, deviceC]);
      prisma.incident.findMany.mockResolvedValue([
        { deviceId: 'device-a', severity: 'CRITICAL' },
      ]);
      prisma.incidentAction.findMany.mockResolvedValue([
        {
          id: 'action-b',
          updatedAt: new Date('2026-08-15T12:00:00Z'),
          performedBy: 'analyst@mirqab.local',
          incident: { deviceId: 'device-b' },
        },
      ]);

      const [a, b, c] = await service.findAll(admin);

      expect(a.status).toBe('AT_RISK');
      expect(a.activeIncidentCount).toBe(1);
      expect(a.isolated).toBe(false);

      expect(b.status).toBe('ONLINE');
      expect(b.activeIncidentCount).toBe(0);
      expect(b.isolated).toBe(true);
      expect(b.isolatedBy).toBe('analyst@mirqab.local');

      expect(c.status).toBe('ONLINE');
      expect(c.activeIncidentCount).toBe(0);
      expect(c.isolated).toBe(false);
    });

    it('keeps only the most recent SUCCESS isolation per device when multiple exist', async () => {
      prisma.device.findMany.mockResolvedValue([deviceA]);
      // Already ordered by updatedAt desc, same contract the real Prisma
      // query provides — the batching logic must take the first match per
      // device, not the last.
      prisma.incidentAction.findMany.mockResolvedValue([
        {
          id: 'action-newest',
          updatedAt: new Date('2026-08-20T00:00:00Z'),
          performedBy: 'newest@mirqab.local',
          incident: { deviceId: 'device-a' },
        },
        {
          id: 'action-older',
          updatedAt: new Date('2026-08-01T00:00:00Z'),
          performedBy: 'older@mirqab.local',
          incident: { deviceId: 'device-a' },
        },
      ]);

      const [device] = await service.findAll(admin);

      expect(device.isolatedBy).toBe('newest@mirqab.local');
    });

    it('returns an empty array without querying incidents/actions when there are no devices', async () => {
      prisma.device.findMany.mockResolvedValue([]);

      const result = await service.findAll(admin);

      expect(result).toEqual([]);
      expect(prisma.incident.findMany).not.toHaveBeenCalled();
      expect(prisma.incidentAction.findMany).not.toHaveBeenCalled();
    });
  });

  /**
   * Phase 1 RBAC/IDOR remediation. Before this fix, `findAll` accepted a
   * client-supplied `?departmentId=` query parameter with zero validation
   * — the exact IDOR the baseline flagged as the most severe of the four
   * P0 collection-endpoint findings.
   */
  describe('department scoping (Phase 1 RBAC/IDOR fix)', () => {
    it('ADMIN with no departmentId filter sees every department within their own organization', async () => {
      await service.findAll(admin);
      expect(prisma.device.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { organizationId: 'org-1' } }),
      );
    });

    it('ADMIN explicitly filtering by departmentId is honored as-is (org-wide role, trusted)', async () => {
      await service.findAll(admin, 'dept-2');
      expect(prisma.device.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { organizationId: 'org-1', departmentId: 'dept-2' } }),
      );
    });

    it('IT_TECHNICIAN with no departmentId query param is scoped to their own department (Device.departmentId is required — no "undepartmented" case exists)', async () => {
      await service.findAll(techDeptA);
      expect(prisma.device.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { organizationId: 'org-1', departmentId: 'dept-1' } }),
      );
    });

    it('IT_TECHNICIAN explicitly requesting their own department is allowed', async () => {
      await service.findAll(techDeptA, 'dept-1');
      expect(prisma.device.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { organizationId: 'org-1', departmentId: 'dept-1' } }),
      );
    });

    it('IT_TECHNICIAN requesting a DIFFERENT department via ?departmentId= is rejected — the IDOR is closed', async () => {
      await expect(service.findAll(techDeptA, 'dept-2')).rejects.toThrow(ForbiddenException);
      // The rejection must happen before any query runs — no partial leak.
      expect(prisma.device.findMany).not.toHaveBeenCalled();
    });

    it('a second technician in a different department cannot see the first department\'s devices either', async () => {
      await expect(service.findAll(techDeptB, 'dept-1')).rejects.toThrow(ForbiddenException);
      expect(prisma.device.findMany).not.toHaveBeenCalled();
    });
  });

  /** Phase 2.6B — cross-organization IDOR/BOLA. */
  describe('organization scoping', () => {
    it("scopes the query to the caller's own organization, not a global scan", async () => {
      await service.findAll(otherOrgAdmin);
      expect(prisma.device.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { organizationId: 'org-B' } }),
      );
    });

    it('never returns another organization\'s device list, even for ADMIN', async () => {
      // Simulates the DB genuinely filtering — the mock only returns what
      // a real `where: { organizationId: 'org-B' }` query would.
      prisma.device.findMany.mockResolvedValue([]);
      const result = await service.findAll(otherOrgAdmin);
      expect(result).toEqual([]);
    });
  });
});

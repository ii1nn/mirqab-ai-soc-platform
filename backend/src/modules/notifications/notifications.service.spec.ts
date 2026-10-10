import { EventEmitter2 } from '@nestjs/event-emitter';
import { Test } from '@nestjs/testing';
import { Role } from '@prisma/client';
import { ROLES_KEY } from '../../common/decorators/roles.decorator';
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';
import { PrismaService } from '../../database/prisma/prisma.service';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';

describe('NotificationsService — response-window notifications', () => {
  let service: NotificationsService;
  let prisma: {
    incident: { findUnique: jest.Mock };
    notification: { create: jest.Mock; findMany: jest.Mock };
  };
  let events: { emit: jest.Mock };

  const createdAt = new Date('2026-09-26T10:00:00.000Z');
  const incident = {
    id: 'incident-1',
    caseId: 'INC-20260926-0001',
    title: 'Data Encrypted for Impact detected',
    severity: 'CRITICAL',
    createdAt,
    acknowledgedAt: null,
    departmentId: 'dept-1',
    organizationId: 'org-1',
    device: { hostname: 'IT-WKS-01' },
    department: { name: 'IT Operations' },
  };

  beforeEach(async () => {
    prisma = {
      incident: { findUnique: jest.fn().mockResolvedValue(incident) },
      notification: {
        create: jest.fn(async ({ data }) => ({ id: 'notif-1', createdAt: new Date(), ...data })),
        findMany: jest.fn().mockResolvedValue([]),
      },
    };
    events = { emit: jest.fn() };
    const moduleRef = await Test.createTestingModule({
      providers: [
        NotificationsService,
        { provide: PrismaService, useValue: prisma },
        { provide: EventEmitter2, useValue: events },
      ],
    }).compile();
    service = moduleRef.get(NotificationsService);
  });

  it('creates a real "response required" Notification row with a stable kind code and an English fallback body', async () => {
    await service.notifyResponseRequired('incident-1');

    expect(prisma.notification.create).toHaveBeenCalledWith({
      data: {
        incidentId: 'incident-1',
        audience: 'ANALYST',
        title: 'mirqab:response-required',
        body: expect.stringContaining('respond within 5 minutes (by 2026-09-26T10:05:00.000Z)'),
      },
    });
  });

  it('emits notification.created scoped to the incident organization/department, with every structured field the UI needs to render EN/AR text', async () => {
    await service.notifyResponseRequired('incident-1');

    expect(events.emit).toHaveBeenCalledWith(
      'notification.created',
      expect.objectContaining({
        organizationId: 'org-1',
        departmentId: 'dept-1',
        serverNow: expect.any(Date),
        notification: expect.objectContaining({
          kind: 'RESPONSE_REQUIRED',
          containmentResult: null,
          incident: {
            id: 'incident-1',
            caseId: 'INC-20260926-0001',
            title: 'Data Encrypted for Impact detected',
            severity: 'CRITICAL',
            deviceName: 'IT-WKS-01',
            departmentName: 'IT Operations',
            detectedAt: createdAt,
            responseDeadline: new Date('2026-09-26T10:05:00.000Z'),
            acknowledgedAt: null,
          },
        }),
      }),
    );
  });

  it.each([
    ['SUCCEEDED', 'Automatic containment succeeded'],
    ['FAILED', 'did not succeed. Reason: fetch failed'],
    ['UNAVAILABLE', 'no endpoint-control provider is configured'],
    ['POLICY_DISABLED', 'policy is disabled'],
  ] as const)('containment result %s is encoded in the kind code and the fallback text', async (result, text) => {
    await service.notifyContainmentResult('incident-1', result, result === 'FAILED' ? 'fetch failed' : null);

    expect(prisma.notification.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        title: `mirqab:containment:${result}`,
        body: expect.stringContaining(text),
      }),
    });
    expect(events.emit).toHaveBeenCalledWith(
      'notification.created',
      expect.objectContaining({
        notification: expect.objectContaining({ kind: 'CONTAINMENT_RESULT', containmentResult: result }),
      }),
    );
  });

  it('never throws — a failed notification write can never fail/roll back the security record it follows', async () => {
    prisma.notification.create.mockRejectedValue(new Error('db down'));
    await expect(service.notifyResponseRequired('incident-1')).resolves.toBeNull();
    expect(events.emit).not.toHaveBeenCalled();
  });

  describe('GET /notifications scoping', () => {
    const base: AuthenticatedUser = {
      id: 'u',
      email: 'u@mirqab.local',
      role: Role.SECURITY_ANALYST,
      departmentId: 'dept-1',
      organizationId: 'org-1',
    };

    it('scopes every role to its own organization', async () => {
      await service.listForUser(base);
      expect(prisma.notification.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { audience: 'ANALYST', incident: { organizationId: 'org-1' } },
        }),
      );
    });

    it('additionally scopes IT_TECHNICIAN to its own department (plus undepartmented incidents), like IncidentAccessGuard', async () => {
      await service.listForUser({ ...base, role: Role.IT_TECHNICIAN });
      expect(prisma.notification.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            audience: 'ANALYST',
            incident: {
              organizationId: 'org-1',
              OR: [{ departmentId: 'dept-1' }, { departmentId: null }],
            },
          },
        }),
      );
    });

    it('fails closed for a user with no organization', async () => {
      await service.listForUser({ ...base, organizationId: null });
      expect(prisma.notification.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ incident: { organizationId: '__no_organization_assigned__' } }),
        }),
      );
    });

    it('returns pre-existing free-text notifications as LEGACY (rendered as-is), new ones with structured kinds', async () => {
      prisma.notification.findMany.mockResolvedValue([
        { id: 'n1', title: 'mirqab:response-required', body: 'x', audience: 'ANALYST', createdAt, incident },
        { id: 'n2', title: 'New high severity incident', body: 'legacy text', audience: 'ANALYST', createdAt, incident },
        { id: 'n3', title: 'mirqab:containment:NOT_A_RESULT', body: 'y', audience: 'ANALYST', createdAt, incident },
      ]);
      const { items, serverNow } = await service.listForUser(base);
      expect(serverNow).toBeInstanceOf(Date);
      expect(items.map((item) => item.kind)).toEqual(['RESPONSE_REQUIRED', 'LEGACY', 'LEGACY']);
      expect(items[1].fallbackBody).toBe('legacy text');
    });

    it('the endpoint is restricted to the SOC roles (no EMPLOYEE access)', () => {
      expect(Reflect.getMetadata(ROLES_KEY, NotificationsController)).toEqual([
        Role.ADMIN,
        Role.SECURITY_ANALYST,
        Role.IT_TECHNICIAN,
      ]);
    });
  });
});

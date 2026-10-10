import { Test } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Role } from '@prisma/client';
import { PrismaService } from '../../database/prisma/prisma.service';
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { TicketsService } from './tickets.service';

/**
 * Phase 1 RBAC/IDOR remediation. Before this fix, `TicketsService.findAll()`
 * ran `prisma.ticket.findMany({ orderBy, take: 200 })` with no `where`
 * clause at all — every authenticated IT_TECHNICIAN saw every department's
 * tickets. This is the first dedicated spec for TicketsService; it exists
 * specifically to pin down the fix (no prior test covered this method).
 */
describe('TicketsService', () => {
  let service: TicketsService;
  let prisma: { ticket: { findMany: jest.Mock } };

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
  const otherOrgAdmin: AuthenticatedUser = {
    id: 'admin-2',
    email: 'admin@org-b.local',
    role: Role.ADMIN,
    departmentId: null,
    organizationId: 'org-B',
  };

  beforeEach(async () => {
    prisma = { ticket: { findMany: jest.fn().mockResolvedValue([]) } };

    const moduleRef = await Test.createTestingModule({
      providers: [
        TicketsService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditLogsService, useValue: { log: jest.fn() } },
        { provide: EventEmitter2, useValue: { emit: jest.fn() } },
      ],
    }).compile();

    service = moduleRef.get(TicketsService);
  });

  it('ADMIN sees every department within their own organization', async () => {
    await service.findAll(admin);
    expect(prisma.ticket.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { organizationId: 'org-1' }, take: 200 }),
    );
  });

  it('IT_TECHNICIAN is scoped to their own department plus undepartmented tickets, within their organization', async () => {
    await service.findAll(techDeptA);
    expect(prisma.ticket.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { OR: [{ departmentId: 'dept-1' }, { departmentId: null }], organizationId: 'org-1' },
        take: 200,
      }),
    );
  });

  /** Phase 2.6B — cross-organization IDOR/BOLA. */
  it("scopes the query to the caller's own organization, not a global scan", async () => {
    await service.findAll(otherOrgAdmin);
    expect(prisma.ticket.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { organizationId: 'org-B' }, take: 200 }),
    );
  });
});

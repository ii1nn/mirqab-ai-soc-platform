import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { Role } from '@prisma/client';
import { RedisService } from '../../redis/redis.service';
import { UsersService } from '../users/users.service';
import { REALTIME_EVENTS } from './events';
import { RealtimeGateway } from './realtime.gateway';

function mockSocket(
  token?: string,
  address = '203.0.113.1',
  headers: Record<string, string> = {},
) {
  return {
    handshake: {
      auth: token ? { token } : {},
      headers,
      address,
    },
    data: {} as Record<string, unknown>,
    join: jest.fn(),
    disconnect: jest.fn(),
  };
}

/** A JWT `exp` claim (seconds since epoch) `seconds` from now. */
function expiresInSeconds(seconds: number): number {
  return Math.floor(Date.now() / 1000) + seconds;
}

/**
 * Phase 12: the `RealtimeGateway` describe block below mocks `JwtService`
 * entirely, so its "pins JWT verification to HS256" test only proves the
 * gateway *passes* `algorithms: ['HS256']` to `verifyAsync` — not that the
 * real `jsonwebtoken` library underneath actually enforces it. This block
 * uses a REAL `@nestjs/jwt` `JwtService`, constructed with a synthetic,
 * throwaway, in-memory-only secret (never read from any env file, config,
 * or real deployment value, and discarded when the process exits) to prove
 * the same call shape the gateway uses genuinely rejects a hand-built,
 * completely unsigned `alg: none` token — entirely in-process, no network
 * connection, no live socket, no server process involved.
 */
describe('RealtimeGateway JWT verification — real jsonwebtoken behavior (Phase 12)', () => {
  const TEST_ONLY_SECRET = 'phase-12-test-only-secret-never-used-for-anything-real';
  const realJwtService = new JwtService({ secret: TEST_ONLY_SECRET });

  function buildUnsignedNoneToken(payload: Record<string, unknown>): string {
    const b64url = (obj: unknown) => Buffer.from(JSON.stringify(obj)).toString('base64url');
    const header = { alg: 'none', typ: 'JWT' };
    return `${b64url(header)}.${b64url(payload)}.`;
  }

  it('rejects a synthetic, completely unsigned alg:none token even when it claims role:ADMIN', async () => {
    const forged = buildUnsignedNoneToken({
      sub: 'attacker',
      email: 'attacker@mirqab.local',
      role: 'ADMIN',
    });

    await expect(
      realJwtService.verifyAsync(forged, {
        secret: TEST_ONLY_SECRET,
        algorithms: ['HS256'],
      }),
    ).rejects.toThrow();
  });

  it('rejects a token genuinely signed with a different algorithm (HS384) under the same options', async () => {
    const wrongAlgToken = realJwtService.sign(
      { sub: 'user-1', email: 'x@mirqab.local', role: 'ADMIN' },
      { secret: TEST_ONLY_SECRET, algorithm: 'HS384' },
    );

    await expect(
      realJwtService.verifyAsync(wrongAlgToken, {
        secret: TEST_ONLY_SECRET,
        algorithms: ['HS256'],
      }),
    ).rejects.toThrow();
  });

  it('control case: a genuinely HS256-signed token with the same options is accepted', async () => {
    const validToken = realJwtService.sign(
      { sub: 'user-1', email: 'x@mirqab.local', role: 'SECURITY_ANALYST' },
      { secret: TEST_ONLY_SECRET, algorithm: 'HS256' },
    );

    await expect(
      realJwtService.verifyAsync(validToken, {
        secret: TEST_ONLY_SECRET,
        algorithms: ['HS256'],
      }),
    ).resolves.toMatchObject({ sub: 'user-1' });
  });
});

/** `server.to(rooms).emit(event, payload)` — the mock needs `.to()` to
 * return an object with its own `.emit()` so a test can assert both which
 * rooms were targeted and what was sent to them, distinctly from the
 * global `server.emit()` used by the one handler (policy.updated) that's
 * still a genuine broadcast. */
function mockServer() {
  const roomEmitter = { emit: jest.fn() };
  return {
    emit: jest.fn(),
    to: jest.fn().mockReturnValue(roomEmitter),
    __roomEmitter: roomEmitter,
  };
}

describe('RealtimeGateway', () => {
  let gateway: RealtimeGateway;
  let jwtService: jest.Mocked<Pick<JwtService, 'verifyAsync'>>;
  let usersService: jest.Mocked<Pick<UsersService, 'findById'>>;
  let redisService: jest.Mocked<Pick<RedisService, 'createAdapterClients'>>;

  const activeAnalyst = {
    id: 'user-1',
    email: 'analyst@mirqab.local',
    role: Role.SECURITY_ANALYST,
    departmentId: null,
    organizationId: 'org-1',
    isActive: true,
  };

  const activeTechnician = {
    id: 'user-2',
    email: 'tech@mirqab.local',
    role: Role.IT_TECHNICIAN,
    departmentId: 'dept-a',
    organizationId: 'org-1',
    isActive: true,
  };

  beforeEach(async () => {
    jwtService = { verifyAsync: jest.fn() };
    usersService = { findById: jest.fn() };
    redisService = { createAdapterClients: jest.fn().mockReturnValue(null) };

    const moduleRef = await Test.createTestingModule({
      providers: [
        RealtimeGateway,
        { provide: JwtService, useValue: jwtService },
        { provide: ConfigService, useValue: { get: () => 'access-secret' } },
        { provide: UsersService, useValue: usersService },
        { provide: RedisService, useValue: redisService },
      ],
    }).compile();

    gateway = moduleRef.get(RealtimeGateway);
    gateway.server = mockServer() as never;
  });

  describe('afterInit', () => {
    // What Nest actually injects here is the Socket.IO Namespace, not the
    // root Server — `.adapter()` lives on `namespace.server`, not the
    // namespace itself (see the comment on RealtimeGateway.afterInit).
    function mockNamespace() {
      return { server: { adapter: jest.fn() }, emit: jest.fn() };
    }

    it('runs single-instance (no adapter call) when Redis is not configured', () => {
      redisService.createAdapterClients.mockReturnValue(null);
      const namespace = mockNamespace();

      gateway.afterInit(namespace as never);

      expect(namespace.server.adapter).not.toHaveBeenCalled();
    });

    it('installs the Redis adapter when Redis is configured', () => {
      const clients = { pubClient: {}, subClient: {} };
      redisService.createAdapterClients.mockReturnValue(clients as never);
      const namespace = mockNamespace();

      gateway.afterInit(namespace as never);

      expect(namespace.server.adapter).toHaveBeenCalledTimes(1);
      // Requirement (Phase 1 follow-up): the Redis adapter is what makes
      // room-targeted `server.to(room).emit()` calls fan out correctly
      // across multiple backend replicas — Socket.IO's adapter layer
      // (not this gateway) is what propagates room membership/targeting
      // over Redis pub/sub, so installing it here is what keeps the
      // department-scoping fix correct once you scale beyond one replica.
    });
  });

  describe('handleConnection', () => {
    it('accepts a dashboard role with a valid token and attaches the user', async () => {
      jwtService.verifyAsync.mockResolvedValue({ sub: activeAnalyst.id });
      usersService.findById.mockResolvedValue(activeAnalyst as never);

      const client = mockSocket('valid.jwt.token');
      await gateway.handleConnection(client as never);

      expect(client.disconnect).not.toHaveBeenCalled();
      expect(client.data.user).toEqual({
        id: activeAnalyst.id,
        email: activeAnalyst.email,
        role: activeAnalyst.role,
        departmentId: activeAnalyst.departmentId,
        organizationId: activeAnalyst.organizationId,
      });
    });

    /** Phase 2.6B: an account not yet assigned to an organization has no
     * organization room to join and no organization-scoped event it could
     * legitimately receive — rejected at handshake, same fail-closed
     * principle as every REST-side organization check. */
    it('rejects a user with no organization assigned', async () => {
      jwtService.verifyAsync.mockResolvedValue({ sub: activeAnalyst.id });
      usersService.findById.mockResolvedValue({
        ...activeAnalyst,
        organizationId: null,
      } as never);

      const client = mockSocket('valid.jwt.token');
      await gateway.handleConnection(client as never);

      expect(client.disconnect).toHaveBeenCalledWith(true);
      expect(client.join).not.toHaveBeenCalled();
    });

    it('rejects a connection with no token', async () => {
      const client = mockSocket();
      await gateway.handleConnection(client as never);

      expect(client.disconnect).toHaveBeenCalledWith(true);
      expect(jwtService.verifyAsync).not.toHaveBeenCalled();
    });

    it('rejects an invalid or expired token', async () => {
      jwtService.verifyAsync.mockRejectedValue(new Error('jwt expired'));

      const client = mockSocket('expired.jwt.token');
      await gateway.handleConnection(client as never);

      expect(client.disconnect).toHaveBeenCalledWith(true);
    });

    it('rejects a malformed token string', async () => {
      jwtService.verifyAsync.mockRejectedValue(new Error('jwt malformed'));

      const client = mockSocket('not-a-real-jwt');
      await gateway.handleConnection(client as never);

      expect(client.disconnect).toHaveBeenCalledWith(true);
    });

    // Phase 12: this gateway registers its own separate JwtModule (see
    // websocket.module.ts) — Phase 11 pinned `algorithms: ['HS256']` on
    // every REST-side verify call site but missed this one. An unsigned
    // `alg:none` token (or one signed with a different algorithm) must be
    // rejected by the real jsonwebtoken verifier underneath verifyAsync,
    // which only happens if this option is actually passed through.
    it('pins JWT verification to HS256 — no algorithm-confusion / alg:none acceptance', async () => {
      jwtService.verifyAsync.mockResolvedValue({ sub: activeAnalyst.id });
      usersService.findById.mockResolvedValue(activeAnalyst as never);

      const client = mockSocket('valid.jwt.token');
      await gateway.handleConnection(client as never);

      expect(jwtService.verifyAsync).toHaveBeenCalledWith(
        'valid.jwt.token',
        expect.objectContaining({ algorithms: ['HS256'] }),
      );
    });

    it('rejects the EMPLOYEE role — this gateway is dashboard-only', async () => {
      jwtService.verifyAsync.mockResolvedValue({ sub: 'employee-1' });
      usersService.findById.mockResolvedValue({ ...activeAnalyst, role: Role.EMPLOYEE } as never);

      const client = mockSocket('valid.jwt.token');
      await gateway.handleConnection(client as never);

      expect(client.disconnect).toHaveBeenCalledWith(true);
    });

    it('rejects a deactivated user', async () => {
      jwtService.verifyAsync.mockResolvedValue({ sub: activeAnalyst.id });
      usersService.findById.mockResolvedValue({ ...activeAnalyst, isActive: false } as never);

      const client = mockSocket('valid.jwt.token');
      await gateway.handleConnection(client as never);

      expect(client.disconnect).toHaveBeenCalledWith(true);
    });

    /**
     * Phase 1 RBAC/IDOR remediation — room membership at connect time.
     * Before this fix, no rooms existed at all: every handler called bare
     * `server.emit()`, so room membership was moot. These pin down the
     * join behavior the department-scoped emits below depend on.
     */
    describe('room membership (Phase 1/2.6B fix)', () => {
      it('ADMIN/SECURITY_ANALYST join only their own organization room', async () => {
        jwtService.verifyAsync.mockResolvedValue({ sub: activeAnalyst.id });
        usersService.findById.mockResolvedValue(activeAnalyst as never);

        const client = mockSocket('valid.jwt.token');
        await gateway.handleConnection(client as never);

        expect(client.join).toHaveBeenCalledWith('org:org-1');
        expect(client.join).toHaveBeenCalledTimes(1);
      });

      it("IT_TECHNICIAN joins their own org+department room plus that org's unassigned room, never the bare org room", async () => {
        jwtService.verifyAsync.mockResolvedValue({ sub: activeTechnician.id });
        usersService.findById.mockResolvedValue(activeTechnician as never);

        const client = mockSocket('valid.jwt.token');
        await gateway.handleConnection(client as never);

        expect(client.join).toHaveBeenCalledWith(['dept:org-1:dept-a', 'dept:org-1:unassigned']);
        expect(client.join).not.toHaveBeenCalledWith('org:org-1');
      });

      it('a departmentless IT_TECHNICIAN joins only their organization\'s unassigned room — fails closed, not open', async () => {
        jwtService.verifyAsync.mockResolvedValue({ sub: activeTechnician.id });
        usersService.findById.mockResolvedValue({
          ...activeTechnician,
          departmentId: null,
        } as never);

        const client = mockSocket('valid.jwt.token');
        await gateway.handleConnection(client as never);

        expect(client.join).toHaveBeenCalledWith(['dept:org-1:unassigned', 'dept:org-1:unassigned']);
      });

      /** Phase 2.6B — two technicians in the same-named department but
       * different organizations must join distinct rooms, never the same
       * one (department ids happen to be UUIDs so a real collision is
       * astronomically unlikely, but the room name must still be
       * org-qualified structurally, not just by luck). */
      it('technicians in the same department id but different organizations join different rooms', async () => {
        jwtService.verifyAsync.mockResolvedValue({ sub: activeTechnician.id });
        usersService.findById.mockResolvedValue({
          ...activeTechnician,
          organizationId: 'org-2',
        } as never);

        const client = mockSocket('valid.jwt.token');
        await gateway.handleConnection(client as never);

        expect(client.join).toHaveBeenCalledWith(['dept:org-2:dept-a', 'dept:org-2:unassigned']);
        expect(client.join).not.toHaveBeenCalledWith(['dept:org-1:dept-a', 'dept:org-1:unassigned']);
      });
    });
  });

  describe('per-IP connection-attempt rate limiting (Phase 12 fix)', () => {
    // Pure in-memory unit-level exercise of the counter — no real sockets,
    // no network I/O, no Docker. Not the live/flood testing the phase
    // instructions prohibit.
    it('rejects the 21st connection attempt within 60s from the same address, without ever reaching JWT verification', async () => {
      jwtService.verifyAsync.mockResolvedValue({ sub: activeAnalyst.id });
      usersService.findById.mockResolvedValue(activeAnalyst as never);

      for (let i = 0; i < 20; i++) {
        const client = mockSocket('valid.jwt.token', '198.51.100.7');
        await gateway.handleConnection(client as never);
        expect(client.disconnect).not.toHaveBeenCalled();
      }

      jwtService.verifyAsync.mockClear();
      const blockedClient = mockSocket('valid.jwt.token', '198.51.100.7');
      await gateway.handleConnection(blockedClient as never);

      expect(blockedClient.disconnect).toHaveBeenCalledWith(true);
      expect(jwtService.verifyAsync).not.toHaveBeenCalled();
    });

    it('tracks each source address independently — one noisy IP does not block another', async () => {
      jwtService.verifyAsync.mockResolvedValue({ sub: activeAnalyst.id });
      usersService.findById.mockResolvedValue(activeAnalyst as never);

      for (let i = 0; i < 21; i++) {
        const client = mockSocket('valid.jwt.token', '198.51.100.7');
        await gateway.handleConnection(client as never);
      }

      const otherClient = mockSocket('valid.jwt.token', '198.51.100.8');
      await gateway.handleConnection(otherClient as never);

      expect(otherClient.disconnect).not.toHaveBeenCalled();
    });

    it('trusts X-Forwarded-For when the immediate peer is a private/nginx address, grouping by the real client', async () => {
      jwtService.verifyAsync.mockResolvedValue({ sub: activeAnalyst.id });
      usersService.findById.mockResolvedValue(activeAnalyst as never);

      for (let i = 0; i < 21; i++) {
        const client = mockSocket('valid.jwt.token', '172.18.0.5', {
          'x-forwarded-for': '198.51.100.50',
        });
        await gateway.handleConnection(client as never);
        if (i === 20) expect(client.disconnect).toHaveBeenCalledWith(true);
      }

      // A different real client behind the same nginx (same private peer,
      // different forwarded address) must not be caught by the first
      // client's limit — proves grouping is by the forwarded value, not
      // nginx's own shared address.
      const otherRealClient = mockSocket('valid.jwt.token', '172.18.0.5', {
        'x-forwarded-for': '198.51.100.51',
      });
      await gateway.handleConnection(otherRealClient as never);
      expect(otherRealClient.disconnect).not.toHaveBeenCalled();
    });

    it('ignores a spoofed X-Forwarded-For when the immediate peer is a public address', async () => {
      jwtService.verifyAsync.mockResolvedValue({ sub: activeAnalyst.id });
      usersService.findById.mockResolvedValue(activeAnalyst as never);

      // A caller connecting directly (not through nginx) rotates a
      // self-reported X-Forwarded-For on every attempt trying to evade the
      // limiter — since its own peer address (203.0.113.9) is public, the
      // header must be ignored and every attempt counted against the one
      // real (public) peer address instead.
      for (let i = 0; i < 20; i++) {
        const client = mockSocket('valid.jwt.token', '203.0.113.9', {
          'x-forwarded-for': `10.0.0.${i}`,
        });
        await gateway.handleConnection(client as never);
      }

      const blockedClient = mockSocket('valid.jwt.token', '203.0.113.9', {
        'x-forwarded-for': '10.0.0.99',
      });
      await gateway.handleConnection(blockedClient as never);

      expect(blockedClient.disconnect).toHaveBeenCalledWith(true);
    });

    it('allows a fresh attempt again once the 60s window has elapsed', async () => {
      jest.useFakeTimers();
      jwtService.verifyAsync.mockResolvedValue({ sub: activeAnalyst.id });
      usersService.findById.mockResolvedValue(activeAnalyst as never);

      for (let i = 0; i < 21; i++) {
        const client = mockSocket('valid.jwt.token', '198.51.100.9');
        await gateway.handleConnection(client as never);
      }

      jest.advanceTimersByTime(60_001);

      const client = mockSocket('valid.jwt.token', '198.51.100.9');
      await gateway.handleConnection(client as never);

      expect(client.disconnect).not.toHaveBeenCalled();
      jest.useRealTimers();
    });
  });

  describe('connection lifetime bounded to access-token expiry (Phase 12 fix)', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('disconnects the socket once the token\'s own exp elapses, not before', async () => {
      jwtService.verifyAsync.mockResolvedValue({
        sub: activeAnalyst.id,
        exp: expiresInSeconds(900),
      });
      usersService.findById.mockResolvedValue(activeAnalyst as never);

      const client = mockSocket('valid.jwt.token');
      await gateway.handleConnection(client as never);

      expect(client.disconnect).not.toHaveBeenCalled();

      jest.advanceTimersByTime(899_000);
      expect(client.disconnect).not.toHaveBeenCalled();

      jest.advanceTimersByTime(2_000);
      expect(client.disconnect).toHaveBeenCalledWith(true);
    });

    it('clears the pending expiry timer on disconnect — no dangling timer, no double-disconnect', async () => {
      jwtService.verifyAsync.mockResolvedValue({
        sub: activeAnalyst.id,
        exp: expiresInSeconds(900),
      });
      usersService.findById.mockResolvedValue(activeAnalyst as never);

      const client = mockSocket('valid.jwt.token');
      await gateway.handleConnection(client as never);

      // Simulate a normal disconnect (logout, tab close) well before expiry.
      gateway.handleDisconnect(client as never);
      client.disconnect.mockClear();

      jest.advanceTimersByTime(1_000_000);
      expect(client.disconnect).not.toHaveBeenCalled();
    });

    it('does not schedule a timer (and does not throw) when the payload has no exp claim', async () => {
      jwtService.verifyAsync.mockResolvedValue({ sub: activeAnalyst.id });
      usersService.findById.mockResolvedValue(activeAnalyst as never);

      const client = mockSocket('valid.jwt.token');
      await gateway.handleConnection(client as never);

      expect(client.data.expiryTimer).toBeUndefined();
      expect(() => gateway.handleDisconnect(client as never)).not.toThrow();
    });
  });

  describe('event broadcasting — department- and organization-scoped routing (Phase 1/2.6B fix)', () => {
    it("routes incident.created to the incident's own organization room and org+department room only", () => {
      const payload = {
        incident: { id: 'incident-1', departmentId: 'dept-a', organizationId: 'org-1' },
      } as never;
      gateway.handleIncidentCreated(payload);

      expect(gateway.server.to).toHaveBeenCalledWith(['org:org-1', 'dept:org-1:dept-a']);
      expect((gateway.server as never as ReturnType<typeof mockServer>).__roomEmitter.emit).toHaveBeenCalledWith(
        REALTIME_EVENTS.INCIDENT_CREATED,
        payload,
      );
      // The critical negative assertion: no bare, unscoped global emit.
      expect(gateway.server.emit).not.toHaveBeenCalled();
    });

    it("routes an undepartmented incident to that organization's unassigned room, not every technician's own room", () => {
      const payload = {
        incident: { id: 'incident-2', departmentId: null, organizationId: 'org-1' },
      } as never;
      gateway.handleIncidentUpdated(payload);

      expect(gateway.server.to).toHaveBeenCalledWith(['org:org-1', 'dept:org-1:unassigned']);
    });

    /** Phase 2.6B: an incident with no organization at all (device
     * unresolved at ingestion) must never be broadcast to anyone — not
     * guessed into an organization, and critically not sent as a bare,
     * unscoped global emit either (see emitScoped's own comment on why
     * `.to([]).emit(...)` would otherwise broadcast to literally everyone). */
    it('broadcasts nothing at all for an incident with no organization — never a global fallback emit', () => {
      const payload = {
        incident: { id: 'incident-orphan', departmentId: null, organizationId: null },
      } as never;
      gateway.handleIncidentCreated(payload);

      expect(gateway.server.to).not.toHaveBeenCalled();
      expect(gateway.server.emit).not.toHaveBeenCalled();
    });

    it("routes ticket.updated using the ticket's own organization and departmentId", () => {
      const payload = {
        ticket: { id: 'ticket-1', departmentId: 'dept-b', organizationId: 'org-1' },
      } as never;
      gateway.handleTicketUpdated(payload);

      expect(gateway.server.to).toHaveBeenCalledWith(['org:org-1', 'dept:org-1:dept-b']);
    });

    it("routes incident-action.created using the payload's explicit organizationId/departmentId (IncidentAction has no columns of its own)", () => {
      const payload = {
        action: { id: 'action-1' },
        departmentId: 'dept-c',
        organizationId: 'org-1',
      } as never;
      gateway.handleIncidentActionCreated(payload);

      expect(gateway.server.to).toHaveBeenCalledWith(['org:org-1', 'dept:org-1:dept-c']);
    });

    it("routes incident.persistence-detected using the payload's explicit organizationId/departmentId", () => {
      const payload = {
        incidentId: 'incident-3',
        count: 2,
        departmentId: 'dept-a',
        organizationId: 'org-1',
      } as never;
      gateway.handlePersistenceFindingDetected(payload);

      expect(gateway.server.to).toHaveBeenCalledWith(['org:org-1', 'dept:org-1:dept-a']);
    });

    it('still broadcasts policy.updated globally — Policy has no organization/department column at all (a documented, deferred schema gap) and GET /policies is genuinely org-wide today', () => {
      const payload = { policy: { id: 'policy-1' } } as never;
      gateway.handlePolicyUpdated(payload);

      expect(gateway.server.emit).toHaveBeenCalledWith(REALTIME_EVENTS.POLICY_UPDATED, payload);
      expect(gateway.server.to).not.toHaveBeenCalled();
    });

    /**
     * The most important individual case: before Phase 1, a full AuditLog
     * row (which IT_TECHNICIAN cannot even read via GET /audit-logs — that
     * route is @Roles(ADMIN, SECURITY_ANALYST) only) was broadcast to
     * every connected socket regardless of role. Phase 2.6B narrows it
     * further to the audit log's own organization room only.
     */
    it("routes audit-log.created to the audit log's own organization room ONLY — never a department room, matching REST's role-only gate", () => {
      const payload = {
        auditLog: { id: 'audit-1', actorEmail: 'x@y.com', organizationId: 'org-1' },
      } as never;
      gateway.handleAuditLogCreated(payload);

      expect(gateway.server.to).toHaveBeenCalledWith('org:org-1');
      expect(gateway.server.to).not.toHaveBeenCalledWith(expect.stringContaining('dept:'));
    });

    /** Phase 2.6B: a null-organization audit log (synthetic system actor
     * with no resolvable org) must never be broadcast globally either. */
    it('broadcasts nothing for an audit log with no organization — never a global fallback', () => {
      const payload = {
        auditLog: { id: 'audit-2', actorEmail: 'system:x', organizationId: null },
      } as never;
      gateway.handleAuditLogCreated(payload);

      expect(gateway.server.to).not.toHaveBeenCalled();
      expect(gateway.server.emit).not.toHaveBeenCalled();
    });

    /** Phase 2.6B — cross-organization: an event for Organization A must
     * never target Organization B's rooms. */
    it("never targets another organization's room for an org-scoped event", () => {
      const payload = {
        incident: { id: 'incident-4', departmentId: 'dept-a', organizationId: 'org-A' },
      } as never;
      gateway.handleIncidentCreated(payload);

      expect(gateway.server.to).not.toHaveBeenCalledWith(
        expect.arrayContaining([expect.stringContaining('org-B')]),
      );
    });
  });
});

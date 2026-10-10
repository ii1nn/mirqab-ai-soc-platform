import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OnEvent } from '@nestjs/event-emitter';
import { JwtService } from '@nestjs/jwt';
import {
  ConnectedSocket,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Role } from '@prisma/client';
import { createAdapter } from '@socket.io/redis-adapter';
import { Namespace, Server, Socket } from 'socket.io';
import { RedisService } from '../../redis/redis.service';
import { UsersService } from '../users/users.service';
import { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import {
  AuditLogEventPayload,
  IncidentActionEventPayload,
  IncidentEventPayload,
  IncidentEvidenceEventPayload,
  NotificationEventPayload,
  PersistenceFindingEventPayload,
  PolicyEventPayload,
  REALTIME_EVENTS,
  TicketEventPayload,
} from './events';

// Realtime push is a SOC Dashboard concern only — the Employee Desktop app
// doesn't consume this gateway, so EMPLOYEE connections are rejected here
// the same way EMPLOYEE accounts are rejected at dashboard login.
const DASHBOARD_ROLES: Role[] = [Role.ADMIN, Role.SECURITY_ANALYST, Role.IT_TECHNICIAN];

/**
 * Phase 1 RBAC/IDOR remediation: before this, every handler below called
 * bare `this.server.emit(...)` — a global broadcast with no per-department
 * filtering, so an IT_TECHNICIAN's dashboard received realtime pushes
 * (including full `AuditLog` rows, which that role can't even read via
 * REST) for every department, not just their own. This is the same
 * department-scoping rule assertDepartmentAccess/departmentScopeWhere
 * already enforce over REST, applied to Socket.IO rooms instead:
 *
 * - ADMIN/SECURITY_ANALYST join ORG_WIDE_ROOM at connect and receive every
 *   department-scoped event (mirrors their org-wide REST access).
 * - IT_TECHNICIAN joins only their own department's room, plus
 *   UNASSIGNED_DEPARTMENT_ROOM (undepartmented resources are accessible to
 *   any authenticated privileged user over REST too — see
 *   assertDepartmentAccess's null-department exception).
 * - Every department-scoped emit targets [ORG_WIDE_ROOM, deptRoom(id)] —
 *   Socket.IO delivers once per socket even if it's in both rooms.
 */
/**
 * Phase 2.6B: rooms are now nested under the organization boundary —
 * `org:{organizationId}` replaces the single global ORG_WIDE_ROOM, and
 * `dept:{organizationId}:{departmentId}` replaces the bare
 * `dept:{departmentId}` so a department id alone (never guaranteed unique
 * across organizations, though it happens to be a UUID here) can't be used
 * to construct a room name matching another organization's department.
 * Every room join still happens exactly once, at handleConnection, driven
 * entirely by server-fetched `user.organizationId`/`user.departmentId` —
 * there are still zero `@SubscribeMessage` handlers, so a client cannot
 * request, select, or influence which rooms it joins.
 */
function orgRoom(organizationId: string): string {
  return `org:${organizationId}`;
}

function unassignedDeptRoom(organizationId: string): string {
  return `dept:${organizationId}:unassigned`;
}

function deptRoom(organizationId: string, departmentId: string | null): string {
  return departmentId ? `dept:${organizationId}:${departmentId}` : unassignedDeptRoom(organizationId);
}

@WebSocketGateway({
  namespace: 'realtime',
  cors: {
    origin: (process.env.CORS_ORIGIN ?? 'http://localhost:5173')
      .split(',')
      .map((origin) => origin.trim()),
    credentials: true,
  },
})
export class RealtimeGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(RealtimeGateway.name);

  // Phase 12: `OnGatewayConnection.handleConnection()` is a Socket.IO
  // lifecycle hook invoked directly by @nestjs/platform-socket.io's
  // adapter, not a route Nest wraps in its guard/interceptor pipeline —
  // the app-wide ThrottlerGuard (see app.module.ts, Phase 11) never runs
  // for it. Without this, the handshake path had no rate limiting of any
  // kind: an attacker could open unlimited connection attempts (each
  // costing one JWT verify + one DB lookup once past this check), the same
  // resource-consumption concern Phase 11's login throttle exists for.
  // In-memory/per-IP, matching this gateway's single-instance-by-default
  // deployment (see afterInit) — not Redis-backed, since this is a
  // lightweight targeted control, not a new piece of shared infrastructure.
  private readonly connectionAttempts = new Map<string, number[]>();
  private static readonly CONNECTION_ATTEMPT_LIMIT = 20;
  private static readonly CONNECTION_ATTEMPT_WINDOW_MS = 60_000;
  // Safety valve, not a precision bound: caps this Map's own memory
  // footprint against an attacker rotating source IPs specifically to grow
  // it, at the cost of occasionally resetting every IP's window together.
  private static readonly MAX_TRACKED_IPS = 5_000;

  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly usersService: UsersService,
    private readonly redisService: RedisService,
  ) {}

  /**
   * Single-instance deployments (REDIS_URL unset) work exactly as before —
   * `server.emit()` reaches every socket on this one process. Once you run
   * more than one backend replica behind a load balancer, each replica only
   * knows about its own connected sockets; the Redis adapter republishes
   * every `server.emit()` through Redis pub/sub so all replicas broadcast
   * it, not just the one whose domain service happened to emit the event.
   *
   * Because this gateway declares `namespace: 'realtime'`, what Nest injects
   * here (and into `@WebSocketServer() server`) is actually the Socket.IO
   * `Namespace` instance, not the root `Server` — `@nestjs/websockets`
   * types it as `Server` regardless, but `Namespace` has no `.adapter()`
   * setter of its own (only the root server does); `namespace.server` is
   * how you get back to it. Verified against a real crash: `TypeError:
   * server.adapter is not a function` the first time this ran in a real
   * container, not caught by any test since the gateway spec mocks `server`
   * as `{ adapter: jest.fn(), emit: jest.fn() }` rather than a real socket.io object.
   */
  afterInit(namespace: Namespace): void {
    const clients = this.redisService.createAdapterClients();
    if (!clients) {
      this.logger.log(
        'REDIS_URL not set — RealtimeGateway running single-instance, no cross-instance adapter',
      );
      return;
    }

    namespace.server.adapter(createAdapter(clients.pubClient, clients.subClient));
    this.logger.log('RealtimeGateway using the Redis adapter for cross-instance broadcast');
  }

  async handleConnection(@ConnectedSocket() client: Socket): Promise<void> {
    const address = this.resolveClientAddress(client);
    if (this.isRateLimited(address)) {
      this.logger.warn(`Rejected websocket connection: rate limit exceeded for ${address}`);
      client.disconnect(true);
      return;
    }

    try {
      const token = this.extractToken(client);
      const payload = await this.jwtService.verifyAsync<JwtPayload & { exp?: number }>(token, {
        secret: this.configService.get<string>('jwt.accessSecret'),
        // Phase 12: matches the Phase 11 fix applied to every REST-side
        // verify call — this gateway registers its own separate JwtModule
        // (see websocket.module.ts) and was missed by that earlier pass.
        algorithms: ['HS256'],
      });

      const user = await this.usersService.findById(payload.sub);
      if (!user || !user.isActive || !DASHBOARD_ROLES.includes(user.role)) {
        throw new Error('User is not authorized for realtime updates');
      }
      // Phase 2.6B: an account not yet assigned to an organization (see
      // AuthenticatedUser's doc comment) has no organization room to join
      // and no organization-scoped event it could legitimately receive —
      // rejected here, same fail-closed principle as every REST-side
      // organization check.
      if (!user.organizationId) {
        throw new Error('User is not yet assigned to an organization');
      }

      client.data.user = {
        id: user.id,
        email: user.email,
        role: user.role,
        departmentId: user.departmentId,
        organizationId: user.organizationId,
      };

      if (user.role === Role.IT_TECHNICIAN) {
        await client.join([
          deptRoom(user.organizationId, user.departmentId),
          unassignedDeptRoom(user.organizationId),
        ]);
      } else {
        await client.join(orgRoom(user.organizationId));
      }

      // Phase 12: unlike REST (where every request re-verifies the token
      // and JwtStrategy re-fetches the user live — see auth/strategies/
      // jwt.strategy.ts), a Socket.IO connection is only ever authenticated
      // once, at handshake time. Without this, a socket that connected
      // while the access token was valid would keep receiving every
      // department-scoped broadcast indefinitely — well past the token's
      // own 15-minute default expiry, and unaffected by a role change,
      // deactivation, or Phase 11's password-reset-revokes-all-sessions —
      // until it happened to disconnect for an unrelated reason (network
      // drop, tab close) and reconnect with a fresh token. This bounds a
      // connection's protected-event lifetime to the same window REST
      // already enforces, without building a real-time revocation
      // mechanism (see this phase's report for why that's out of scope).
      if (typeof payload.exp === 'number') {
        const msUntilExpiry = Math.max(0, payload.exp * 1000 - Date.now());
        client.data.expiryTimer = setTimeout(() => {
          this.logger.log(`Disconnecting socket for ${user.email} — access token expired`);
          client.disconnect(true);
        }, msUntilExpiry);
      }
    } catch (error) {
      this.logger.warn(
        `Rejected websocket connection: ${error instanceof Error ? error.message : error}`,
      );
      client.disconnect(true);
    }
  }

  handleDisconnect(@ConnectedSocket() client: Socket): void {
    // Broadcasts are stateless (server.emit to every connected client) —
    // there's no per-connection subscription state to tear down. The one
    // thing that *does* need cleanup is the token-expiry timer above —
    // without this, a socket that disconnects normally (logout, tab close)
    // well before its token would have expired leaves a dangling timer
    // that fires later and calls .disconnect() on an already-closed socket.
    const timer = client.data?.expiryTimer as ReturnType<typeof setTimeout> | undefined;
    if (timer) {
      clearTimeout(timer);
    }
  }

  @OnEvent(REALTIME_EVENTS.INCIDENT_CREATED)
  handleIncidentCreated(payload: IncidentEventPayload): void {
    this.emitScoped(
      REALTIME_EVENTS.INCIDENT_CREATED,
      payload.incident.organizationId,
      payload.incident.departmentId,
      payload,
    );
  }

  @OnEvent(REALTIME_EVENTS.INCIDENT_UPDATED)
  handleIncidentUpdated(payload: IncidentEventPayload): void {
    this.emitScoped(
      REALTIME_EVENTS.INCIDENT_UPDATED,
      payload.incident.organizationId,
      payload.incident.departmentId,
      payload,
    );
  }

  @OnEvent(REALTIME_EVENTS.INCIDENT_EVIDENCE_ADDED)
  handleIncidentEvidenceAdded(payload: IncidentEvidenceEventPayload): void {
    this.emitScoped(
      REALTIME_EVENTS.INCIDENT_EVIDENCE_ADDED,
      payload.incident.organizationId,
      payload.incident.departmentId,
      payload,
    );
  }

  @OnEvent(REALTIME_EVENTS.PERSISTENCE_FINDING_DETECTED)
  handlePersistenceFindingDetected(payload: PersistenceFindingEventPayload): void {
    this.emitScoped(
      REALTIME_EVENTS.PERSISTENCE_FINDING_DETECTED,
      payload.organizationId,
      payload.departmentId,
      payload,
    );
  }

  @OnEvent(REALTIME_EVENTS.INCIDENT_ACTION_CREATED)
  handleIncidentActionCreated(payload: IncidentActionEventPayload): void {
    this.emitScoped(
      REALTIME_EVENTS.INCIDENT_ACTION_CREATED,
      payload.organizationId,
      payload.departmentId,
      payload,
    );
  }

  @OnEvent(REALTIME_EVENTS.INCIDENT_ACTION_UPDATED)
  handleIncidentActionUpdated(payload: IncidentActionEventPayload): void {
    this.emitScoped(
      REALTIME_EVENTS.INCIDENT_ACTION_UPDATED,
      payload.organizationId,
      payload.departmentId,
      payload,
    );
  }

  @OnEvent(REALTIME_EVENTS.TICKET_CREATED)
  handleTicketCreated(payload: TicketEventPayload): void {
    this.emitScoped(
      REALTIME_EVENTS.TICKET_CREATED,
      payload.ticket.organizationId,
      payload.ticket.departmentId,
      payload,
    );
  }

  @OnEvent(REALTIME_EVENTS.TICKET_UPDATED)
  handleTicketUpdated(payload: TicketEventPayload): void {
    this.emitScoped(
      REALTIME_EVENTS.TICKET_UPDATED,
      payload.ticket.organizationId,
      payload.ticket.departmentId,
      payload,
    );
  }

  /**
   * Phase 2.6B: Policy has no organizationId column (schema.prisma) — a
   * genuine schema gap discovered and documented, not fixed here (would
   * require a migration, out of scope for this phase; see the phase's own
   * final report). GET /policies remains genuinely global for all three
   * dashboard roles under the current data model, so a global broadcast
   * here is honest and consistent with that, not a new bug — it is not the
   * same class of issue the handlers above had, which is why this one
   * stays as `server.emit(...)` rather than routed through roomsFor().
   */
  @OnEvent(REALTIME_EVENTS.POLICY_UPDATED)
  handlePolicyUpdated(payload: PolicyEventPayload): void {
    this.server.emit(REALTIME_EVENTS.POLICY_UPDATED, payload);
  }

  /** Phase 2.6B: AuditLog now has an organizationId (nullable — see
   * AuditLogsService.log()), so this is routed to the org room rather than
   * broadcast globally. Still never targets a department room — unlike the
   * resources above, IT_TECHNICIAN cannot read audit logs via REST at all
   * (AuditLogsController is @Roles(ADMIN, SECURITY_ANALYST) only), so
   * there's no department-level audience to narrow to; org-wide (within
   * the audit log's own organization) is the correct full scope. A
   * null-organization audit log (synthetic system actor with no
   * resolvable org, or a not-yet-backfilled legacy row) is broadcast to no
   * room at all — never guessed into an organization, consistent with how
   * such rows are excluded from AuditLogsService.findAll() too. */
  @OnEvent(REALTIME_EVENTS.NOTIFICATION_CREATED)
  handleNotificationCreated(payload: NotificationEventPayload): void {
    this.emitScoped(
      REALTIME_EVENTS.NOTIFICATION_CREATED,
      payload.organizationId,
      payload.departmentId,
      payload,
    );
  }

  @OnEvent(REALTIME_EVENTS.AUDIT_LOG_CREATED)
  handleAuditLogCreated(payload: AuditLogEventPayload): void {
    if (!payload.auditLog.organizationId) return;
    this.server
      .to(orgRoom(payload.auditLog.organizationId))
      .emit(REALTIME_EVENTS.AUDIT_LOG_CREATED, payload);
  }

  /** Every department-scoped event targets the requesting-role-appropriate
   * room set: the resource's org room (ADMIN/SECURITY_ANALYST in that org,
   * always) plus the specific org+department room (or that org's
   * unassigned-department room) an IT_TECHNICIAN in that same org would
   * need to be in to legitimately see this resource — see the class-level
   * doc comment. Both ids are always read from the payload the domain
   * service already fetched from the database (the Incident/Ticket's own
   * `organizationId`/`departmentId`, or values threaded through from a
   * Prisma-loaded incident — see ai.service.ts's emit call sites), never
   * from anything socket/client-supplied.
   *
   * Phase 2.6B: a null organizationId (the same genuinely-ownerless
   * incidents/tickets excluded from every REST list query — see
   * department-access.util.ts's assertOrganizationAccess) is broadcast to
   * no room at all, never guessed into an organization and never treated
   * as visible to every organization by omission. */
  private roomsFor(organizationId: string | null, departmentId: string | null): string[] {
    if (!organizationId) return [];
    return [orgRoom(organizationId), deptRoom(organizationId, departmentId)];
  }

  /**
   * Phase 2.6B: the single chokepoint every organization-scoped broadcast
   * goes through. Deliberately never calls `this.server.to(rooms).emit(...)`
   * with an empty `rooms` array — Socket.IO's `.to()` only *adds* to an
   * internal target-room set; calling it with `[]` adds nothing, and a
   * `BroadcastOperator` with no rooms ever added falls back to emitting to
   * the entire namespace (the same as calling `.emit()` directly with no
   * `.to()` at all). A null-organization payload (see roomsFor) would
   * therefore have silently broadcast to *every* connected socket across
   * every organization — the exact opposite of the intended fail-closed
   * behavior — if this guard weren't here. Caught during this phase's own
   * implementation, not left as a live bug.
   */
  private emitScoped(
    event: string,
    organizationId: string | null,
    departmentId: string | null,
    payload: unknown,
  ): void {
    const rooms = this.roomsFor(organizationId, departmentId);
    if (rooms.length === 0) return;
    this.server.to(rooms).emit(event, payload);
  }

  /**
   * `engine.io` (the transport underneath Socket.IO) computes
   * `handshake.address` from the raw TCP socket's own remote address only —
   * confirmed by reading `engine.io/build/socket.js`'s Socket.remoteAddress
   * — it never consults X-Forwarded-For, unlike Express (main.ts's
   * `trust proxy` setting, Phase 11, has no effect here at all). Behind
   * nginx, that raw address is always nginx's own Docker-internal address
   * for every real client, which would make the rate limiter below a
   * global bucket shared by every user rather than a per-client one —
   * the same failure mode Phase 11 fixed for the REST throttle, just not
   * fixable by that same fix since this is a different code path entirely.
   *
   * Only trust a forwarded header when the immediate peer is itself on a
   * private/loopback/link-local network (i.e., plausibly nginx sitting on
   * the same Docker network) — mirrors Express's own `trust proxy:
   * 'uniquelocal'` semantics (see main.ts) without a new dependency. A
   * caller connecting directly to the backend's own published port (its
   * own peer address is not private) gets its raw address used regardless
   * of any header it sends, so it cannot spoof its way around this limiter
   * — the same residual scope this has for the REST throttle: this bounds
   * abuse, it is not an authentication/authorization boundary, and the
   * real security controls (JWT verification, role/department checks)
   * apply identically no matter what key this resolves to.
   */
  private resolveClientAddress(client: Socket): string {
    const rawAddress = client.handshake.address;
    const forwardedFor = client.handshake.headers['x-forwarded-for'];

    if (!forwardedFor || !this.isPrivateAddress(rawAddress)) {
      return rawAddress;
    }

    const first = Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor;
    return first.split(',')[0].trim() || rawAddress;
  }

  private isPrivateAddress(address: string): boolean {
    const addr = address.replace(/^::ffff:/, '');
    return (
      addr === '127.0.0.1' ||
      addr === '::1' ||
      /^10\./.test(addr) ||
      /^192\.168\./.test(addr) ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(addr) ||
      /^169\.254\./.test(addr) ||
      /^f[cd][0-9a-f]{2}:/i.test(addr)
    );
  }

  /** Sliding-window connection-attempt counter, keyed by remote address —
   * see the Phase 12 comment on the fields above for why this exists and
   * why it's in-memory rather than Redis-backed. Records the attempt
   * unconditionally (even a rejected one still counts), matching how
   * @nestjs/throttler's own default behavior counts a request whether or
   * not it was ultimately authorized. */
  private isRateLimited(address: string): boolean {
    if (this.connectionAttempts.size > RealtimeGateway.MAX_TRACKED_IPS) {
      this.connectionAttempts.clear();
    }

    const now = Date.now();
    const recent = (this.connectionAttempts.get(address) ?? []).filter(
      (timestamp) => now - timestamp < RealtimeGateway.CONNECTION_ATTEMPT_WINDOW_MS,
    );
    recent.push(now);
    this.connectionAttempts.set(address, recent);

    return recent.length > RealtimeGateway.CONNECTION_ATTEMPT_LIMIT;
  }

  private extractToken(client: Socket): string {
    const authToken = client.handshake.auth?.token as string | undefined;
    const headerToken = client.handshake.headers.authorization;
    const token = authToken ?? (headerToken ? headerToken.replace(/^Bearer\s+/i, '') : undefined);

    if (!token) {
      throw new Error('Missing authentication token');
    }

    return token;
  }
}

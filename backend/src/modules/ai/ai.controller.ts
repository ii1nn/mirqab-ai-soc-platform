import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { EventSource, Role } from '@prisma/client';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { IncidentAccessGuard } from '../../common/guards/incident-access.guard';
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';
import { AiService } from './ai.service';
import { AnalyzeLogDto } from './dto/analyze-log.dto';
import { ApplyRecommendedDto } from './dto/apply-recommended.dto';
import { CreateIncidentActionDto } from './dto/create-incident-action.dto';
import { RejectIncidentActionDto } from './dto/reject-incident-action.dto';
import { UpdateIncidentActionDto } from './dto/update-incident-action.dto';
import { UpdateIncidentResolutionDto } from './dto/update-incident-resolution.dto';
import { UpdateIncidentStatusDto } from './dto/update-incident-status.dto';
import { ResponseSlaService } from './response-sla/response-sla.service';
import { TrainingBenchmarkService } from './training-data/training-benchmark.service';

/**
 * SOC-facing only — EMPLOYEE accounts have no reason to call the AI engine
 * directly. IncidentAccessGuard (requirement #30, OWASP API #1) adds the
 * missing object-level check on top of RolesGuard's role-only check — see
 * the guard for the department-scoping rule it applies to IT_TECHNICIAN.
 */
@Controller('ai')
@Roles(Role.ADMIN, Role.SECURITY_ANALYST, Role.IT_TECHNICIAN)
@UseGuards(IncidentAccessGuard)
export class AiController {
  constructor(
    private readonly aiService: AiService,
    private readonly trainingBenchmark: TrainingBenchmarkService,
    private readonly responseSla: ResponseSlaService,
  ) {}

  /** Phase 9 observability (Section 14): AI provider health/circuit-breaker
   * status — no prompts, no incident content, nothing sensitive. Lets an
   * analyst confirm e.g. "AI is currently unavailable, deterministic
   * analysis is being used" without needing server/log access. */
  @Get('provider-status')
  getAiProviderStatus() {
    return this.aiService.getAiProviderStatus();
  }

  /** Phase 11: the one write/DB-mutating endpoint on this controller with no
   * object-scoped target yet (deviceId is optional) — an authenticated but
   * malicious/compromised low-privilege account could otherwise flood the
   * classification pipeline and incident table at the generous global
   * default (100/60s). 20/60s comfortably covers real usage (the SOC
   * Dashboard's simulation engine posts one event every 8s — see
   * apps/soc-dashboard/src/simulation/simulationEngine.ts) plus manual
   * testing bursts, without materially slowing a genuine analyst down. */
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post('analyze')
  analyze(@Body() dto: AnalyzeLogDto, @CurrentUser() user: AuthenticatedUser) {
    return this.aiService.analyzeLog(
      {
        sourceExcerpt: dto.sourceExcerpt,
        deviceId: dto.deviceId,
        ingestSource: dto.source === 'SIMULATION' ? EventSource.SIMULATION : EventSource.MANUAL_TEST,
      },
      user,
    );
  }

  @Get('incidents')
  listIncidents(@CurrentUser() user: AuthenticatedUser) {
    return this.aiService.listIncidents(user);
  }

  /** Integration Phase 4: read-only classifier accuracy check against the bundled labeled
   * training records — never creates Incidents, never writes to the database. */
  @Get('training-records/benchmark')
  getTrainingBenchmark() {
    return this.trainingBenchmark.run();
  }

  /** Must be registered before `incidents/:id` or "history" would be matched as an id. */
  @Get('incidents/history')
  listIncidentHistory(@CurrentUser() user: AuthenticatedUser) {
    return this.aiService.listIncidentHistory(user);
  }

  @Get('incidents/:id')
  getIncident(@Param('id', ParseUUIDPipe) id: string) {
    return this.aiService.getIncident(id);
  }

  @Get('incidents/:id/history')
  getIncidentHistory(@Param('id', ParseUUIDPipe) id: string) {
    return this.aiService.getIncidentHistory(id);
  }

  @Patch('incidents/:id/status')
  updateStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateIncidentStatusDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.aiService.updateIncidentStatus(id, dto.status, user.email);
  }

  /** "Acknowledge & Investigate" — the explicit response that stops the
   * 5-minute window's automated containment. Object-level access is the
   * controller-wide IncidentAccessGuard (organization + department scope);
   * idempotent and audited in ResponseSlaService.acknowledge. */
  @Post('incidents/:id/acknowledge')
  @HttpCode(HttpStatus.OK)
  acknowledge(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.responseSla.acknowledge(id, user);
  }

  @Patch('incidents/:id/resolution')
  updateResolution(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateIncidentResolutionDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.aiService.updateIncidentResolution(id, dto, user.email);
  }

  @Get('incidents/:id/similar')
  findSimilar(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.aiService.findSimilarIncidents(id, user);
  }

  /** Real IOC/IOA rows for this case — see modules/ai/detection/indicator.util.ts. */
  @Get('incidents/:id/indicators')
  listIndicators(@Param('id', ParseUUIDPipe) id: string) {
    return this.aiService.listIndicators(id);
  }

  /** Real persistence findings for this case — see modules/ai/detection/persistence.util.ts. */
  @Get('incidents/:id/persistence-findings')
  listPersistenceFindings(@Param('id', ParseUUIDPipe) id: string) {
    return this.aiService.listPersistenceFindings(id);
  }

  /** Requirement #29's AI agent decision audit trail for this case. */
  @Get('incidents/:id/agent-decisions')
  listAgentDecisions(@Param('id', ParseUUIDPipe) id: string) {
    return this.aiService.listAgentDecisions(id);
  }

  /** Phase 16 (performance/scale review): calls the same AI-provider layer
   * Phase 9's concurrency cap/circuit breaker protects (AiService.
   * generateAnalystReport → this.aiProvider.generateText()) — the same
   * resource-consumption concern that already got `/ai/analyze` a 20/60s
   * throttle above, just missed here. Same limit, same reasoning: an
   * on-demand, per-incident report an analyst clicks a handful of times a
   * minute during real use, not a bulk operation. */
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post('incidents/:id/analyst-report')
  @HttpCode(HttpStatus.OK)
  generateReport(@Param('id', ParseUUIDPipe) id: string) {
    return this.aiService.generateAnalystReport(id);
  }

  /** The Similar Attack Analysis investigation bundle — see AiService.getInvestigation. */
  @Get('incidents/:id/investigation')
  getInvestigation(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.aiService.getInvestigation(id, user);
  }

  @Get('incidents/:id/actions')
  listActions(@Param('id', ParseUUIDPipe) id: string) {
    return this.aiService.listIncidentActions(id);
  }

  @Post('incidents/:id/actions')
  createAction(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateIncidentActionDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.aiService.createIncidentAction(id, dto, user.email);
  }

  @Patch('incidents/:id/actions/:actionId')
  updateAction(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('actionId', ParseUUIDPipe) actionId: string,
    @Body() dto: UpdateIncidentActionDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.aiService.updateIncidentAction(id, actionId, dto.outcome, user.email);
  }

  @Post('incidents/:id/apply-recommended')
  @HttpCode(HttpStatus.OK)
  applyRecommended(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ApplyRecommendedDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.aiService.applyRecommended(id, dto.types, user.email);
  }

  /** Requirement #6: explicit human approval before a high-impact AI-recommended action can be executed. */
  @Post('incidents/:id/actions/:actionId/approve')
  @HttpCode(HttpStatus.OK)
  approveAction(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('actionId', ParseUUIDPipe) actionId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.aiService.approveIncidentAction(id, actionId, user.email);
  }

  @Post('incidents/:id/actions/:actionId/reject')
  @HttpCode(HttpStatus.OK)
  rejectAction(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('actionId', ParseUUIDPipe) actionId: string,
    @Body() dto: RejectIncidentActionDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.aiService.rejectIncidentAction(id, actionId, user.email, dto.reason);
  }
}

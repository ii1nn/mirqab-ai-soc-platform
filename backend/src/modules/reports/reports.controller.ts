import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { IncidentAccessGuard } from '../../common/guards/incident-access.guard';
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';
import { CaseReportService } from './case-report.service';
import { GenerateWeeklyReportDto } from './dto/generate-weekly-report.dto';
import { GetWeeklySummaryDto } from './dto/get-weekly-summary.dto';
import { ListWeeklyReportsDto } from './dto/list-weekly-reports.dto';
import { WeeklyReportService } from './weekly-report.service';

/**
 * Requirement #39 — Case report and Weekly report share this controller's
 * `/reports` namespace but are otherwise kept as distinct documents per the
 * requirements' explicit instruction not to conflate them (see
 * case-report.service.ts vs weekly-report.service.ts).
 */
@Controller('reports')
@Roles(Role.ADMIN, Role.SECURITY_ANALYST, Role.IT_TECHNICIAN)
export class ReportsController {
  constructor(
    private readonly caseReportService: CaseReportService,
    private readonly weeklyReportService: WeeklyReportService,
  ) {}

  /** Same object-level check as every other Case ID endpoint (requirement #30). */
  @UseGuards(IncidentAccessGuard)
  @Get('case/:id')
  @Header('Content-Type', 'application/pdf')
  async getCaseReport(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<StreamableFile> {
    const { buffer, filename } = await this.caseReportService.generate(id, user);
    return new StreamableFile(buffer, {
      disposition: `attachment; filename="${filename}"`,
      type: 'application/pdf',
    });
  }

  /** Requirement #38: manual generation for a selected week, and regeneration
   * of a previous week (upsert — see WeeklyReportService). Defaults to the
   * most recently completed week when no weekStart is given.
   *
   * Phase 2.6B: a caller with no organization (see AuthenticatedUser's doc
   * comment) is rejected before this reaches the service — there's no
   * organization boundary to generate a report within. */
  @Post('weekly/generate')
  @HttpCode(HttpStatus.OK)
  async generateWeeklyReport(
    @Body() dto: GenerateWeeklyReportDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    this.assertOrganization(user);
    return dto.weekStart
      ? this.weeklyReportService.generateForWeekContaining(
          new Date(dto.weekStart),
          user.email,
          user.organizationId!,
        )
      : this.weeklyReportService.generatePreviousWeek(user.email, user.organizationId!);
  }

  /** Week Selector: live (non-persisted) KPI summary for the Weekly SOC
   * Summary card — a lightweight read, not the Official PDF flow. Any day
   * within the target week; omit for the current in-progress week (this
   * card's existing default). Organization-scoped the same way every other
   * reporting endpoint here is. */
  @Get('weekly/summary')
  async getWeeklySummary(
    @Query() query: GetWeeklySummaryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    this.assertOrganization(user);
    return this.weeklyReportService.getLiveSummary(
      query.weekStart ? new Date(query.weekStart) : undefined,
      user.organizationId!,
    );
  }

  /** Week Selector: every real Sunday-Saturday period this organization has
   * data for (plus the current week), for populating the selector's list —
   * not filtered to "has data", so genuinely empty weeks remain selectable
   * and honestly show zeros rather than being hidden. */
  @Get('weekly/available-weeks')
  async listAvailableWeeks(@CurrentUser() user: AuthenticatedUser) {
    this.assertOrganization(user);
    return this.weeklyReportService.listAvailableWeeks(user.organizationId!);
  }

  /** Requirement #38: report history, searchable by reporting period. Phase
   * 2.6B: organization-scoped. */
  @Get('weekly')
  async listWeeklyReports(
    @Query() query: ListWeeklyReportsDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    this.assertOrganization(user);
    return this.weeklyReportService.listHistory(user.organizationId!, {
      from: query.from ? new Date(query.from) : undefined,
      to: query.to ? new Date(query.to) : undefined,
    });
  }

  /** Requirement #38: download a previously generated (or regenerated)
   * week's report. Phase 2.6B: organization-scoped. */
  @Get('weekly/:id/download')
  @Header('Content-Type', 'application/pdf')
  async downloadWeeklyReport(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<StreamableFile> {
    this.assertOrganization(user);
    const { pdf, filename } = await this.weeklyReportService.getPdf(id, user.organizationId!);
    return new StreamableFile(pdf, {
      disposition: `attachment; filename="${filename}"`,
      type: 'application/pdf',
    });
  }

  /** Phase 2.6B: a not-yet-assigned account (organizationId null) has no
   * organization boundary to scope a Weekly Report to — fail closed here
   * rather than let a null slip through to the service layer. */
  private assertOrganization(user: AuthenticatedUser): void {
    if (!user.organizationId) {
      throw new ForbiddenException('Your account is not yet assigned to an organization.');
    }
  }
}

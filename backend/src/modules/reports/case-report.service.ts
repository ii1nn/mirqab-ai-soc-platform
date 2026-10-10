import { Injectable } from '@nestjs/common';
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';
import { AiService } from '../ai/ai.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { PdfWriter } from './pdf/pdf-writer.util';

const ORG_NAME = process.env.ORG_NAME ?? 'Mirqab Security Operations';

function formatDate(value: Date | string): string {
  return new Date(value).toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
}

/**
 * Requirement #39 — Case-Based Digital Forensics Report. Reuses the same
 * real data every other case view already reads (AiService's
 * history/investigation/agent-decisions, plus the audit trail) rather than
 * re-querying the database directly — this report is a different
 * presentation of the same Case ID data, not a separate source of truth.
 * Generated on demand, same as the existing Markdown analyst report; not
 * persisted (see ReportsModule for the Weekly report's different, persisted
 * history requirement).
 */
@Injectable()
export class CaseReportService {
  constructor(
    private readonly aiService: AiService,
    private readonly auditLogs: AuditLogsService,
  ) {}

  async generate(
    incidentId: string,
    user: AuthenticatedUser,
  ): Promise<{ buffer: Buffer; filename: string }> {
    const [history, investigation, agentDecisions, analystReport, auditTrail] = await Promise.all([
      this.aiService.getIncidentHistory(incidentId),
      this.aiService.getInvestigation(incidentId, user),
      this.aiService.listAgentDecisions(incidentId),
      this.aiService.generateAnalystReport(incidentId).catch(() => null),
      this.auditLogs.findByTarget(incidentId),
    ]);

    const w = new PdfWriter();
    const caseId = (history as { caseId?: string }).caseId ?? incidentId;

    w.coverTitle('MIRQAB CASE-BASED DIGITAL FORENSICS REPORT', `Case ${caseId}`);
    w.metaLine('Organization', ORG_NAME);
    w.metaLine('Generated At', formatDate(new Date()));
    w.metaLine('Case ID', caseId);
    w.metaLine('Status', history.status);
    w.metaLine('Severity', history.severity);
    w.divider();

    w.heading('1. Incident Summary');
    w.keyValueTable([
      ['Title', history.title],
      ['Detected At', formatDate(history.detectedAt)],
      [
        'Acknowledged At',
        history.acknowledgedAt ? formatDate(history.acknowledgedAt) : 'Not yet acknowledged',
      ],
      ['Resolved At', history.resolvedAt ? formatDate(history.resolvedAt) : 'Not yet resolved'],
      ['Department', history.departmentName ?? 'Unknown'],
      ['Endpoint', history.deviceName ?? 'Unknown'],
      ['Device IP', history.deviceIp ?? '—'],
      ['Operating System', history.operatingSystem ?? '—'],
      ['MITRE Technique', `${history.mitreTechniqueId} — ${history.mitreTechniqueName}`],
      ['MITRE Tactic', history.attackCategory],
      ['Ticket', history.ticketNumber ?? 'No auto-created ticket'],
    ]);
    w.paragraph(history.description);

    w.heading('2. Evidence');
    if (history.evidence.length === 0) {
      w.emptyState('No evidence rows recorded for this case.');
    } else {
      for (const item of history.evidence) {
        w.subheading(
          `${formatDate(item.createdAt)} — ${item.mitreTechniqueId} ${item.mitreTechniqueName}`,
        );
        w.keyValueTable([
          ['Severity at time of event', item.severity],
          [
            'Correlation score',
            item.correlationScore !== null ? `${item.correlationScore}/100` : 'Founding event',
          ],
        ]);
        w.paragraph(item.sourceExcerpt.slice(0, 1000));
      }
    }

    w.heading('3. Timeline');
    if (history.timeline.length === 0) {
      w.emptyState('No timeline entries recorded.');
    } else {
      w.bulletList(
        history.timeline.map(
          (entry) =>
            `${formatDate(entry.timestamp)} — ${entry.event}${entry.description ? `: ${entry.description}` : ''}`,
        ),
      );
    }

    w.heading('4. Indicators of Compromise (IOC)');
    const iocs = history.indicators.filter((i) => i.category === 'IOC');
    if (iocs.length === 0) {
      w.emptyState('No indicators of compromise extracted from this case’s evidence.');
    } else {
      w.bulletList(iocs.map((i) => `[${i.type}] ${i.value} — confidence ${i.confidence}%`));
    }

    w.heading('5. Indicators of Attack (IOA)');
    const ioas = history.indicators.filter(
      (i) => i.category === 'IOA' && !i.subtype?.startsWith('c2-'),
    );
    if (ioas.length === 0) {
      w.emptyState('No behavioral indicators of attack detected in this case’s evidence.');
    } else {
      w.bulletList(
        ioas.map(
          (i) =>
            `${i.description ?? i.value} (${i.subtype ?? 'behavioral'}) — confidence ${i.confidence}%`,
        ),
      );
    }

    w.heading('6. Persistence Findings');
    if (history.persistenceFindings.length === 0) {
      w.emptyState(
        'No persistence mechanisms detected — insufficient evidence to claim persistence for this case.',
      );
    } else {
      for (const finding of history.persistenceFindings) {
        w.subheading(
          `${finding.type.replace(/_/g, ' ')} — risk ${finding.risk}, confidence ${finding.confidence}%`,
        );
        w.keyValueTable([
          ['Endpoint', finding.endpoint ?? 'Unknown'],
          ['User account', finding.userAccount ?? 'Unknown'],
          ['Process', finding.process ?? '—'],
          ['Command', finding.command ?? '—'],
          ['MITRE Technique', `${finding.mitreTechniqueId} — ${finding.mitreTechniqueName}`],
          ['Detected At', formatDate(finding.createdAt)],
        ]);
        w.paragraph(`Evidence: ${finding.evidenceText}`);
      }
    }

    w.heading('7. Command and Control (C2)');
    const c2 = history.indicators.filter((i) => i.subtype?.startsWith('c2-'));
    if (c2.length === 0) {
      w.emptyState('No command-and-control indicators detected in this case’s evidence.');
    } else {
      w.bulletList(
        c2.map((i) => `${i.description ?? i.value} (${i.subtype}) — confidence ${i.confidence}%`),
      );
    }

    w.heading('8. AI Analysis');
    w.subheading('Agent decisions');
    if (agentDecisions.length === 0) {
      w.emptyState('No AI agent decisions recorded for this case.');
    } else {
      w.bulletList(
        agentDecisions.map(
          (d) =>
            `[${d.agent}] ${d.action} (${d.generatedBy}${d.confidence !== null ? `, confidence ${d.confidence}%` : ''}) — ${d.summary}`,
        ),
      );
    }
    w.subheading('Risk prediction');
    w.keyValueTable([
      ['Business impact', investigation.riskPrediction.businessImpact],
      [
        'Lateral movement probability',
        investigation.riskPrediction.lateralMovementProbability !== null
          ? `${investigation.riskPrediction.lateralMovementProbability}%`
          : 'Insufficient data for this reporting period.',
      ],
      ['Confidence', `${investigation.riskPrediction.confidence}%`],
      ['Sample size', String(investigation.riskPrediction.sampleSize)],
    ]);
    if (analystReport) {
      w.subheading(`Narrative report (${analystReport.generatedBy})`);
      w.paragraph(analystReport.report.slice(0, 4000));
    }

    w.heading('9. Response Actions');
    if (history.actionsTaken.length === 0) {
      w.emptyState('No response actions logged against this case.');
    } else {
      w.bulletList(
        history.actionsTaken.map(
          (a) =>
            `${a.title} — ${a.status}${a.executedBy ? ` by ${a.executedBy}` : ''}${a.executedAt ? ` at ${formatDate(a.executedAt)}` : ''}`,
        ),
      );
    }

    w.heading('10. Recommendations');
    if (investigation.recommendations.length === 0) {
      w.emptyState('No historical response data yet for this attack pattern.');
    } else {
      w.bulletList(investigation.recommendations.map((r) => `${r.type} — ${r.reason}`));
    }
    if (history.recommendedFixes.length > 0) {
      w.subheading('Recommended mitigations');
      w.bulletList(history.recommendedFixes);
    }

    w.heading('11. Audit Trail');
    if (auditTrail.length === 0) {
      w.emptyState('No audit log entries recorded against this case.');
    } else {
      w.bulletList(
        auditTrail.map(
          (entry) => `${formatDate(entry.createdAt)} — ${entry.actorEmail}: ${entry.action}`,
        ),
      );
    }

    w.pageNumbers();
    const buffer = await w.finish();

    return { buffer, filename: `MIRQAB_Case_Report_${caseId}.pdf` };
  }
}

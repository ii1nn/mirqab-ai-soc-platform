import { PdfWriter } from './pdf/pdf-writer.util';
import { BRAND, MIRQAB_LOGO_PNG } from './pdf/mirqab-branding';
import { deriveRiskLevel, WeeklyReportData } from './weekly-report-data.service';

const ORG_NAME = process.env.ORG_NAME ?? 'Mirqab Security Operations';

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function niceDate(date: Date): string {
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatDateTime(date: Date): string {
  return date.toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
}

function formatDuration(ms: number): string {
  const hours = Math.floor(ms / 3_600_000);
  const minutes = Math.round((ms % 3_600_000) / 60_000);
  if (hours === 0) return `${minutes}m`;
  return `${hours}h ${minutes}m`;
}

function insufficientData(): string {
  return 'Insufficient data for this reporting period.';
}

const NO_DATA = 'No data available for this reporting period.';

/** Human-readable labels for EventSource — keeps demo/synthetic Simulation
 * Mode traffic explicitly distinguishable from real open-source-dataset
 * evidence in the printed report, never presented identically. */
const INGEST_SOURCE_LABEL: Record<string, string> = {
  OPEN_SOURCE_DATASET: 'Open-Source Dataset (real)',
  SIMULATION: 'Simulation Mode (synthetic)',
  LIVE_AGENT: 'Live Agent',
  MANUAL_TEST: 'Manual / Test',
};

function detectionSourceLabel(detectionRule: string | null, ingestSource: string): string {
  return detectionRule ?? INGEST_SOURCE_LABEL[ingestSource] ?? ingestSource;
}

const MAX_INCIDENT_DETAIL_CARDS = 3;
const MAX_RESPONSE_ACTION_ROWS_PRINTED = 40;
const MAX_AFFECTED_ASSETS_PRINTED = 5;

/**
 * Requirement #34-37 — renders the WeeklyReportData a WeeklyReportDataService
 * computed into the actual PDF document. Kept as a pure function (data in,
 * buffer out) separate from WeeklyReportService's persistence/scheduling
 * concerns, and separate from CaseReportService — a Case report and a
 * Weekly report share the PdfWriter layout primitives but nothing else.
 *
 * Premium redesign: every section below reads only from real
 * WeeklyReportData (including the three additive fields — topIncidents,
 * affectedAssets, departmentSecurity — computed by the same org+period
 * scoped queries as everything else in that service). Nothing here is
 * fabricated; a section with no supporting data renders an explicit empty
 * state instead (see NO_DATA / insufficientData()).
 */
export async function renderWeeklyReportPdf(
  data: WeeklyReportData,
  generatedBy: string,
  preparedBy: string,
): Promise<Buffer> {
  const w = new PdfWriter();
  w.enablePremiumChrome(MIRQAB_LOGO_PNG, 'MIRQAB — Weekly SOC Security Report');
  const { period } = data;
  const es = data.executiveSummary;
  const io = data.incidentOverview;
  // "-" not "→": pdfkit's standard Helvetica font only supports WinAnsi
  // encoding, which has no glyph for U+2192 and silently substitutes the
  // wrong characters instead of throwing (confirmed via live PDF generation
  // + pdftotext extraction, not just a theoretical concern).
  const periodLabel = `${niceDate(period.periodStart)} - ${niceDate(period.periodEnd)}`;

  // === PAGE 1 — EXECUTIVE MANAGEMENT SUMMARY ============================
  w.heroHeader(
    MIRQAB_LOGO_PNG,
    'MIRQAB WEEKLY SOC SECURITY REPORT',
    `${periodLabel}  |  Sunday - Saturday  |  UTC`,
  );

  w.metadataCard([
    { label: 'Organization', value: ORG_NAME },
    { label: 'Report Period', value: `${isoDate(period.periodStart)} to ${isoDate(period.periodEnd)}` },
    { label: 'Prepared By', value: preparedBy },
    { label: 'Generated At', value: formatDateTime(new Date()) },
    { label: 'Generation Source', value: generatedBy },
  ]);

  // --- Security Posture ---------------------------------------------------
  w.sectionBanner('Security Posture');
  const riskLevel = deriveRiskLevel(data.openIncidentsBySeverity);
  const distinctAssets = data.affectedAssets.length;
  const postureSummary =
    es.totalAlerts === 0 && data.topIncidents.length === 0
      ? 'No security events were detected during this reporting period.'
      : `During this reporting period, Mirqab detected ${es.totalAlerts} security event(s) across ${distinctAssets} asset(s). ` +
        `${es.totalIncidents} incident(s) required investigation. ${es.resolvedIncidents} were resolved and ${es.openIncidents} remain open.`;
  w.securityPostureBanner(riskLevel, postureSummary);

  // --- Executive KPI Cards --------------------------------------------------
  w.sectionBanner('Executive Summary');
  w.kpiCardGrid([
    { label: 'Total Alerts', value: String(es.totalAlerts), accent: BRAND.purple },
    { label: 'Critical Alerts', value: String(es.alertsBySeverity.CRITICAL), accent: BRAND.severity.CRITICAL },
    { label: 'High Severity', value: String(es.alertsBySeverity.HIGH), accent: BRAND.severity.HIGH },
    { label: 'Medium Severity', value: String(es.alertsBySeverity.MEDIUM), accent: BRAND.severity.MEDIUM },
    { label: 'Low Severity', value: String(es.alertsBySeverity.LOW), accent: BRAND.severity.LOW },
    { label: 'Total Incidents', value: String(es.totalIncidents), accent: BRAND.purple },
    { label: 'Open Incidents', value: String(es.openIncidents), accent: BRAND.severity.HIGH },
    { label: 'Resolved Incidents', value: String(es.resolvedIncidents), accent: BRAND.severity.LOW },
    { label: 'Tickets Created', value: String(es.ticketsCreated), accent: BRAND.purple },
    { label: 'Tickets Resolved', value: String(es.ticketsResolved), accent: BRAND.severity.LOW },
    { label: 'Affected Assets', value: String(distinctAssets), accent: BRAND.purple },
    { label: 'Response Actions', value: String(data.responseSummary.actions.length), accent: BRAND.purple },
  ]);

  // --- SOC Response Performance ---------------------------------------------
  w.sectionBanner('SOC Response Performance');
  const automatedActions = data.responseSummary.actions.filter((a) => a.automated);
  const successfulActions = data.responseSummary.actions.filter((a) => a.result === 'SUCCESS');
  const failedActions = data.responseSummary.actions.filter((a) => a.result === 'FAILED');
  w.dataTable(
    [
      { header: 'Metric', width: 240 },
      { header: 'Value', width: 260 },
    ],
    [
      ['Average Resolution Time', es.avgResolutionTimeMs !== null ? formatDuration(es.avgResolutionTimeMs) : insufficientData()],
      ['Average Time to Detect', 'Not tracked — Mirqab has no independent "time of compromise" signal distinct from detection time.'],
      ['Average Time to Respond', 'Not tracked — response actions are not currently linked to an incident-open timestamp for elapsed-time calculation.'],
      ['Incidents Resolved', String(es.resolvedIncidents)],
      ['Incidents Open', String(es.openIncidents)],
      ['Automated Response Actions', String(automatedActions.length)],
      ['Successful Response Actions', String(successfulActions.length)],
      ['Failed Response Actions', String(failedActions.length)],
      ['SLA Compliance', 'Not tracked — Mirqab does not currently define or store SLA targets.'],
    ],
  );

  // --- Weekly Security Highlights --------------------------------------------
  w.sectionBanner('Weekly Security Highlights');
  const highlights: string[] = [];
  if (data.topIncidents.length > 0) {
    const top = data.topIncidents[0];
    highlights.push(
      `Highest-severity incident: ${top.caseId} (${top.severity}) — ${top.mitreTechniqueName}.`,
    );
  }
  if (data.departmentSecurity.length > 0) {
    const dept = data.departmentSecurity[0];
    highlights.push(`Most affected department: ${dept.departmentName} (${dept.incidents} incident(s)).`);
  }
  if (data.affectedAssets.length > 0) {
    const asset = data.affectedAssets[0];
    highlights.push(`Most affected asset: ${asset.deviceName} (${asset.incidents} incident(s)).`);
  }
  if (io.byAttackType.length > 0) {
    highlights.push(`Most common attack type: ${io.byAttackType[0].label} (${io.byAttackType[0].count}).`);
  }
  if (data.mitreOverview.length > 0) {
    const t = data.mitreOverview[0];
    highlights.push(`Most observed MITRE technique: ${t.techniqueId} — ${t.techniqueName} (${t.occurrences}).`);
  }
  if (data.responseSummary.actions.length > 0) {
    highlights.push(`${automatedActions.length} automated response action(s) executed this period.`);
  }
  const remainingHighRisk = data.openIncidentsBySeverity.CRITICAL + data.openIncidentsBySeverity.HIGH;
  if (remainingHighRisk > 0) {
    highlights.push(`${remainingHighRisk} high-risk incident(s) remain open.`);
  }
  highlights.length > 0 ? w.bulletList(highlights) : w.emptyState(NO_DATA);

  // === PAGE 2 — INCIDENTS & RESPONSE =====================================
  w.doc.addPage();
  w.sectionBanner('Incident & Response Overview');

  w.subBanner('Top Security Incidents');
  w.dataTable(
    [
      { header: 'Incident ID', width: 90 },
      { header: 'Severity', width: 55 },
      { header: 'Affected Asset', width: 90 },
      { header: 'Department', width: 75 },
      { header: 'Detection Source', width: 90 },
      { header: 'MITRE Technique', width: 90 },
      { header: 'Status', width: 55 },
      { header: 'Resolution Time', width: 65 },
    ],
    data.topIncidents.map((i) => [
      i.caseId,
      i.severity,
      i.deviceName ?? 'Unassigned',
      i.departmentName ?? 'Unassigned',
      detectionSourceLabel(i.detectionRule, i.ingestSource),
      `${i.mitreTechniqueId} — ${i.mitreTechniqueName}`,
      i.status,
      i.resolutionTimeMs !== null ? formatDuration(i.resolutionTimeMs) : '—',
    ]),
    {
      emptyMessage: NO_DATA,
      colorize: (row, colIndex) => (colIndex === 1 ? BRAND.severity[row[1] as keyof typeof BRAND.severity] ?? null : null),
    },
  );

  w.subBanner('Incident Resolution Detail');
  if (data.topIncidents.length === 0) {
    w.emptyState(NO_DATA);
  } else {
    for (const incident of data.topIncidents.slice(0, MAX_INCIDENT_DETAIL_CARDS)) {
      w.incidentDetailCard(incident.caseId, BRAND.severity[incident.severity], [
        { label: 'What Happened', value: incident.description },
        { label: 'How It Was Detected', value: detectionSourceLabel(incident.detectionRule, incident.ingestSource) },
        { label: 'Investigation', value: incident.rootCause ?? '' },
        {
          label: 'Response Taken',
          value: data.responseSummary.actions
            .filter((a) => a.caseId === incident.caseId)
            .map((a) => a.type.replace(/_/g, ' '))
            .join(', '),
        },
        { label: 'How It Was Resolved', value: incident.finalResolution ?? '' },
        { label: 'Final Status', value: incident.status },
        { label: 'Risk', value: incident.severity },
      ]);
    }
    if (data.topIncidents.length > MAX_INCIDENT_DETAIL_CARDS) {
      w.paragraph(
        `(Showing detail for the ${MAX_INCIDENT_DETAIL_CARDS} highest-priority incidents of ${data.topIncidents.length} listed above.)`,
      );
    }
  }

  w.sectionBanner('SOC Response Actions');
  const printedActions = data.responseSummary.actions.slice(0, MAX_RESPONSE_ACTION_ROWS_PRINTED);
  w.dataTable(
    [
      { header: 'Time', width: 75 },
      { header: 'Incident', width: 75 },
      { header: 'Action', width: 90 },
      { header: 'Target', width: 90 },
      { header: 'Response Type', width: 55 },
      { header: 'Result', width: 60 },
    ],
    printedActions.map((a) => [
      formatDateTime(a.timestamp),
      a.caseId,
      a.type.replace(/_/g, ' '),
      a.endpoint ?? 'Unknown endpoint',
      a.automated ? 'Automated' : 'Analyst Action',
      a.result,
    ]),
    { emptyMessage: 'No response actions logged this period.' },
  );
  if (data.responseSummary.actions.length > MAX_RESPONSE_ACTION_ROWS_PRINTED) {
    w.paragraph(
      `(Showing the ${MAX_RESPONSE_ACTION_ROWS_PRINTED} most recent of ${data.responseSummary.actions.length} response actions this period.)`,
    );
  }
  w.paragraph(
    `Automated Responses: ${automatedActions.length}   |   Successful: ${successfulActions.length}   |   Failed: ${failedActions.length}`,
  );

  // === PAGE 3 — THREAT LANDSCAPE ==========================================
  w.doc.addPage();
  w.sectionBanner('Threat Landscape');

  w.subBanner('Attack Types');
  w.dataTable(
    [
      { header: 'Attack Type', width: 260 },
      { header: 'Count', width: 100 },
      { header: 'Percentage', width: 100 },
    ],
    io.byAttackType.map((r) => [
      r.label,
      String(r.count),
      es.totalIncidents > 0 ? `${Math.round((r.count / es.totalIncidents) * 1000) / 10}%` : '0%',
    ]),
    { emptyMessage: insufficientData() },
  );

  w.subBanner('Alerts by Severity');
  w.donutChart(
    [
      { label: 'Critical', value: es.alertsBySeverity.CRITICAL, color: BRAND.severity.CRITICAL },
      { label: 'High', value: es.alertsBySeverity.HIGH, color: BRAND.severity.HIGH },
      { label: 'Medium', value: es.alertsBySeverity.MEDIUM, color: BRAND.severity.MEDIUM },
      { label: 'Low', value: es.alertsBySeverity.LOW, color: BRAND.severity.LOW },
    ],
    'Total Alerts',
  );

  w.sectionBanner('MITRE ATT&CK Overview');
  w.dataTable(
    [
      { header: 'Technique ID', width: 80 },
      { header: 'Technique', width: 180 },
      { header: 'Tactic', width: 120 },
      { header: 'Incidents', width: 80 },
    ],
    data.mitreOverview.map((m) => [m.techniqueId, m.techniqueName, m.tactic, String(m.occurrences)]),
    { emptyMessage: insufficientData() },
  );

  w.sectionBanner('Top 5 Affected Assets');
  w.dataTable(
    [
      { header: 'Asset Name', width: 90 },
      { header: 'Department', width: 85 },
      { header: 'Alerts', width: 55 },
      { header: 'Incidents', width: 60 },
      { header: 'Risk', width: 55 },
      { header: 'Status', width: 95 },
    ],
    data.affectedAssets.slice(0, MAX_AFFECTED_ASSETS_PRINTED).map((a) => [
      a.deviceName,
      a.departmentName,
      String(a.alerts),
      String(a.incidents),
      `${a.riskScore}/100`,
      a.isolated ? `${a.status} (Isolated)` : a.status,
    ]),
    { emptyMessage: NO_DATA },
  );

  w.sectionBanner('Department Security Overview');
  w.dataTable(
    [
      { header: 'Department', width: 130 },
      { header: 'Alerts', width: 80 },
      { header: 'Incidents', width: 80 },
      { header: 'High/Critical', width: 90 },
      { header: 'Risk', width: 90 },
    ],
    data.departmentSecurity.map((d) => [
      d.departmentName,
      String(d.alerts),
      String(d.incidents),
      String(d.highCriticalCount),
      d.riskLabel,
    ]),
    {
      emptyMessage: NO_DATA,
      colorize: (row, colIndex) => (colIndex === 4 ? BRAND.risk[row[4] as keyof typeof BRAND.risk] ?? null : null),
    },
  );

  // === PAGE 4 — MANAGEMENT ATTENTION & RECOMMENDATIONS ====================
  w.doc.addPage();
  w.sectionBanner('Management Attention');
  const attentionItems: string[] = [];
  if (remainingHighRisk > 0) {
    attentionItems.push(`OPEN HIGH-RISK INCIDENTS — ${remainingHighRisk} high-risk incident(s) remain open.`);
  }
  if (data.departmentSecurity.length > 0) {
    const dept = data.departmentSecurity[0];
    attentionItems.push(
      `AFFECTED DEPARTMENT — ${dept.departmentName} has the highest incident concentration this period (${dept.incidents} incident(s)).`,
    );
  }
  const repeatedType = io.byAttackType.find((t) => t.count >= 2);
  if (repeatedType) {
    attentionItems.push(
      `REPEATED THREAT — ${repeatedType.label} appeared repeatedly this period (${repeatedType.count} occurrence(s)).`,
    );
  }
  if (failedActions.length > 0) {
    attentionItems.push(`RESPONSE FAILURE — ${failedActions.length} response action(s) failed this period.`);
  }
  attentionItems.length > 0
    ? w.bulletList(attentionItems)
    : w.emptyState('No items require management attention this period.');

  w.sectionBanner('Recommended Actions');
  const recommendations: string[] = [];
  if (data.affectedAssets.length > 0) {
    const names = data.affectedAssets.slice(0, 3).map((a) => a.deviceName).join(', ');
    recommendations.push(`Review affected endpoint(s): ${names}.`);
  }
  if (es.openIncidents > 0) {
    recommendations.push('Patch or harden systems associated with currently open incidents.');
  }
  const credentialRelated = data.topIncidents.some((i) =>
    /credential|brute force|password|valid accounts/i.test(`${i.mitreTechniqueName} ${i.description}`),
  );
  if (credentialRelated) {
    recommendations.push('Reset potentially compromised credentials and review recent authentication logs.');
    recommendations.push('Investigate repeated authentication failures for the affected account(s).');
  }
  if (repeatedType) {
    recommendations.push(`Review recurring detection patterns for "${repeatedType.label}" and update detection rules accordingly.`);
  }
  if (failedActions.length > 0) {
    recommendations.push('Investigate the cause of failed automated response actions and confirm manual remediation.');
  }
  if (es.totalIncidents > 0 && recommendations.length === 0) {
    recommendations.push('Continue routine monitoring — no elevated risk pattern was detected this period.');
  }
  recommendations.length > 0
    ? w.bulletList(recommendations.slice(0, 6))
    : w.emptyState('No specific recommendations — no significant security activity detected this period.');

  w.sectionBanner('Weekly Security Conclusion');
  const conclusion = [
    `Security Posture: ${riskLevel}.`,
    `Major Activity: ${es.totalIncidents} incident(s) and ${es.totalAlerts} alert(s) were recorded across ${distinctAssets} asset(s) this period.`,
    `Response: ${es.resolvedIncidents} incident(s) resolved, ${es.ticketsResolved} ticket(s) resolved, ${automatedActions.length} automated response action(s) executed.`,
    `Outstanding Risk: ${es.openIncidents} incident(s) remain open${
      data.departmentSecurity.length > 0 ? `, concentrated in ${data.departmentSecurity[0].departmentName}` : ''
    }.`,
    `Recommended Next Step: ${recommendations[0] ?? 'Continue routine monitoring.'}`,
  ].join(' ');
  w.paragraph(conclusion);

  w.premiumFooter(MIRQAB_LOGO_PNG, `Generated on ${formatDateTime(new Date())}`);
  return w.finish();
}

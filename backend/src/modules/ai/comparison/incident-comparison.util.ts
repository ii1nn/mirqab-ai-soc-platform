import { Device, Incident } from '@prisma/client';

export type ComparableIncident = Incident & { device: Device | null };

export interface DimensionResult {
  key: string;
  label: string;
  weight: number;
  /** 0–1: how strongly this dimension matched. 0 when there was no shared signal. */
  matchStrength: number;
  /** Whether both incidents actually had data for this dimension — feeds `confidence`. */
  hasData: boolean;
  detail: string;
}

export interface ComparisonResult {
  score: number;
  confidence: number;
  dimensions: DimensionResult[];
}

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const TIMELINE_HALF_LIFE_DAYS = 14;

function jaccard(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const setA = new Set(a);
  const setB = new Set(b);
  let intersection = 0;
  for (const item of setA) if (setB.has(item)) intersection += 1;
  const union = new Set([...setA, ...setB]).size;
  return union === 0 ? 0 : intersection / union;
}

/**
 * Weighted, explainable similarity between two real incidents — every
 * dimension is either genuinely comparable (both sides have the field
 * populated) or explicitly marked as having no data, which lowers
 * `confidence` rather than being silently treated as "no match". Weights
 * sum to 100; `score` is the incident's overall similarity out of 100.
 */
export function compareIncidents(a: ComparableIncident, b: ComparableIncident): ComparisonResult {
  const dims: DimensionResult[] = [];

  dims.push({
    key: 'mitreTechnique',
    label: 'MITRE ATT&CK technique',
    weight: 18,
    hasData: true,
    matchStrength: a.mitreTechniqueId === b.mitreTechniqueId ? 1 : 0,
    detail:
      a.mitreTechniqueId === b.mitreTechniqueId
        ? `Both classified as ${a.mitreTechniqueId} ${a.mitreTechniqueName}`
        : `Different techniques (${a.mitreTechniqueId} vs ${b.mitreTechniqueId})`,
  });

  dims.push({
    key: 'attackType',
    label: 'Attack type (tactic)',
    weight: 8,
    hasData: true,
    matchStrength: a.mitreTactic === b.mitreTactic ? 1 : 0,
    detail: a.mitreTactic === b.mitreTactic ? `Same tactic: ${a.mitreTactic}` : `Different tactics`,
  });

  const malwareHasData = Boolean(a.malwareFamily && b.malwareFamily);
  dims.push({
    key: 'malwareFamily',
    label: 'Malware family',
    weight: 12,
    hasData: malwareHasData,
    matchStrength: malwareHasData && a.malwareFamily === b.malwareFamily ? 1 : 0,
    detail: malwareHasData
      ? a.malwareFamily === b.malwareFamily
        ? `Both linked to ${a.malwareFamily}`
        : `Different families (${a.malwareFamily} vs ${b.malwareFamily})`
      : 'No malware family identified on one or both incidents',
  });

  const ipCountryHasData = Boolean(
    (a.sourceIp && b.sourceIp) || (a.sourceCountry && b.sourceCountry),
  );
  const ipMatch = Boolean(a.sourceIp && b.sourceIp && a.sourceIp === b.sourceIp);
  const countryMatch = Boolean(
    a.sourceCountry && b.sourceCountry && a.sourceCountry === b.sourceCountry,
  );
  dims.push({
    key: 'sourceIpCountry',
    label: 'Source IP / Country',
    weight: 8,
    hasData: ipCountryHasData,
    matchStrength: ipMatch ? 1 : countryMatch ? 0.6 : 0,
    detail: ipMatch
      ? `Same source IP: ${a.sourceIp}`
      : countryMatch
        ? `Same source country: ${a.sourceCountry}`
        : ipCountryHasData
          ? 'No shared source IP or country'
          : 'No source IP/country data available',
  });

  const destHasData = Boolean(a.destinationAsset && b.destinationAsset);
  const destMatch = destHasData && a.destinationAsset === b.destinationAsset;
  const sameDevice = Boolean(a.deviceId && b.deviceId && a.deviceId === b.deviceId);
  dims.push({
    key: 'destinationAsset',
    label: 'Destination assets',
    weight: 8,
    hasData: destHasData || Boolean(a.deviceId && b.deviceId),
    matchStrength: destMatch || sameDevice ? 1 : 0,
    detail: destMatch
      ? `Same destination asset: ${a.destinationAsset}`
      : sameDevice
        ? 'Same affected device'
        : 'Different destination assets',
  });

  dims.push({
    key: 'department',
    label: 'Department',
    weight: 8,
    hasData: Boolean(a.departmentId && b.departmentId),
    matchStrength: a.departmentId && a.departmentId === b.departmentId ? 1 : 0,
    detail:
      a.departmentId && a.departmentId === b.departmentId
        ? 'Same department'
        : 'Different departments',
  });

  const iocOverlap = jaccard(a.iocs, b.iocs);
  dims.push({
    key: 'iocs',
    label: 'Indicators of Compromise (IOCs)',
    weight: 12,
    hasData: a.iocs.length > 0 && b.iocs.length > 0,
    matchStrength: iocOverlap,
    detail:
      a.iocs.length > 0 && b.iocs.length > 0
        ? iocOverlap > 0
          ? `${Math.round(iocOverlap * 100)}% IOC overlap`
          : 'No shared IOCs'
        : 'No IOC data available for one or both incidents',
  });

  dims.push({
    key: 'severity',
    label: 'Severity',
    weight: 6,
    hasData: true,
    matchStrength: a.severity === b.severity ? 1 : 0,
    detail:
      a.severity === b.severity
        ? `Both ${a.severity}`
        : `Different severities (${a.severity} vs ${b.severity})`,
  });

  const gapDays =
    Math.abs(new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()) / ONE_DAY_MS;
  const timelineStrength = Math.pow(0.5, gapDays / TIMELINE_HALF_LIFE_DAYS);
  dims.push({
    key: 'timeline',
    label: 'Timeline proximity',
    weight: 6,
    hasData: true,
    matchStrength: timelineStrength,
    detail: `${Math.round(gapDays)} day(s) apart`,
  });

  const userHasData = Boolean(a.userAccount && b.userAccount);
  dims.push({
    key: 'userBehavior',
    label: 'User behavior',
    weight: 6,
    hasData: userHasData,
    matchStrength: userHasData && a.userAccount === b.userAccount ? 1 : 0,
    detail: userHasData
      ? a.userAccount === b.userAccount
        ? `Same account: ${a.userAccount}`
        : 'Different accounts involved'
      : 'No user account data available',
  });

  const deviceTypeHasData = Boolean(a.device?.os && b.device?.os);
  dims.push({
    key: 'deviceType',
    label: 'Device type',
    weight: 4,
    hasData: deviceTypeHasData,
    matchStrength: deviceTypeHasData && a.device!.os === b.device!.os ? 1 : 0,
    detail: deviceTypeHasData
      ? a.device!.os === b.device!.os
        ? `Same OS: ${a.device!.os}`
        : 'Different device OS'
      : 'No device data available',
  });

  const ruleHasData = Boolean(a.detectionRule && b.detectionRule);
  dims.push({
    key: 'detectionRule',
    label: 'Detection rule',
    weight: 4,
    hasData: ruleHasData,
    matchStrength: ruleHasData && a.detectionRule === b.detectionRule ? 1 : 0,
    detail: ruleHasData
      ? a.detectionRule === b.detectionRule
        ? `Same rule: ${a.detectionRule}`
        : 'Different detection rules'
      : 'No detection rule data available',
  });

  const score = Math.round(dims.reduce((sum, dim) => sum + dim.weight * dim.matchStrength, 0));
  const comparableWeight = dims.reduce((sum, dim) => sum + (dim.hasData ? dim.weight : 0), 0);
  const confidence = Math.round(comparableWeight);

  return { score, confidence, dimensions: dims };
}

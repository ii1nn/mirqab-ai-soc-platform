import { Injectable } from '@nestjs/common';
import { Incident, Severity } from '@prisma/client';
import { PrismaService } from '../../../database/prisma/prisma.service';

export type BusinessImpact = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export interface RiskPrediction {
  lateralMovementProbability: number | null;
  estimatedSpreadTimeMs: number | null;
  estimatedAffectedDevices: number | null;
  businessImpact: BusinessImpact;
  confidence: number;
  sampleSize: number;
}

const LATERAL_WINDOW_MS = 72 * 60 * 60 * 1000;
const SEVERITY_SCORE: Record<Severity, number> = { LOW: 1, MEDIUM: 2, HIGH: 3, CRITICAL: 4 };

/**
 * Every number here is computed from real incidents already stored for the
 * same department — never a fabricated forecast. With no department history
 * yet, the frequency-based fields come back null (not a guess) and
 * `confidence`/`sampleSize` say plainly how little this is based on.
 */
@Injectable()
export class RiskPredictionService {
  constructor(private readonly prisma: PrismaService) {}

  async predict(incident: Incident): Promise<RiskPrediction> {
    if (!incident.departmentId) {
      return {
        lateralMovementProbability: null,
        estimatedSpreadTimeMs: null,
        estimatedAffectedDevices: null,
        businessImpact: this.businessImpactFor(incident.severity, null, 0),
        confidence: 20,
        sampleSize: 0,
      };
    }

    const [history, deviceCount] = await Promise.all([
      this.prisma.incident.findMany({
        where: { departmentId: incident.departmentId, id: { not: incident.id } },
        orderBy: { createdAt: 'asc' },
        select: { id: true, createdAt: true, deviceId: true },
      }),
      this.prisma.device.count({ where: { departmentId: incident.departmentId } }),
    ]);

    const now = Date.now();
    let eligible = 0;
    let withFollowup = 0;
    const spreadTimes: number[] = [];
    const clusterSizes: number[] = [];

    for (let i = 0; i < history.length; i += 1) {
      const seed = history[i];
      const seedTime = seed.createdAt.getTime();
      if (now - seedTime < LATERAL_WINDOW_MS) continue; // too recent to know yet — not a guess either way
      eligible += 1;

      const followups = history.filter((candidate) => {
        const gap = candidate.createdAt.getTime() - seedTime;
        return gap > 0 && gap <= LATERAL_WINDOW_MS;
      });

      if (followups.length > 0) {
        withFollowup += 1;
        spreadTimes.push(Math.min(...followups.map((f) => f.createdAt.getTime() - seedTime)));
        const devices = new Set(
          [seed.deviceId, ...followups.map((f) => f.deviceId)].filter(Boolean),
        );
        clusterSizes.push(devices.size);
      }
    }

    const lateralMovementProbability =
      eligible > 0 ? Math.round((withFollowup / eligible) * 100) : null;
    const estimatedSpreadTimeMs = spreadTimes.length > 0 ? average(spreadTimes) : null;
    const estimatedAffectedDevices = clusterSizes.length > 0 ? average(clusterSizes) : null;
    const confidence = eligible > 0 ? Math.min(95, 30 + eligible * 10) : 20;

    return {
      lateralMovementProbability,
      estimatedSpreadTimeMs,
      estimatedAffectedDevices,
      businessImpact: this.businessImpactFor(
        incident.severity,
        lateralMovementProbability,
        deviceCount,
      ),
      confidence,
      sampleSize: eligible,
    };
  }

  private businessImpactFor(
    severity: Severity,
    lateralMovementProbability: number | null,
    departmentDeviceCount: number,
  ): BusinessImpact {
    const riskFactor =
      SEVERITY_SCORE[severity] +
      ((lateralMovementProbability ?? 0) / 100) * 2 +
      (departmentDeviceCount > 10 ? 1 : 0);

    if (riskFactor < 2) return 'LOW';
    if (riskFactor < 3.5) return 'MEDIUM';
    if (riskFactor < 5.5) return 'HIGH';
    return 'CRITICAL';
  }
}

function average(values: number[]): number {
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

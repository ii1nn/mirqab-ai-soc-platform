import { Injectable } from '@nestjs/common';
import { MitreMappingService } from '../mitre-attack/mitre-mapping.service';
import { TRAINING_RECORDS } from './training-records.data';
import { TrainingRecord } from './training-record.interface';

export interface TrainingBenchmarkResult {
  recordId: string;
  provenance: 'real' | 'synthetic';
  label: { id: string; name: string };
  predicted: { id: string; name: string } | null;
  correct: boolean;
}

export interface TrainingBenchmarkSummary {
  total: number;
  correct: number;
  accuracy: number;
  results: TrainingBenchmarkResult[];
}

/**
 * Runs every labeled training record (Integration Phase 4) through the
 * real rule-based classifier — the same `MitreMappingService.match()`
 * `AiService` itself falls back to when Claude is unavailable, not a
 * reimplementation. Read-only: never creates Incidents, never writes to the
 * database. This is the "integrate into the existing AI pipeline" step —
 * a genuine accuracy check against real classification code, not a mock.
 */
@Injectable()
export class TrainingBenchmarkService {
  constructor(private readonly mitre: MitreMappingService) {}

  run(): TrainingBenchmarkSummary {
    const results = TRAINING_RECORDS.map((record) => this.evaluate(record));
    const correct = results.filter((r) => r.correct).length;

    return {
      total: results.length,
      correct,
      accuracy: results.length > 0 ? correct / results.length : 0,
      results,
    };
  }

  private evaluate(record: TrainingRecord): TrainingBenchmarkResult {
    const match = this.mitre.match(record.sourceExcerpt);

    return {
      recordId: record.id,
      provenance: record.provenance,
      label: { id: record.label.mitreTechniqueId, name: record.label.mitreTechniqueName },
      predicted: match ? { id: match.technique.id, name: match.technique.name } : null,
      correct: match?.technique.id === record.label.mitreTechniqueId,
    };
  }
}

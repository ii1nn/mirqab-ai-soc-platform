import { MitreMappingService } from '../mitre-attack/mitre-mapping.service';
import { TrainingBenchmarkService } from './training-benchmark.service';
import { TRAINING_RECORDS } from './training-records.data';

describe('TrainingBenchmarkService', () => {
  let service: TrainingBenchmarkService;

  beforeEach(() => {
    service = new TrainingBenchmarkService(new MitreMappingService());
  });

  it('every record labels a technique the rule-based classifier actually knows about', () => {
    const mitre = new MitreMappingService();
    for (const record of TRAINING_RECORDS) {
      expect(mitre.isKnownTechnique(record.label.mitreTechniqueId)).toBe(true);
    }
  });

  it('runs all 6 bundled records and reports one result per record', () => {
    const summary = service.run();
    expect(summary.total).toBe(6);
    expect(summary.results).toHaveLength(6);
  });

  it('correctly classifies all 5 synthetic records (phrased to accurately describe a real technique)', () => {
    const summary = service.run();
    const synthetic = summary.results.filter((r) => r.provenance === 'synthetic');

    expect(synthetic).toHaveLength(5);
    for (const result of synthetic) {
      expect(result.correct).toBe(true);
      expect(result.predicted?.id).toBe(result.label.id);
    }
  });

  /**
   * Documents a real, honest limitation rather than hiding it: the simple
   * substring keyword matcher does not recognize the real EVTX record's
   * accurately-phrased Windows Security 4625 text as T1078 Valid Accounts
   * — none of MitreMappingService's T1078 keywords ('valid account misuse',
   * 'compromised credentials', 'account takeover', 'login from unusual
   * location', 'impossible travel') appear in genuine EDR-style phrasing of
   * this event. See docs/integrations/phase-4-ai-training-records.md.
   */
  it('reports the real EVTX record as an honest classifier miss, not force-matched', () => {
    const summary = service.run();
    const evtxResult = summary.results.find((r) => r.recordId === 'evtx-t1078-4625');

    expect(evtxResult).toBeDefined();
    expect(evtxResult?.label.id).toBe('T1078');
    expect(evtxResult?.predicted).toBeNull();
    expect(evtxResult?.correct).toBe(false);
  });

  it('reports overall accuracy as 5 out of 6 (83%) — 5 synthetic hits, 1 honest real-data miss', () => {
    const summary = service.run();
    expect(summary.correct).toBe(5);
    expect(summary.total).toBe(6);
    expect(summary.accuracy).toBeCloseTo(5 / 6, 5);
  });
});

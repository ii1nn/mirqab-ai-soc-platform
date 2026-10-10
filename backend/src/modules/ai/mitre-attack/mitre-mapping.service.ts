import { Injectable } from '@nestjs/common';
import { MITRE_REFERENCE, MitreReferenceEntry } from './mitre-reference.data';

export interface MitreMatch {
  technique: MitreReferenceEntry;
  matchedKeywords: string[];
  confidence: number;
}

/**
 * A deterministic, keyword-based classifier serving two roles:
 * 1. The rule-based fallback used when Claude is unavailable.
 * 2. A guard against Claude hallucinating a MITRE technique ID — AiService
 *    checks `isKnownTechnique()` on Claude's answer before trusting it.
 */
@Injectable()
export class MitreMappingService {
  match(text: string): MitreMatch | null {
    const lower = text.toLowerCase();
    let best: { entry: MitreReferenceEntry; matches: string[] } | null = null;

    for (const entry of MITRE_REFERENCE) {
      const matches = entry.keywords.filter((keyword) => lower.includes(keyword));
      if (matches.length > 0 && (!best || matches.length > best.matches.length)) {
        best = { entry, matches };
      }
    }

    if (!best) {
      return null;
    }

    return {
      technique: best.entry,
      matchedKeywords: best.matches,
      confidence: Math.min(1, best.matches.length / 2),
    };
  }

  isKnownTechnique(id: string): boolean {
    return MITRE_REFERENCE.some((entry) => entry.id === id);
  }

  getById(id: string): MitreReferenceEntry | undefined {
    return MITRE_REFERENCE.find((entry) => entry.id === id);
  }

  getReferenceList(): readonly MitreReferenceEntry[] {
    return MITRE_REFERENCE;
  }
}

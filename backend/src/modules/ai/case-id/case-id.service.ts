import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../database/prisma/prisma.service';

function todayDateKey(now: Date): string {
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, '0');
  const d = String(now.getUTCDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}

/**
 * Generates human-readable Case IDs ("INC-20260814-0001") backed by an
 * atomic per-day Postgres counter. A single `INSERT ... ON CONFLICT DO
 * UPDATE ... RETURNING` round trip is what makes this safe under concurrent
 * ingestion (a burst of Wazuh events landing at once) — there is no
 * read-then-write window for two callers to race into the same sequence
 * number, unlike a naive "SELECT lastSeq, then UPDATE lastSeq + 1".
 */
@Injectable()
export class CaseIdService {
  constructor(private readonly prisma: PrismaService) {}

  async generateNext(now: Date = new Date()): Promise<string> {
    const dateKey = todayDateKey(now);

    const rows = await this.prisma.$queryRaw<{ lastSeq: number }[]>`
      INSERT INTO "case_counters" ("dateKey", "lastSeq")
      VALUES (${dateKey}, 1)
      ON CONFLICT ("dateKey") DO UPDATE SET "lastSeq" = "case_counters"."lastSeq" + 1
      RETURNING "lastSeq"
    `;

    const seq = rows[0].lastSeq;
    return `INC-${dateKey}-${String(seq).padStart(4, '0')}`;
  }
}

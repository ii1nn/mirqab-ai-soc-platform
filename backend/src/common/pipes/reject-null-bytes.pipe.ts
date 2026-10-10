import { ArgumentMetadata, BadRequestException, Injectable, PipeTransform } from '@nestjs/common';

// Built via fromCharCode rather than a literal escape so the source file
// itself never carries a raw control byte.
const NULL_BYTE = String.fromCharCode(0);

function containsNullByte(value: unknown): boolean {
  if (typeof value === 'string') {
    return value.includes(NULL_BYTE);
  }
  if (Array.isArray(value)) {
    return value.some(containsNullByte);
  }
  if (value !== null && typeof value === 'object') {
    return Object.values(value).some(containsNullByte);
  }
  return false;
}

/**
 * Phase 5 finding: a literal null byte in any string field reaches Postgres
 * via Prisma uncaught, and Postgres rejects it at the protocol level
 * (`invalid byte sequence for encoding "UTF8": 0x00`) — this surfaced as an
 * unhandled 500 for every string field tested (ticket assignee, incident
 * resolution notes), not just one. No client-facing internals were ever
 * exposed (HttpExceptionFilter already returns a generic message for 500s),
 * but a clean, deliberate input should get a clean 400, not an uncaught
 * exception. Runs before the global ValidationPipe (registration order in
 * main.ts) so this is the single, central place every string field in every
 * DTO is covered, rather than patching each one individually.
 */
@Injectable()
export class RejectNullBytesPipe implements PipeTransform {
  transform(value: unknown, metadata: ArgumentMetadata): unknown {
    if ((metadata.type === 'body' || metadata.type === 'query') && containsNullByte(value)) {
      throw new BadRequestException('Request contains a null byte, which is not permitted.');
    }
    return value;
  }
}

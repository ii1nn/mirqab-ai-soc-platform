import type { ReactNode } from 'react';

/**
 * Isolates a technical, always-left-to-right value — Case/Incident IDs,
 * hostnames, IPs, UUIDs, MITRE IDs, hashes, action names, timestamps,
 * countdowns, English technical text — inside right-to-left (Arabic) prose,
 * so the bidi algorithm can never reorder its characters or pull adjacent
 * punctuation across it. Renders inline; harmless in LTR.
 */
export function LtrText({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <bdi dir="ltr" className={className}>
      {children}
    </bdi>
  );
}

import { isWevtutilAvailable, parseEvtxFile, parseWevtutilText } from './evtx-parser.util';
import { datasetPath } from '../dataset-path.util';

// A real capture of `wevtutil qe datasets/EVTX-to-MITRE-Attack/T1078-ID4625-failed-login.evtx
// /lf:true /f:text` output on this project's actual bundled .evtx file — not invented text.
const REAL_WEVTUTIL_OUTPUT = `Event[0]
  Log Name: Security
  Source: Microsoft-Windows-Security-Auditing
  Date: 2021-10-24T00:50:11.6660000Z
  Event ID: 4625
  Task: Logon
  Level: Information
  Opcode: Info
  Keyword: Audit Failure,
  User: N/A
  User Name: N/A
  Computer: FS03.offsec.lan
  Description:
An account failed to log on.

Subject:
	Security ID:		S-1-5-18
	Account Name:		FS03$
	Account Domain:		OFFSEC
	Logon ID:		0x3E7

Logon Type:			10

Account For Which Logon Failed:
	Security ID:		S-1-0-0
	Account Name:		-
	Account Domain:		-

Failure Information:
	Failure Reason:		Unknown user name or bad password.
	Status:			0xC000006E
	Sub Status:		0x0

Network Information:
	Workstation Name:	-
	Source Network Address:	10.23.23.9
	Source Port:		0

This event is generated when a logon request fails. It is generated on the computer where access was attempted.

Event[1]
  Log Name: Security
  Source: Microsoft-Windows-Security-Auditing
  Date: 2021-10-24T00:51:57.2120000Z
  Event ID: 4625
  Task: Logon
  Level: Information
  Opcode: Info
  Keyword: Audit Failure,
  User: N/A
  User Name: N/A
  Computer: FS03.offsec.lan
  Description:
An account failed to log on.

Logon Type:			10

Network Information:
	Source Network Address:	10.23.23.9

This event is generated when a logon request fails.
`;

describe('parseWevtutilText', () => {
  it('splits real wevtutil output into one event per Event[N] block', () => {
    const events = parseWevtutilText(REAL_WEVTUTIL_OUTPUT);
    expect(events).toHaveLength(2);
  });

  it('extracts the real, structured fields from each event without fabricating any', () => {
    const [first] = parseWevtutilText(REAL_WEVTUTIL_OUTPUT);
    expect(first.eventId).toBe('4625');
    expect(first.date).toBe('2021-10-24T00:50:11.6660000Z');
    expect(first.computer).toBe('FS03.offsec.lan');
    expect(first.logName).toBe('Security');
  });

  it('keeps the real per-event narrative but trims Microsoft\'s generic boilerplate paragraph', () => {
    const [first] = parseWevtutilText(REAL_WEVTUTIL_OUTPUT);
    expect(first.description).toContain('Unknown user name or bad password');
    expect(first.description).toContain('10.23.23.9');
    expect(first.description).not.toContain('This event is generated');
  });

  it('preserves the complete original per-event block verbatim as raw evidence', () => {
    const [first] = parseWevtutilText(REAL_WEVTUTIL_OUTPUT);
    expect(first.raw).toContain('Event[0]');
    expect(first.raw).toContain('0xC000006E');
  });

  it('returns [] for empty output rather than fabricating an event', () => {
    expect(parseWevtutilText('')).toEqual([]);
  });
});

// Only runs where wevtutil actually exists (Windows hosts, e.g. this dev
// environment) — a real end-to-end decode of the real bundled .evtx file,
// not a fixture. Skipped (not failed) elsewhere, matching this codebase's
// existing pattern for environment-gated integration checks (Wazuh Logtest,
// the Sysmon/Python forwarder scripts — see docs/phases/phase-13.md).
const describeIfWindows = isWevtutilAvailable() ? describe : describe.skip;

describeIfWindows('parseEvtxFile (live, against the real dataset file)', () => {
  it('decodes the real datasets/EVTX-to-MITRE-Attack .evtx file end-to-end', async () => {
    const events = await parseEvtxFile(
      datasetPath('EVTX-to-MITRE-Attack', 'T1078-ID4625-failed-login.evtx'),
    );

    expect(events.length).toBeGreaterThan(0);
    for (const event of events) {
      expect(event.eventId).toBe('4625');
      expect(event.computer.length).toBeGreaterThan(0);
      expect(event.description).toContain('Unknown user name or bad password');
    }
  });
});

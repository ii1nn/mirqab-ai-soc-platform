# Wazuh → Mirqab

`mirqab-integration.py` is a Wazuh custom integration script: the Wazuh
manager invokes it per-alert and it forwards the alert to Mirqab's
`POST /monitoring/wazuh` (see `backend/src/modules/monitoring`).

## Install

1. Copy `mirqab-integration.py` to `/var/ossec/integrations/custom-mirqab`
   on the Wazuh manager, and symlink `custom-mirqab.py` to it (Wazuh's
   integrator daemon requires that exact naming convention).
   ```bash
   cp mirqab-integration.py /var/ossec/integrations/custom-mirqab
   ln -s /var/ossec/integrations/custom-mirqab /var/ossec/integrations/custom-mirqab.py
   chmod 750 /var/ossec/integrations/custom-mirqab
   chown root:wazuh /var/ossec/integrations/custom-mirqab
   ```
2. Add the block in `ossec-integration-snippet.xml` to
   `/var/ossec/etc/ossec.conf`, replacing the API key with the backend's
   `MONITORING_INGEST_API_KEY`.
3. Restart the manager: `systemctl restart wazuh-manager`.

Verify against your installed Wazuh version's own custom-integration docs —
the argv ordering Wazuh passes to integration scripts has shifted across
major versions.

## Mirqab → Wazuh (isolation)

The above is one-directional: Wazuh → Mirqab alerts only. `active-response/`
in this folder is the other direction — it's what lets MIRQAB's Isolate
button actually cut a device's network access via a real Wazuh Active
Response command, through `backend/src/modules/devices/endpoint-control/
wazuh-active-response.provider.ts`. See `active-response/isolate-host.ps1`
(Windows), `active-response/isolate-host.sh` (Linux), and
`active-response/ossec-active-response-snippet.xml` for the manager-side
registration. This requires a real Wazuh Manager and a real agent on the
device you want isolatable — it does not work against devices known to
Mirqab only through imported/open-source log evidence, since there is no
real, network-reachable endpoint behind those to isolate.

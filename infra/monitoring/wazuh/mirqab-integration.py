#!/usr/bin/env python3
"""
Wazuh custom integration script — forwards each alert to Mirqab's
POST /monitoring/wazuh ingestion endpoint (see backend/src/modules/monitoring).

Install as /var/ossec/integrations/custom-mirqab (and a matching
custom-mirqab.py symlink), then wire it up via the <integration> block in
ossec.conf — see ossec-integration-snippet.xml in this folder. Wazuh invokes
this script per-alert with:
  argv[1] = path to a temp file containing the alert JSON
  argv[2] = the <hook_url> configured in ossec.conf
  argv[3] = the <api_key> configured in ossec.conf

Reference implementation — verify argv ordering against your Wazuh version's
own integration docs before relying on this in production.
"""
import json
import sys
import urllib.request


def main(args: list[str]) -> int:
    alert_file_path = args[1]
    hook_url = args[2]
    api_key = args[3]

    with open(alert_file_path) as f:
        alert = json.load(f)

    # Wazuh's native alert JSON already has this shape — see
    # backend/src/modules/monitoring/dto/wazuh-alert.dto.ts for the fields we validate.
    payload = {
        "rule": {
            "id": str(alert["rule"]["id"]),
            "level": alert["rule"]["level"],
            "description": alert["rule"]["description"],
        },
        "agent": {
            "name": alert.get("agent", {}).get("name", "unknown"),
            "id": alert.get("agent", {}).get("id"),
        },
        "full_log": alert.get("full_log", ""),
        "location": alert.get("location"),
    }

    request = urllib.request.Request(
        hook_url,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json", "X-Api-Key": api_key},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=10) as response:
        response.read()

    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))

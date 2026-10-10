# Suricata → Mirqab

`eve-forwarder.js` tails Suricata's `eve.json` and forwards `alert`-type
events to Mirqab's `POST /monitoring/suricata` (see
`backend/src/modules/monitoring`).

## Run

```bash
EVE_JSON_PATH=/var/log/suricata/eve.json \
MIRQAB_INGEST_URL=http://backend:3000/api/v1/monitoring/suricata \
MONITORING_INGEST_API_KEY=<backend's MONITORING_INGEST_API_KEY> \
SENSOR_HOSTNAME=<hostname registered as a Device in Mirqab> \
node eve-forwarder.js
```

Run this as a systemd service alongside Suricata on each sensor. It's a
minimal `fs.watch`-based tail with no persisted read-offset across restarts —
fine for a reference/demo deployment, but swap it for a real log shipper
(Filebeat, Vector) with its own checkpoint file for production use.

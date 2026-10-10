#!/usr/bin/env node
/**
 * Tails Suricata's eve.json and forwards "alert" events to Mirqab's
 * POST /monitoring/suricata ingestion endpoint (see
 * backend/src/modules/monitoring/dto/suricata-alert.dto.ts).
 *
 * Suricata's native eve.json has no field naming which monitored host it
 * ran on — that's this script's job via SENSOR_HOSTNAME, matched against
 * Device.hostname in Mirqab's inventory (see DevicesService.findByHostname).
 *
 * Run with: EVE_JSON_PATH=/var/log/suricata/eve.json \
 *           MIRQAB_INGEST_URL=http://backend:3000/api/v1/monitoring/suricata \
 *           MONITORING_INGEST_API_KEY=... \
 *           SENSOR_HOSTNAME=ENG-SRV-01 \
 *           node eve-forwarder.js
 *
 * Standalone reference script (no package.json/dependencies) — uses only
 * Node's built-in fs/https so it can run on a sensor host with nothing else installed.
 */
const fs = require('node:fs');
const https = require('node:https');
const http = require('node:http');
const readline = require('node:readline');

const EVE_JSON_PATH = process.env.EVE_JSON_PATH ?? '/var/log/suricata/eve.json';
const MIRQAB_INGEST_URL = process.env.MIRQAB_INGEST_URL;
const API_KEY = process.env.MONITORING_INGEST_API_KEY;
const SENSOR_HOSTNAME = process.env.SENSOR_HOSTNAME;

if (!MIRQAB_INGEST_URL || !API_KEY || !SENSOR_HOSTNAME) {
  console.error('MIRQAB_INGEST_URL, MONITORING_INGEST_API_KEY, and SENSOR_HOSTNAME are all required.');
  process.exit(1);
}

function forward(alertEvent) {
  const payload = JSON.stringify({
    host: SENSOR_HOSTNAME,
    event_type: 'alert',
    src_ip: alertEvent.src_ip,
    dest_ip: alertEvent.dest_ip,
    proto: alertEvent.proto,
    alert: {
      signature: alertEvent.alert.signature,
      category: alertEvent.alert.category,
      severity: alertEvent.alert.severity,
    },
  });

  const url = new URL(MIRQAB_INGEST_URL);
  const client = url.protocol === 'https:' ? https : http;
  const request = client.request(
    url,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
        'X-Api-Key': API_KEY,
      },
    },
    (response) => response.resume(),
  );
  request.on('error', (error) => console.error('Forward failed:', error.message));
  request.write(payload);
  request.end();
}

// A basic "tail -f": read from the current end of file, poll for growth.
// Production use should swap this for a proper log-shipper (Filebeat/Vector)
// with its own state/checkpoint file — this script is a minimal reference.
let position = fs.statSync(EVE_JSON_PATH).size;

fs.watch(EVE_JSON_PATH, { persistent: true }, (eventType) => {
  if (eventType !== 'change') return;

  const stream = fs.createReadStream(EVE_JSON_PATH, { start: position });
  const rl = readline.createInterface({ input: stream });

  rl.on('line', (line) => {
    if (!line.trim()) return;
    try {
      const event = JSON.parse(line);
      if (event.event_type === 'alert') {
        forward(event);
      }
    } catch (error) {
      console.error('Skipping unparseable eve.json line:', error.message);
    }
  });

  rl.on('close', () => {
    position = fs.statSync(EVE_JSON_PATH).size;
  });
});

console.log(`Watching ${EVE_JSON_PATH} for Suricata alerts...`);

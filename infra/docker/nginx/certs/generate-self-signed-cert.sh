#!/bin/sh
# Generates a self-signed cert for local/dev use, valid 825 days, into this
# folder as fullchain.pem/privkey.pem — the paths infra/docker/nginx/nginx.conf
# already points ssl_certificate/ssl_certificate_key at.
#
# NOT for a real deployment — browsers will show a certificate warning for a
# self-signed cert, and there's no CA revocation/renewal story here. For a
# real (non-localhost) host, replace fullchain.pem/privkey.pem with a
# certificate from a real CA (e.g. certbot's Let's Encrypt HTTP-01 challenge,
# which needs nginx.conf's port-80 server block reachable over plain HTTP —
# see the comment there) and keep this generated pair only for local dev.
set -e
cd "$(dirname "$0")"

COMMON_NAME="${1:-localhost}"

openssl req -x509 -nodes -newkey rsa:2048 -days 825 \
  -keyout privkey.pem \
  -out fullchain.pem \
  -subj "/CN=${COMMON_NAME}"

echo "Generated fullchain.pem / privkey.pem for CN=${COMMON_NAME}"

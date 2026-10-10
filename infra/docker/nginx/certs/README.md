# infra/docker/nginx/certs

Empty until you run `generate-self-signed-cert.sh` (or drop in a real cert).
`nginx.conf` expects `fullchain.pem` + `privkey.pem` here — nginx won't start
without them.

```bash
chmod +x generate-self-signed-cert.sh   # first time only, git doesn't track the executable bit here
./generate-self-signed-cert.sh          # or: ./generate-self-signed-cert.sh your-domain.example
```

Generated `.pem` files are gitignored (see `.gitignore` in this folder) —
never commit a private key, self-signed or otherwise. For a real
(non-localhost) deployment, replace both files with a certificate from a
real CA instead of the self-signed one.

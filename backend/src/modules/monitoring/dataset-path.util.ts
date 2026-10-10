import { existsSync } from 'fs';
import { resolve } from 'path';

/**
 * Locates the repo's top-level `datasets/` directory at runtime — the real
 * open-source sample files, not a copy. Tried in order: an explicit
 * `DATASETS_DIR` override, `<cwd>/datasets` (matches the Docker image, where
 * WORKDIR is `/app` and `datasets/` is bind-mounted at `/app/datasets` — see
 * infra/docker/docker-compose.yml), then `<cwd>/../datasets` (matches local
 * `npm run start:dev` run from inside `backend/`, one level below the repo
 * root). Throws rather than silently falling back to nothing — callers
 * (the *-samples seed services) surface that as a clear "couldn't read the
 * dataset" failure, never as an empty/fabricated result.
 */
export function resolveDatasetsDir(): string {
  const override = process.env.DATASETS_DIR;
  if (override) {
    if (!existsSync(override)) {
      throw new Error(`DATASETS_DIR is set to "${override}" but that path does not exist`);
    }
    return override;
  }

  const candidates = [resolve(process.cwd(), 'datasets'), resolve(process.cwd(), '..', 'datasets')];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }

  throw new Error(
    `Could not locate the datasets/ directory. Tried: ${candidates.join(', ')}. Set DATASETS_DIR to override.`,
  );
}

export function datasetPath(...segments: string[]): string {
  return resolve(resolveDatasetsDir(), ...segments);
}

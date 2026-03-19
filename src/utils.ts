import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export type JsonRecord = Record<string, unknown>;

export const isRecord = (value: unknown): value is JsonRecord =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export const parsePositiveInt = (value: string | undefined): number | undefined => {
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
  return parsed;
};

export const parseCsv = (value: string | undefined): string[] | undefined => {
  if (!value) return undefined;
  const items = value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  return items.length > 0 ? items : undefined;
};

export const coerceEnv = (value: unknown): Record<string, string | undefined> => {
  if (!isRecord(value)) return {};
  const out: Record<string, string> = {};
  for (const [key, maybeValue] of Object.entries(value)) {
    if (typeof maybeValue === 'string') out[key] = maybeValue;
  }
  return out;
};

export const expandHomePath = (value: string): string => {
  const trimmed = value.trim();
  if (trimmed === '~') {
    return os.homedir();
  }

  if (trimmed.startsWith('~/')) {
    return path.join(os.homedir(), trimmed.slice(2));
  }

  return trimmed;
};

export const resolveExistingDirectory = async (directoryPath: string): Promise<string | undefined> => {
  try {
    const expanded = expandHomePath(directoryPath);
    const absolute = path.resolve(expanded);
    const real = await fs.realpath(absolute);
    const stats = await fs.stat(real);
    if (!stats.isDirectory()) return undefined;
    return real;
  } catch {
    return undefined;
  }
};

export const isPathInsideDirectory = (targetPath: string, directoryPath: string): boolean => {
  const relative = path.relative(directoryPath, targetPath);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
};

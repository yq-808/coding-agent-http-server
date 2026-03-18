import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { JsonRecord } from './utils.js';

export type SessionStatus = 'queued' | 'running' | 'completed' | 'failed';

export type SessionResult = {
  messages: unknown[];
  stderr: string[];
};

export type SessionState = {
  sessionId: string;
  provider: string;
  prompt: string;
  options: JsonRecord;
  status: SessionStatus;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  finishedAt?: string;
  error?: string;
  result?: SessionResult;
};

export type CreateSessionInput = {
  provider: string;
  prompt: string;
  options: JsonRecord;
};

const DEFAULT_SESSION_ROOT = path.join(os.homedir(), '.coding-agent-http-server');
const SESSION_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const sessionRootDir = process.env.SESSION_STATE_DIR?.trim() || DEFAULT_SESSION_ROOT;
const sessionsDir = path.join(sessionRootDir, 'sessions');

const ensureValidSessionId = (sessionId: string) => {
  if (!SESSION_ID_PATTERN.test(sessionId)) {
    throw new Error('Invalid session id format.');
  }
};

const getSessionFilePath = (sessionId: string): string => {
  ensureValidSessionId(sessionId);
  return path.join(sessionsDir, `${sessionId}.json`);
};

const writeFileAtomic = async (filePath: string, content: string) => {
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tempPath, content, 'utf8');
  await fs.rename(tempPath, filePath);
};

const saveSession = async (state: SessionState) => {
  const filePath = getSessionFilePath(state.sessionId);
  await writeFileAtomic(filePath, `${JSON.stringify(state, null, 2)}\n`);
};

const mutateSession = async (
  sessionId: string,
  mutator: (state: SessionState) => SessionState,
): Promise<SessionState> => {
  const current = await loadSession(sessionId);
  if (!current) {
    throw new Error(`Session not found: ${sessionId}`);
  }

  const next = mutator(current);
  next.updatedAt = new Date().toISOString();
  await saveSession(next);
  return next;
};

export const ensureSessionStorage = async () => {
  await fs.mkdir(sessionsDir, { recursive: true });
};

export const getSessionStorageDir = (): string => sessionRootDir;

export const createQueuedSession = async (input: CreateSessionInput): Promise<SessionState> => {
  const now = new Date().toISOString();
  const state: SessionState = {
    sessionId: randomUUID(),
    provider: input.provider,
    prompt: input.prompt,
    options: input.options,
    status: 'queued',
    createdAt: now,
    updatedAt: now,
  };

  await saveSession(state);
  return state;
};

export const loadSession = async (sessionId: string): Promise<SessionState | null> => {
  const filePath = getSessionFilePath(sessionId);

  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw) as SessionState;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }

    throw error;
  }
};

export const markSessionRunning = async (sessionId: string): Promise<SessionState> => {
  return mutateSession(sessionId, (state) => ({
    ...state,
    status: 'running',
    startedAt: new Date().toISOString(),
    error: undefined,
  }));
};

export const markSessionCompleted = async (
  sessionId: string,
  result: SessionResult,
): Promise<SessionState> => {
  return mutateSession(sessionId, (state) => ({
    ...state,
    status: 'completed',
    finishedAt: new Date().toISOString(),
    result,
    error: undefined,
  }));
};

export const markSessionFailed = async (
  sessionId: string,
  errorMessage: string,
): Promise<SessionState> => {
  return mutateSession(sessionId, (state) => ({
    ...state,
    status: 'failed',
    finishedAt: new Date().toISOString(),
    error: errorMessage,
  }));
};

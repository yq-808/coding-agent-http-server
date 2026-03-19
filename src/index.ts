import 'dotenv/config';
import os from 'node:os';
import express, { type Request, type Response } from 'express';
import { getProvider, listProviders } from './providers/index.js';
import {
  appendSessionLog,
  createQueuedSession,
  ensureSessionStorage,
  getSessionStorageDir,
  loadSession,
  markSessionCompleted,
  markSessionFailed,
  markSessionRunning,
  readSessionLogs,
} from './sessionStore.js';
import {
  isRecord,
  parsePositiveInt,
  resolveExistingDirectory,
  type JsonRecord,
} from './utils.js';

type QueryRequestBody = {
  provider?: unknown;
  prompt?: unknown;
  options?: unknown;
};

const log = (...parts: Array<string | number>) => {
  console.log(`[${new Date().toISOString()}]`, ...parts);
};

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: process.env.REQUEST_JSON_LIMIT ?? '2mb' }));

const port = parsePositiveInt(process.env.PORT) ?? 8787;
const host = process.env.HOST?.trim() || '127.0.0.1';
const httpAuthToken = process.env.HTTP_AUTH_TOKEN?.trim();
const defaultProviderId = process.env.AGENT_PROVIDER?.trim().toLowerCase() || 'claude';
const fallbackReadOnlyCwd = os.homedir();

const requireAuth = (req: Request, res: Response): boolean => {
  if (!httpAuthToken) return true;

  const authHeader = req.header('authorization') ?? '';
  const prefix = 'Bearer ';
  const bearer = authHeader.startsWith(prefix)
    ? authHeader.slice(prefix.length).trim()
    : undefined;

  if (bearer && bearer === httpAuthToken) return true;

  res.status(401).json({
    error: 'Unauthorized. Set Authorization: Bearer <token> to call this server.',
  });
  return false;
};

const applyWorkspacePolicy = (
  rawOptions: JsonRecord,
  workspaceCwd: string,
  writableRoots: string[],
): JsonRecord => {
  const options: JsonRecord = { ...rawOptions, cwd: workspaceCwd };
  const sandbox = isRecord(options.sandbox) ? { ...options.sandbox } : {};
  const filesystem = isRecord(sandbox.filesystem) ? { ...sandbox.filesystem } : {};
  filesystem.allowWrite = writableRoots;

  sandbox.enabled = true;
  sandbox.allowUnsandboxedCommands = false;
  if (!('autoAllowBashIfSandboxed' in sandbox)) {
    sandbox.autoAllowBashIfSandboxed = true;
  }
  sandbox.filesystem = filesystem;

  options.sandbox = sandbox;
  return options;
};

const normalizeQueryOptions = async (
  rawOptions: JsonRecord,
): Promise<{ options: JsonRecord; error?: string }> => {
  const options: JsonRecord = { ...rawOptions };
  const cwdValue = options.cwd;

  if (cwdValue === undefined) {
    const normalizedHome = await resolveExistingDirectory(fallbackReadOnlyCwd);
    if (!normalizedHome) {
      return {
        options,
        error: `Default HOME directory is not available: ${fallbackReadOnlyCwd}`,
      };
    }

    return {
      options: applyWorkspacePolicy(options, normalizedHome, []),
    };
  }

  if (typeof cwdValue !== 'string' || !cwdValue.trim()) {
    return { options, error: '`options.cwd` must be a non-empty string when provided.' };
  }

  const normalizedCwd = await resolveExistingDirectory(cwdValue);
  if (!normalizedCwd) {
    return { options, error: '`options.cwd` does not exist or is not a directory.' };
  }

  return { options: applyWorkspacePolicy(options, normalizedCwd, [normalizedCwd]) };
};

const stringifyRecordValue = (value: unknown): string => {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '';
};

const truncate = (text: string, maxLen: number): string => {
  if (text.length <= maxLen) return text;
  return `${text.slice(0, maxLen)}...`;
};

const compactCommand = (command: string): string => {
  return truncate(command.replace(/\s+/g, ' ').trim(), 120);
};

const formatToolCallSummary = (name: string, input: JsonRecord): string => {
  const parts: string[] = [`[tool/${name}]`];

  const description = stringifyRecordValue(input.description);
  if (description) parts.push(truncate(description, 120));

  const command = stringifyRecordValue(input.command);
  if (command) parts.push(`$ ${compactCommand(command)}`);

  const filePath = stringifyRecordValue(input.file_path) || stringifyRecordValue(input.path);
  if (filePath) parts.push(truncate(filePath, 120));

  const pattern = stringifyRecordValue(input.pattern);
  if (pattern) parts.push(`pattern=${truncate(pattern, 80)}`);

  const query = stringifyRecordValue(input.query);
  if (query) parts.push(`query=${truncate(query, 80)}`);

  const url = stringifyRecordValue(input.url);
  if (url) parts.push(truncate(url, 120));

  return parts.join(' ');
};

const formatProgressLines = (message: unknown): string[] => {
  if (!isRecord(message)) return [];
  const messageType = stringifyRecordValue(message.type);

  if (messageType === 'system' && stringifyRecordValue(message.subtype) === 'init') {
    const model = stringifyRecordValue(message.model);
    const cwd = stringifyRecordValue(message.cwd);
    const session = stringifyRecordValue(message.session_id);
    return [`[system/init] model=${model || '-'} cwd=${cwd || '-'} session=${session || '-'}`];
  }

  if (messageType === 'assistant') {
    const assistantMessage = isRecord(message.message) ? message.message : undefined;
    const content = Array.isArray(assistantMessage?.content) ? assistantMessage.content : [];
    const lines: string[] = [];

    for (const block of content) {
      if (!isRecord(block)) continue;
      const blockType = stringifyRecordValue(block.type);

      if (blockType === 'tool_use') {
        const toolName = stringifyRecordValue(block.name) || 'unknown';
        const toolInput = isRecord(block.input) ? block.input : {};
        lines.push(formatToolCallSummary(toolName, toolInput));
        continue;
      }

      if (blockType === 'text') {
        const text = stringifyRecordValue(block.text);
        if (text) {
          lines.push(`[assistant] ${truncate(text.replace(/\s+/g, ' ').trim(), 240)}`);
        }
      }
    }

    return lines;
  }

  if (messageType === 'result') {
    const subtype = stringifyRecordValue(message.subtype) || 'unknown';
    const isError = message.is_error === true;
    const turns = typeof message.num_turns === 'number' ? String(message.num_turns) : '-';
    const durationMs = typeof message.duration_ms === 'number' ? String(message.duration_ms) : '-';
    const resultText =
      typeof message.result === 'string'
        ? ` result=${truncate(message.result.replace(/\s+/g, ' ').trim(), 160)}`
        : '';

    return [
      `[result/${subtype}] isError=${isError} turns=${turns} durationMs=${durationMs}${resultText}`,
    ];
  }

  return [];
};

const processSession = async (
  sessionId: string,
  providerId: string,
  prompt: string,
  options: JsonRecord,
): Promise<void> => {
  let logWriteQueue: Promise<void> = Promise.resolve();
  const enqueueSessionLog = (line: string) => {
    logWriteQueue = logWriteQueue
      .then(() => appendSessionLog(sessionId, line))
      .catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        log(`[session:${sessionId}] failed to append progress log err=${message}`);
      });
  };

  const provider = getProvider(providerId);
  if (!provider) {
    await markSessionFailed(sessionId, `Unsupported provider: ${providerId}`);
    enqueueSessionLog(`[failed] unsupported provider=${providerId}`);
    await logWriteQueue;
    log(`[session:${sessionId}] failed unsupported provider=${providerId}`);
    return;
  }

  const startedAt = Date.now();

  try {
    await markSessionRunning(sessionId);
    enqueueSessionLog(`[running] provider=${provider.id} promptChars=${prompt.length}`);
    log(`[session:${sessionId}] running provider=${provider.id} promptChars=${prompt.length}`);

    const abortController = new AbortController();
    const stderrEvents: string[] = [];
    const messages: unknown[] = [];

    const stream = provider.run({
      prompt,
      options,
      abortController,
      onStderr: (data) => {
        stderrEvents.push(data);
        for (const line of data.split(/\r?\n/)) {
          const text = line.trim();
          if (!text) continue;
          enqueueSessionLog(`[stderr] ${truncate(text, 240)}`);
        }
      },
    });

    for await (const message of stream) {
      messages.push(message);
      for (const line of formatProgressLines(message)) {
        enqueueSessionLog(line);
      }
    }

    await markSessionCompleted(sessionId, { messages, stderr: stderrEvents });
    enqueueSessionLog(
      `[completed] provider=${provider.id} messages=${messages.length} durationMs=${Date.now() - startedAt}`,
    );
    await logWriteQueue;
    log(
      `[session:${sessionId}] completed provider=${provider.id} messages=${messages.length} durationMs=${Date.now() - startedAt}`,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    try {
      await markSessionFailed(sessionId, message);
    } catch (markError) {
      const markMessage = markError instanceof Error ? markError.message : String(markError);
      log(`[session:${sessionId}] failed to persist failure state err=${markMessage}`);
    }

    enqueueSessionLog(`[failed] provider=${providerId} err=${truncate(message, 240)}`);
    await logWriteQueue;
    log(`[session:${sessionId}] failed provider=${providerId} err=${message}`);
  }
};

app.get('/healthz', (_req, res) => {
  res.json({
    ok: true,
    service: 'coding-agent-http-server',
    defaultProvider: defaultProviderId,
    availableProviders: listProviders(),
    workspacePolicy: {
      cwdRequired: false,
      defaultCwd: fallbackReadOnlyCwd,
      defaultWriteScope: 'read-only',
      writeScopeWhenCwdProvided: 'cwd-only',
      readOutsideCwd: true,
      sandboxEnabled: true,
    },
    sessionStorageDir: getSessionStorageDir(),
  });
});

app.post('/v1/query', async (req: Request, res: Response) => {
  if (!requireAuth(req, res)) return;

  const body = (req.body ?? {}) as QueryRequestBody;
  if (typeof body.prompt !== 'string' || !body.prompt.trim()) {
    res.status(400).json({ error: '`prompt` (non-empty string) is required.' });
    return;
  }

  if (body.options !== undefined && !isRecord(body.options)) {
    res.status(400).json({ error: '`options` must be a JSON object if provided.' });
    return;
  }

  const providerId =
    typeof body.provider === 'string' && body.provider.trim()
      ? body.provider.trim().toLowerCase()
      : defaultProviderId;

  const provider = getProvider(providerId);
  if (!provider) {
    res.status(400).json({
      error: `Unsupported provider: ${providerId}`,
      availableProviders: listProviders(),
    });
    return;
  }

  const rawOptions = (body.options ?? {}) as JsonRecord;
  const normalizedOptions = await normalizeQueryOptions(rawOptions);
  if (normalizedOptions.error) {
    res.status(400).json({ error: normalizedOptions.error });
    return;
  }

  const options = normalizedOptions.options;
  const session = await createQueuedSession({
    provider: provider.id,
    prompt: body.prompt,
    options,
  });

  log(
    `[session:${session.sessionId}] queued provider=${provider.id} promptChars=${body.prompt.length}`,
  );
  void appendSessionLog(
    session.sessionId,
    `[queued] provider=${provider.id} promptChars=${body.prompt.length}`,
  ).catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    log(`[session:${session.sessionId}] failed to append queue log err=${message}`);
  });

  res.status(202).json({
    sessionId: session.sessionId,
    provider: provider.id,
    status: session.status,
    queryUrl: `/v1/sessions/${session.sessionId}`,
  });

  void processSession(session.sessionId, provider.id, body.prompt, options);
});

app.get('/v1/sessions/:sessionId', async (req: Request, res: Response) => {
  if (!requireAuth(req, res)) return;

  try {
    const rawSessionId = req.params.sessionId;
    const sessionId = Array.isArray(rawSessionId) ? rawSessionId[0] : rawSessionId;
    if (!sessionId) {
      res.status(400).json({ error: 'Missing session id.' });
      return;
    }

    const session = await loadSession(sessionId);
    if (!session) {
      res.status(404).json({ error: 'Session not found.' });
      return;
    }

    const progressLogs = await readSessionLogs(sessionId);
    res.status(200).json({
      ...session,
      progressLogs,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(400).json({ error: message });
  }
});

const start = async () => {
  const defaultProvider = getProvider(defaultProviderId);
  if (!defaultProvider) {
    throw new Error(
      `Default provider '${defaultProviderId}' is not supported. Available: ${listProviders().join(', ')}`,
    );
  }

  defaultProvider.assertAvailable();
  await ensureSessionStorage();

  app.listen(port, host, () => {
    log(`Agent SDK HTTP server listening at http://${host}:${port}`);
    log(
      `Workspace policy: default cwd=${fallbackReadOnlyCwd} (read-only), provided cwd enables write within cwd only`,
    );
    log(`Session state dir: ${getSessionStorageDir()}`);
  });
};

void start().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Startup failed: ${message}`);
  process.exit(1);
});

import 'dotenv/config';
import express, { type Request, type Response } from 'express';
import { getProvider, listProviders } from './providers/index.js';
import {
  createQueuedSession,
  ensureSessionStorage,
  getSessionStorageDir,
  loadSession,
  markSessionCompleted,
  markSessionFailed,
  markSessionRunning,
} from './sessionStore.js';
import {
  expandHomePath,
  isExistingDirectory,
  isRecord,
  parsePositiveInt,
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

const normalizeQueryOptions = async (
  rawOptions: JsonRecord,
): Promise<{ options: JsonRecord; error?: string }> => {
  const options: JsonRecord = { ...rawOptions };
  const cwdValue = options.cwd;

  if (cwdValue === undefined) {
    return { options };
  }

  if (typeof cwdValue !== 'string' || !cwdValue.trim()) {
    return { options, error: '`options.cwd` must be a non-empty string when provided.' };
  }

  const expandedCwd = expandHomePath(cwdValue);
  if (!(await isExistingDirectory(expandedCwd))) {
    return { options, error: '`options.cwd` does not exist or is not a directory.' };
  }

  options.cwd = expandedCwd;
  return { options };
};

const processSession = async (
  sessionId: string,
  providerId: string,
  prompt: string,
  options: JsonRecord,
): Promise<void> => {
  const provider = getProvider(providerId);
  if (!provider) {
    await markSessionFailed(sessionId, `Unsupported provider: ${providerId}`);
    log(`[session:${sessionId}] failed unsupported provider=${providerId}`);
    return;
  }

  const startedAt = Date.now();

  try {
    await markSessionRunning(sessionId);
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
      },
    });

    for await (const message of stream) {
      messages.push(message);
    }

    await markSessionCompleted(sessionId, { messages, stderr: stderrEvents });
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

    log(`[session:${sessionId}] failed provider=${providerId} err=${message}`);
  }
};

app.get('/healthz', (_req, res) => {
  res.json({
    ok: true,
    service: 'coding-agent-http-server',
    defaultProvider: defaultProviderId,
    availableProviders: listProviders(),
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

    res.status(200).json(session);
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
    log(`Session state dir: ${getSessionStorageDir()}`);
  });
};

void start().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Startup failed: ${message}`);
  process.exit(1);
});

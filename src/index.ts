import 'dotenv/config';
import express, { type Request, type Response } from 'express';
import { getProvider, listProviders } from './providers/index.js';
import { isRecord, parsePositiveInt } from './utils.js';

type QueryRequestBody = {
  provider?: unknown;
  prompt?: unknown;
  options?: unknown;
  stream?: unknown;
};

const sendSse = (res: Response, data: unknown) => {
  res.write(`data: ${JSON.stringify(data)}\n\n`);
};

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: process.env.REQUEST_JSON_LIMIT ?? '2mb' }));

const port = parsePositiveInt(process.env.PORT) ?? 8787;
const host = process.env.HOST?.trim() || '127.0.0.1';
const httpAuthToken = process.env.HTTP_AUTH_TOKEN?.trim();
const defaultProviderId = (process.env.AGENT_PROVIDER?.trim().toLowerCase() || 'claude');

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

app.get('/healthz', (_req, res) => {
  res.json({
    ok: true,
    service: 'coding-agent-http-server',
    defaultProvider: defaultProviderId,
    availableProviders: listProviders(),
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

  const stream = body.stream !== false;
  const abortController = new AbortController();
  const options = (body.options ?? {}) as Record<string, unknown>;

  const stderrEvents: string[] = [];
  const onStderr = (data: string) => {
    if (stream) {
      if (!res.writableEnded) {
        sendSse(res, { type: 'stderr', data, provider: provider.id });
      }
      return;
    }

    stderrEvents.push(data);
  };

  req.on('aborted', () => {
    abortController.abort();
  });

  res.on('close', () => {
    if (!res.writableEnded) {
      abortController.abort();
    }
  });

  try {
    if (stream) {
      res.status(200);
      res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache, no-transform');
      res.setHeader('Connection', 'keep-alive');
      if (typeof res.flushHeaders === 'function') {
        res.flushHeaders();
      }
    }

    const messages = provider.run({
      prompt: body.prompt,
      options,
      abortController,
      onStderr,
    });

    if (stream) {
      for await (const message of messages) {
        if (res.writableEnded) break;
        sendSse(res, { provider: provider.id, message });
      }

      if (!res.writableEnded) {
        sendSse(res, { type: 'proxy_done', provider: provider.id });
        res.end();
      }
      return;
    }

    const collected: unknown[] = [];
    for await (const message of messages) {
      collected.push(message);
    }

    res.status(200).json({
      provider: provider.id,
      messages: collected,
      stderr: stderrEvents,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    if (stream) {
      if (!res.writableEnded) {
        sendSse(res, { type: 'proxy_error', provider: provider.id, error: message });
        res.end();
      }
      return;
    }

    res.status(500).json({ error: message, provider: provider.id });
  }
});

try {
  const defaultProvider = getProvider(defaultProviderId);
  if (!defaultProvider) {
    throw new Error(
      `Default provider '${defaultProviderId}' is not supported. Available: ${listProviders().join(', ')}`,
    );
  }

  defaultProvider.assertAvailable();
  app.listen(port, host, () => {
    console.log(`Agent SDK HTTP server listening at http://${host}:${port}`);
  });
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Startup failed: ${message}`);
  process.exit(1);
}

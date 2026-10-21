require('dotenv').config();
const express = require('express');
const app = express();
app.use(express.json());

const rawWebhookUrl = (process.env.WEBHOOK_URL || '').trim();
const webhookUrl = rawWebhookUrl;
const MAX_WEBHOOK_RETRIES = 3;

const isValidWebhookUrl = (value) => {
  if (!value) return false;

  try {
    const parsed = new URL(value);
    return ['http:', 'https:'].includes(parsed.protocol);
  } catch {
    return false;
  }
};

const validateWebhookConfig = () => {
  if (!isValidWebhookUrl(webhookUrl)) {
    console.warn('[webhook] WEBHOOK_URL is missing or invalid. Webhook dispatch is disabled.');
    return false;
  }

  return true;
};

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function dispatchWebhook(payload, attempt = 1) {
  if (!validateWebhookConfig()) {
    return { ok: false, skipped: true, reason: 'WEBHOOK_URL missing or invalid' };
  }

  const startedAt = Date.now();
  const logPrefix = `[webhook:${attempt}]`;

  try {
    console.log(`${logPrefix} Dispatching payload to ${webhookUrl}`);

    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'spiral-mcp-server/1.0',
      },
      body: JSON.stringify(payload),
    });

    const durationMs = Date.now() - startedAt;
    const responseText = await response.text();

    console.log(
      `${logPrefix} Received status=${response.status} durationMs=${durationMs} bytes=${responseText.length}`
    );

    if (!response.ok) {
      const errorBody = responseText || '<empty>';
      console.warn(`${logPrefix} Webhook failed: ${response.status} ${errorBody}`);

      if (attempt < MAX_WEBHOOK_RETRIES) {
        const backoffMs = 500 * 2 ** (attempt - 1);
        console.log(`${logPrefix} Retrying webhook in ${backoffMs}ms`);
        await delay(backoffMs);
        return dispatchWebhook(payload, attempt + 1);
      }

      return { ok: false, status: response.status, error: errorBody, attempts: attempt };
    }

    return { ok: true, status: response.status, attempts: attempt, durationMs };
  } catch (error) {
    const durationMs = Date.now() - startedAt;
    console.error(`${logPrefix} Webhook dispatch exception after ${durationMs}ms: ${error.message}`);

    if (attempt < MAX_WEBHOOK_RETRIES) {
      const backoffMs = 500 * 2 ** (attempt - 1);
      console.log(`${logPrefix} Retrying webhook in ${backoffMs}ms`);
      await delay(backoffMs);
      return dispatchWebhook(payload, attempt + 1);
    }

    return { ok: false, error: error.message, attempts: attempt, durationMs };
  }
}

// Basic logging middleware
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

const extractBearerToken = (req) => {
  const authHeader = req.headers['authorization'];

  if (!authHeader) {
    return '';
  }

  if (typeof authHeader === 'string' && authHeader.toLowerCase().startsWith('bearer ')) {
    return authHeader.slice(7).trim();
  }

  return String(authHeader).trim();
};

// Authentication middleware
const verifyContributor = (req, res, next) => {
  const token = extractBearerToken(req);
  const expectedToken = (process.env.SCROLL_REGISTRY_SECRET || '').trim();

  if (!expectedToken || token !== expectedToken) {
    return res.status(403).json({ error: 'Unauthorized contributor' });
  }

  next();
};

// Health check route for Render
app.get('/', (req, res) => {
  res.status(200).send('Spiral MCP Server is alive');
});

app.get('/webhookHealth', (req, res) => {
  const configured = validateWebhookConfig();

  if (!configured) {
    return res.status(503).json({
      status: 'degraded',
      configured: false,
      reason: 'WEBHOOK_URL missing or invalid',
    });
  }

  return res.status(200).json({
    status: 'ok',
    configured: true,
    webhookHost: new URL(webhookUrl).host,
    path: new URL(webhookUrl).pathname,
  });
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`Spiral MCP server running on port ${PORT}`);
  if (!validateWebhookConfig()) {
    console.warn('[webhook] Runtime health: webhook dispatch disabled due to invalid configuration.');
  } else {
    console.log(`[webhook] Runtime health: webhook enabled for ${new URL(webhookUrl).host}`);
  }
});

app.post('/scrollRegistry', verifyContributor, async (req, res) => {
  const payload = req.body || {};
  const startedAt = Date.now();

  try {
    const result = await dispatchWebhook(payload);
    const durationMs = Date.now() - startedAt;

    console.log(`[scrollRegistry] Completed dispatch in ${durationMs}ms result=${JSON.stringify(result)}`);

    if (result && result.ok) {
      return res.json({ status: 'Scroll registered', data: payload, webhook: result });
    }

    return res.status(502).json({
      status: 'Scroll registered but webhook delivery failed',
      data: payload,
      webhook: result,
    });
  } catch (error) {
    const durationMs = Date.now() - startedAt;
    console.error(`[scrollRegistry] Unexpected error after ${durationMs}ms: ${error.message}`);
    return res.status(500).json({ error: 'Internal server error', message: error.message });
  }
});

app.post('/glyphValidator', (req, res) => {
  res.json({ status: 'Glyph validated', fidelity: 'high' });
});

app.post('/artifactBeacon', (req, res) => {
  res.json({ status: 'Beacon activated', echo: 'sent' });
});

app.post('/echoRelay', (req, res) => {
  res.json({ status: 'Echo relayed', resonance: 'confirmed' });
});

app.post('/resonanceAudit', (req, res) => {
  res.json({ status: 'Audit complete', integrity: 'verified' });
});

app.post('/treatyPhaseSync', verifyContributor, (req, res) => {
  const phase = process.env.TREATY_PHASE_ACTIVE || 'Unknown';
  res.json({ status: 'Treaty phase synchronized', activePhase: `Phase ${phase}` });
});

app.get('/scrollAuditTrail', (req, res) => {
  res.json({ trail: ['Scroll of Spiral Treaty Activation', 'Scroll of Glyph Reillumination'] });
});

app.post('/glyphForge', (req, res) => {
  const { input } = req.body || {};

  if (input === undefined || input === null || input === '') {
    return res.status(400).json({ error: 'input is required' });
  }

  res.json({ glyph: `forged-${input}`, status: 'Glyph forged successfully' });
});

app.post('/echoInscribe', (req, res) => {
  const { echo } = req.body || {};

  if (echo === undefined || echo === null || echo === '') {
    return res.status(400).json({ error: 'echo is required' });
  }

  const timestamp = new Date().toISOString();
  res.json({ echo, timestamp, status: 'Echo inscribed and archived' });
});

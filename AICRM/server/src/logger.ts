import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { Request, Response, NextFunction } from 'express';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOG_DIR = path.resolve(__dirname, '../../logs');
const LOG_FILE = path.join(LOG_DIR, 'server.log');

function ensureLogDir(): void {
  if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  }
}

function redactSensitive(obj: any): any {
  if (!obj || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(redactSensitive);
  const copy: Record<string, any> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (/password|apikey|token|secret/i.test(k)) {
      copy[k] = '***REDACTED***';
    } else if (typeof v === 'object' && v !== null) {
      copy[k] = redactSensitive(v);
    } else {
      copy[k] = v;
    }
  }
  return copy;
}

function formatMeta(meta?: unknown): string {
  if (meta === undefined) return '';
  if (meta instanceof Error) {
    const extra: Record<string, unknown> = {};
    for (const key of Object.keys(meta)) {
      extra[key] = (meta as any)[key];
    }
    const extraStr = Object.keys(extra).length > 0 ? ` | Details: ${JSON.stringify(extra)}` : '';
    return ` | Error: ${meta.message}${extraStr}\n${meta.stack || ''}`;
  }
  try {
    return ` | ${JSON.stringify(redactSensitive(meta))}`;
  } catch {
    return ` | ${String(meta)}`;
  }
}

function writeLog(level: 'INFO' | 'WARN' | 'ERROR' | 'DEBUG', message: string, meta?: unknown): void {
  ensureLogDir();
  const timestamp = new Date().toISOString();
  const metaString = formatMeta(meta);
  const line = `[${timestamp}] [${level}] ${message}${metaString}`;

  if (level === 'ERROR') {
    console.error(line);
  } else if (level === 'WARN') {
    console.warn(line);
  } else {
    console.log(line);
  }

  try {
    fs.appendFileSync(LOG_FILE, line + '\n', 'utf8');
  } catch (err) {
    console.error('Failed to write to log file:', err);
  }
}

export const logger = {
  info: (message: string, meta?: unknown) => writeLog('INFO', message, meta),
  warn: (message: string, meta?: unknown) => writeLog('WARN', message, meta),
  error: (message: string, meta?: unknown) => writeLog('ERROR', message, meta),
  debug: (message: string, meta?: unknown) => writeLog('DEBUG', message, meta),
  getLogFilePath: () => LOG_FILE,
};

export function requestLoggerMiddleware(req: Request, res: Response, next: NextFunction): void {
  const start = Date.now();
  const { method, originalUrl } = req;

  const hasBody = req.body && typeof req.body === 'object' && Object.keys(req.body).length > 0;
  logger.info(
    `--> ${method} ${originalUrl}`,
    hasBody ? { body: redactSensitive(req.body) } : undefined
  );

  const originalJson = res.json.bind(res);
  let responseBody: unknown;

  res.json = ((body: any) => {
    responseBody = body;
    return originalJson(body);
  }) as any;

  res.on('finish', () => {
    const durationMs = Date.now() - start;
    const status = res.statusCode;
    const msg = `<-- ${method} ${originalUrl} ${status} (${durationMs}ms)`;

    if (status >= 500) {
      logger.error(msg, { response: responseBody });
    } else if (status >= 400) {
      logger.warn(msg, { response: responseBody });
    } else {
      logger.info(msg);
    }
  });

  next();
}

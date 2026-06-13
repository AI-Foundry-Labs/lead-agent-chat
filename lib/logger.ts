import * as fs from 'fs';
import * as path from 'path';

const LOG_FILE = path.join(process.cwd(), 'logs', 'agent.log');
const LOG_DIR = path.dirname(LOG_FILE);

// Ensure logs directory exists (sync, once at module load)
if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

type LogLevel = 'info' | 'warn' | 'error';

function write(level: LogLevel, event: string, data: Record<string, unknown>) {
  const entry = JSON.stringify({ ts: new Date().toISOString(), level, event, ...data });
  // stdout — captured by Docker / pm2 / systemd
  (level === 'error' ? process.stderr : process.stdout).write(entry + '\n');
  // file — append for local tailing
  fs.promises.appendFile(LOG_FILE, entry + '\n').catch(() => {});
}

export const agentLog = {
  info: (event: string, data: Record<string, unknown> = {}) => write('info', event, data),
  warn: (event: string, data: Record<string, unknown> = {}) => write('warn', event, data),
  error: (event: string, data: Record<string, unknown> = {}) => write('error', event, data),
};

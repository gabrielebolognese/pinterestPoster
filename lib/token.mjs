// Pinterest tokens. The access token lasts 30 days and the refresh token 60; every refresh returns a
// new refresh token. Only this PC refreshes: it saves both in .env and copies the access token to the
// GitHub secret the poster reads, so there is never a second place holding an older refresh token.
import { execFileSync } from 'node:child_process';
import { cfg, ROOT } from './util.mjs';
import { readEnv, updateEnv } from './env.mjs';

const REFRESH_AFTER_DAYS = 7;

export async function tokenRequest(env, fields) {
  const res = await fetch(`${cfg.apiBase}/v5/oauth/token`, {
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + Buffer.from(`${env.PINTEREST_APP_ID}:${env.PINTEREST_APP_SECRET}`).toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams(fields),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) throw new Error(`token request failed (${res.status}): ${JSON.stringify(data)}`);
  return data;
}

export function saveTokens(data) {
  const values = { PINTEREST_ACCESS_TOKEN: data.access_token, PINTEREST_TOKEN_DATE: new Date().toISOString().slice(0, 10) };
  if (data.refresh_token) values.PINTEREST_REFRESH_TOKEN = data.refresh_token;
  updateEnv(values);
}

// Copies the access token to the repo secret through gh (the value goes on stdin, never on the command line)
export function pushSecret(token) {
  execFileSync('gh', ['secret', 'set', 'PINTEREST_ACCESS_TOKEN'], { cwd: ROOT, input: token, stdio: ['pipe', 'pipe', 'pipe'] });
}

// Called by the night scan. Returns a short note for the log.
export async function refreshIfNeeded(hasRemote) {
  const env = readEnv();
  if (!env.PINTEREST_APP_ID || !env.PINTEREST_APP_SECRET || !env.PINTEREST_REFRESH_TOKEN) {
    return 'no Pinterest login yet (run "npm run login" once the app is approved)';
  }
  const age = env.PINTEREST_TOKEN_DATE ? (Date.now() - new Date(env.PINTEREST_TOKEN_DATE)) / 86400000 : Infinity;
  if (env.PINTEREST_ACCESS_TOKEN && age < REFRESH_AFTER_DAYS) return `token is ${Math.floor(age)} days old, still fresh`;
  const data = await tokenRequest(env, { grant_type: 'refresh_token', refresh_token: env.PINTEREST_REFRESH_TOKEN });
  saveTokens(data);
  if (hasRemote) pushSecret(data.access_token);
  return `token refreshed${hasRemote ? ' and sent to GitHub' : ' (no GitHub repo yet, kept in .env only)'}`;
}

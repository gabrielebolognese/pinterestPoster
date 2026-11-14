// Pinterest tokens, kept in .env on this PC. The access token lasts 30 days and the refresh token 60;
// every refresh returns a new refresh token, which replaces the old one in .env.
import { cfg } from './util.mjs';
import { readEnv, updateEnv } from './env.mjs';

const REFRESH_AFTER_DAYS = 7;
const API = () => process.env.PINTEREST_API_BASE || cfg.apiBase;

export async function tokenRequest(env, fields) {
  const res = await fetch(`${API()}/v5/oauth/token`, {
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

export const loggedIn = (env = readEnv()) => Boolean(env.PINTEREST_APP_ID && env.PINTEREST_APP_SECRET && env.PINTEREST_REFRESH_TOKEN);

// Gets a new access token now and returns it
export async function refreshNow() {
  const env = readEnv();
  if (!loggedIn(env)) throw new Error('no Pinterest login yet (run "npm run login")');
  const data = await tokenRequest(env, { grant_type: 'refresh_token', refresh_token: env.PINTEREST_REFRESH_TOKEN });
  saveTokens(data);
  return data.access_token;
}

// Called by the night scan. Returns a short note for the log.
export async function refreshIfNeeded() {
  const env = readEnv();
  if (!loggedIn(env)) return 'no Pinterest login yet (run "npm run login" once the app is approved)';
  const age = env.PINTEREST_TOKEN_DATE ? (Date.now() - new Date(env.PINTEREST_TOKEN_DATE)) / 86400000 : Infinity;
  if (env.PINTEREST_ACCESS_TOKEN && age < REFRESH_AFTER_DAYS) return `token is ${Math.floor(age)} days old, still fresh`;
  await refreshNow();
  return 'token refreshed';
}

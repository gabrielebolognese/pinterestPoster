// One-time Pinterest login: npm run login
// Needs PINTEREST_APP_ID and PINTEREST_APP_SECRET in .env, and the redirect link from config.json
// (http://localhost:8080/callback) added to the app's Redirect URIs on developers.pinterest.com.
import http from 'node:http';
import crypto from 'node:crypto';
import { exec } from 'node:child_process';
import { cfg } from './lib/util.mjs';
import { readEnv } from './lib/env.mjs';
import { tokenRequest, saveTokens } from './lib/token.mjs';

const env = readEnv();
if (!env.PINTEREST_APP_ID || !env.PINTEREST_APP_SECRET) {
  console.error('Fill in PINTEREST_APP_ID and PINTEREST_APP_SECRET in the .env file first (copy .env.example to .env).');
  process.exit(1);
}

const redirect = new URL(cfg.redirectUri);
const state = crypto.randomBytes(16).toString('hex');
const authUrl =
  'https://www.pinterest.com/oauth/?' +
  new URLSearchParams({
    client_id: env.PINTEREST_APP_ID,
    redirect_uri: cfg.redirectUri,
    response_type: 'code',
    scope: cfg.scopes,
    state,
  });

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, cfg.redirectUri);
  if (url.pathname !== redirect.pathname) {
    res.writeHead(404).end();
    return;
  }
  const done = (code, text) => {
    res.writeHead(code, { 'Content-Type': 'text/plain; charset=utf-8' }).end(text);
    server.close();
  };
  if (url.searchParams.get('state') !== state || !url.searchParams.get('code')) {
    done(400, 'Login failed: Pinterest did not send back a valid code. Run "npm run login" again.');
    console.error('Login failed:', url.search);
    process.exitCode = 1;
    return;
  }
  try {
    const data = await tokenRequest(env, {
      grant_type: 'authorization_code',
      code: url.searchParams.get('code'),
      redirect_uri: cfg.redirectUri,
    });
    saveTokens(data);
    console.log(`Logged in. Tokens saved in .env (scopes: ${data.scope}).`);
    done(200, 'Pinterest login done. You can close this tab.');
  } catch (err) {
    done(500, 'Login failed while getting the tokens. See the terminal.');
    console.error(err.message);
    process.exitCode = 1;
  }
});

server.listen(Number(redirect.port || 80), () => {
  console.log('Opening Pinterest in your browser. If it does not open, go to:\n' + authUrl);
  exec(`start "" "${authUrl.replace(/&/g, '^&')}"`);
});

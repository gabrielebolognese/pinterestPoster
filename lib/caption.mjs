// Writes the title, description and alt text for one image with the claude CLI, which looks at the image itself.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { cfg } from './util.mjs';

const LIMITS = { title: 100, description: 500, alt_text: 400 };
const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['title', 'description', 'alt_text'],
  properties: {
    title: { type: 'string', minLength: 10 },
    description: { type: 'string', minLength: 60 },
    alt_text: { type: 'string', minLength: 20 },
  },
};

// The npm shim is a .cmd file and cmd.exe would mangle the JSON schema argument, so call the exe behind it
function claudeCmd() {
  if (process.env.PINS_CLAUDE) return [process.execPath, [process.env.PINS_CLAUDE]];
  for (const dir of (process.env.PATH || '').split(path.delimiter)) {
    if (!dir) continue;
    const exe = path.join(dir, 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe');
    if (fs.existsSync(exe)) return [exe, []];
    const direct = path.join(dir, 'claude.exe');
    if (fs.existsSync(direct)) return [direct, []];
  }
  throw new Error('claude CLI not found in PATH');
}

function prompt(imagePath, hint, usedTitles) {
  const used = usedTitles.length
    ? `\nThese titles are already used on other Pins. Yours must be clearly different, with a different angle and different related terms in the description:\n${usedTitles.map((t) => `- ${t}`).join('\n')}\n`
    : '';
  return `Read the image file at ${imagePath} and look at it carefully.

It is a photo for a Pinterest Pin on a calisthenics and handstand training account. The file was named "${hint}", which usually names the exercise shown. Trust what you see in the image over the name.

Write the Pin text so people searching Pinterest find this image. Answer with JSON only:

- title: at most ${LIMITS.title} characters. Start with the exact exercise name people type in search, then add one specific angle (level, goal, body part or setting). Title case. No clickbait.
- description: 2 to 4 natural sentences, at most ${LIMITS.description} characters. The first sentence repeats the main search term. Work in related terms people search for (the exercise, the muscles it trains, the progression it belongs to, home or bodyweight training, the skill it leads to) only where they are true for this image. Say something useful about the exercise, such as a form cue or who it suits.
- alt_text: one or two plain sentences, at most ${LIMITS.alt_text} characters, describing literally what is visible (body position, setting) for someone who cannot see the image.

Rules: plain everyday English. No hashtags, no emojis, no links, no em dashes, no quotation marks. Do not name or identify the person. Do not invent numbers, results or claims the image does not show.
${used}`;
}

export function writeCaption(imagePath, hint, usedTitles = []) {
  const [cmd, pre] = claudeCmd();
  const args = [
    ...pre, '-p', '--model', cfg.captionModel, '--output-format', 'json',
    '--permission-mode', 'auto', '--permission-prompts', 'none',
    '--tools', 'Read', '--allowedTools', 'Read',
    '--json-schema', JSON.stringify(SCHEMA),
  ];
  // Runs in the image's own temporary folder, outside the project, so no project files reach the prompt
  const p = spawnSync(cmd, args, {
    cwd: path.dirname(imagePath), input: prompt(imagePath, hint, usedTitles), encoding: 'utf8',
    timeout: 5 * 60000, maxBuffer: 32 * 1024 * 1024,
  });
  if (p.error) throw new Error(`claude did not run: ${p.error.message}`);
  let data;
  try {
    data = JSON.parse(p.stdout);
  } catch {
    throw new Error(`claude gave no JSON (exit ${p.status}): ${(p.stderr || p.stdout || '').slice(0, 300)}`);
  }
  if (data.is_error) throw new Error(`claude error: ${String(data.result).slice(0, 300)}`);
  let out = data.structured_output;
  if (!out) {
    try {
      out = JSON.parse(String(data.result).replace(/^```(?:json)?\s*|\s*```$/g, ''));
    } catch {
      throw new Error(`claude answer was not the expected JSON: ${String(data.result).slice(0, 300)}`);
    }
  }
  for (const key of Object.keys(LIMITS)) {
    if (typeof out[key] !== 'string' || !out[key].trim()) throw new Error(`caption is missing ${key}`);
    out[key] = out[key].trim();
    if (out[key].length > LIMITS[key]) throw new Error(`${key} is ${out[key].length} characters, over ${LIMITS[key]}`);
  }
  return { title: out.title, description: out.description, alt_text: out.alt_text };
}

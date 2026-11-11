# pinterest-autopost

A personal automation that turns a folder of images into scheduled Pinterest Pins. You drop images into the project folder; a nightly scan on a Windows PC converts each one to a light JPEG, has the `claude` CLI write its title, description and alt text, gives it a date in a posting calendar and pushes the result to GitHub. A scheduled GitHub Actions workflow then publishes each Pin through the official Pinterest API (v5) when its time comes, so the PC can be off at posting time.

It is built for a single account owner who posts image Pins to one board. The caption prompt is written for a calisthenics and handstand training account (see `lib/caption.mjs`).

## Features

**Night scan (`scan.mjs`, runs on the PC)**

- Picks up `.png`, `.jpg`, `.jpeg` and `.webp` files in the project root, oldest first. Files changed in the last 5 minutes wait for the next scan.
- Detects duplicates by SHA-256 of the file content against everything in `queue/` and `posted/`, and moves them to `duplicates/`.
- Converts each image with `sharp` to an auto-rotated JPEG (1440 px wide at most, quality 88 by default).
- Runs the `claude` CLI on the JPEG to write a title (max 100 characters), description (max 500) and alt text (max 400), checked against a JSON schema. Titles already used on other Pins are passed in so new ones differ.
- Assigns each image a slot: `everyDays` after the last Pin in the calendar (waiting or posted), or the first day with room in the posting window, at a random minute inside the window.
- Writes one folder per Pin to `queue/` (for example `queue/2026-11-12_1127/` with the JPEG and `pin.json`), moves the original to `scheduled/`, then commits and pushes.
- Refreshes the Pinterest access token when it is more than 7 days old and copies it to the GitHub secret with `gh secret set`.
- Appends every action to `logs/scan.log`.
- Temporary failures are not fatal: if a caption cannot be written the image stays in the root for the next night, and after two caption failures in a row the rest of the batch is left for the next scan. An image that cannot be opened goes to `failed/`.

**Posting (`post.mjs`, runs on GitHub Actions)**

- Posts every Pin in `queue/` whose time has come, with `POST /v5/pins` and the image sent as base64.
- Finds the board by name (case-insensitive) through `GET /v5/boards`, or uses `boardId` from `config.json` if set.
- A posted Pin moves to `posted/` with its `pin_id` and `posted_at`. A failed Pin stays in `queue/` with `last_error` and is retried on every run; once it is more than `maxLateHours` late it moves to `failed/` and the calendar carries on.
- Does nothing if the `PINTEREST_ACCESS_TOKEN` secret is not set, so no Pin is marked as failed before the login exists.
- Has no npm dependencies, so the workflow runs it without an install step.

**Login (`auth.mjs`)**

- One-time OAuth authorization-code flow with a local callback server and a `state` check. Saves the tokens in `.env` and sends the access token to the GitHub secret.

## Getting started

### Prerequisites

- Windows. The scan is registered in Windows Task Scheduler, the login opens the browser with `start`, and the caption step looks for `claude.exe`.
- Node.js 22 (the version the workflow uses; the code relies on `import.meta.dirname` and the built-in test runner).
- Git, and the GitHub CLI (`gh`) authenticated for your repository, used to set the Actions secret.
- The Claude Code CLI (`claude`) installed and logged in, on your `PATH`.
- A Pinterest developer app with access to the scopes `boards:read`, `pins:read` and `pins:write`.

### Download and install

```
git clone https://github.com/gabrielebolognese/pinterestPoster.git
cd pinterestPoster
npm install
```

The only dependency is `sharp`.

### Configuration

1. Copy `.env.example` to `.env` and fill in `PINTEREST_APP_ID` and `PINTEREST_APP_SECRET` from the Pinterest app page. The remaining variables (`PINTEREST_REFRESH_TOKEN`, `PINTEREST_ACCESS_TOKEN`, `PINTEREST_TOKEN_DATE`) are written by the login and kept fresh by the night scan. `.env` is git-ignored.
2. On the Pinterest app page, add `http://localhost:8080/callback` to the Redirect URIs (this is `redirectUri` in `config.json`).
3. Adjust `config.json`:

| Key | Default | Meaning |
| --- | --- | --- |
| `timezone` | `Europe/Rome` | Timezone of the posting calendar |
| `windowStart`, `windowEnd` | `10:00`, `13:00` | Posting window; each Pin gets a random time inside it |
| `everyDays` | `2` | Days between Pins |
| `maxLateHours` | `24` | How late a Pin may be before it moves to `failed/` |
| `board` | `personal pins` | Name of the board to post to |
| `boardId` | empty | Board id; when set, the lookup by name is skipped |
| `apiBase` | `https://api.pinterest.com` | Set to `https://api-sandbox.pinterest.com` to test against the Pinterest sandbox |
| `scopes` | `boards:read,pins:read,pins:write` | OAuth scopes requested at login |
| `redirectUri` | `http://localhost:8080/callback` | Local OAuth callback |
| `captionModel` | `opus` | Model passed to the `claude` CLI |
| `jpegWidth`, `jpegQuality` | `1440`, `88` | Size and quality of the JPEG that is posted |

The workflow sets `TZ: Europe/Rome` and its cron times are written for the default window. If you change the timezone or the window, update `.github/workflows/post.yml` to match.

### Log in to Pinterest

```
npm run login
```

Approve the app in the browser. The tokens are saved in `.env`, and if the folder is a git repository with a remote, the access token is sent to the GitHub secret `PINTEREST_ACCESS_TOKEN`. Otherwise the next scan sends it at its next token refresh.

## Deploy

The project runs from your own GitHub repository, because both the scan and the workflow commit the queue state back to it.

1. Push the folder to a GitHub repository you own. The workflow needs `contents: write`, which it declares itself.
2. Run `npm run login` so the `PINTEREST_ACCESS_TOKEN` secret exists.
3. Register the nightly scan in Windows Task Scheduler:

```
powershell -ExecutionPolicy Bypass -File install-task.ps1
```

This creates the task `pinterest-night-scan`, which runs `node scan.mjs` every day at 02:00, wakes the PC if it is asleep and runs at the next startup if the PC was off. Remove it with:

```
Unregister-ScheduledTask -TaskName "pinterest-night-scan" -Confirm:$false
```

The workflow `.github/workflows/post.yml` runs `node post.mjs` every 30 minutes from 08:07 to 12:37 UTC, plus 15:07 and 19:07 UTC for retries, and can be started by hand with the "Run workflow" button. After each run it commits the changes in `queue/`, `posted/` and `failed/`. A Pin goes out between its time and about 30 minutes after.

## Usage

Drop images into the project root and leave the rest to the schedule. The file name is passed to the caption writer as a hint for the exercise shown, so a descriptive name helps.

| Command | What it does |
| --- | --- |
| `npm run scan` | Runs the night scan now: captions, schedules, commits and pushes |
| `npm run plan` | `node scan.mjs --dry-run`: prints which image would get which date and changes nothing |
| `node caption-test.mjs <image>` | Prints the JPEG size and the text that would be written for one image, without scheduling it |
| `npm run post` | Posts the due Pins (normally run by GitHub Actions; needs `PINTEREST_ACCESS_TOKEN` in the environment) |
| `npm run login` | One-time Pinterest login |
| `npm test` | Runs the tests: calendar rules, and the poster against a fake Pinterest API |

To retry an image that ended up in `failed/`, drag the original back to the project root. When a Pin fails on GitHub, the next night scan moves its original from `scheduled/` to `failed/` for that purpose.

## Project structure

```
scan.mjs            night scan: captions, schedules and pushes new images
post.mjs            poster run by GitHub Actions
auth.mjs            one-time Pinterest OAuth login
caption-test.mjs    caption preview for one image
config.json         settings
install-task.ps1    registers the 02:00 scan in Windows Task Scheduler
lib/caption.mjs     prompt, schema and claude CLI call for the Pin text
lib/slots.mjs       calendar logic (pure date functions)
lib/token.mjs       token requests, refresh and GitHub secret update
lib/env.mjs         reads and updates .env
lib/util.mjs        paths, pin folder helpers, safe moves
tests/              node:test suites for the calendar and the poster
.github/workflows/  post.yml, the scheduled posting workflow
app-icon/           icon for the Pinterest app
```

Folders created while it runs:

```
(root)       new images you drop in                              (local only)
scheduled/   originals that got a date                           (local only)
duplicates/  images that were already scheduled or posted        (local only)
failed/      originals that could not be scheduled or posted (local only), and the folders of Pins that failed (tracked)
queue/       one folder per waiting Pin, with the JPEG and pin.json
posted/      Pins that went out
logs/        scan.log                                            (local only)
```

## Tech stack

- Node.js 22, ES modules, built-in `fetch` and `node:test`
- `sharp` for image conversion
- Pinterest API v5 (OAuth, boards, pins)
- Claude Code CLI for the Pin text
- GitHub Actions for scheduled posting, GitHub CLI for the secret
- Windows Task Scheduler and PowerShell for the nightly scan

## Further documentation

There are no separate docs. The header comments of `scan.mjs`, `post.mjs`, `auth.mjs`, `lib/token.mjs` and `.github/workflows/post.yml` explain the reasoning behind each part.

## Status

A personal tool, built for one account and one Windows PC. Posting to the live Pinterest API requires an approved Pinterest developer app; the repository currently contains no queued or posted Pins.

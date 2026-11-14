# pinterest-autopost

A personal automation that turns a folder of images into scheduled Pinterest Pins. You drop images into the project folder; a runner that lives in the background on a Windows PC scans the folder every night, converts each new image to a light JPEG, has the `claude` CLI write its title, description and alt text, and gives it a date in a posting calendar. The same runner publishes each Pin through the official Pinterest API (v5) when its time comes.

Everything runs on the PC. The PC has to be on (or asleep with wake timers allowed) for a Pin to go out at its time; a Pin whose time passed while the PC was off is posted when the PC is back, up to 24 hours late.

It is built for a single account owner who posts image Pins to one board. The caption prompt is written for a calisthenics and handstand training account (see `lib/caption.mjs`).

## Features

**Runner (`runner.mjs`)**

- One background process, started at login with no window. Only one can run at a time (lock file in `logs/`).
- Once a night, from 02:00 on, it runs the scan. If the PC was off at 02:00, the scan runs as soon as the runner starts.
- Every minute it posts the Pins whose time has come.
- Until the Pinterest login exists it only waits: nothing is scheduled or posted.
- Writes every action to `logs/runner.log`.

**Night scan (`scan.mjs`)**

- Picks up `.png`, `.jpg`, `.jpeg` and `.webp` files in the project root, oldest first. Files changed in the last 5 minutes wait for the next scan.
- Detects duplicates by SHA-256 of the file content against everything in `queue/` and `posted/`, and moves them to `duplicates/`.
- Converts each image with `sharp` to an auto-rotated JPEG (1440 px wide at most, quality 88 by default).
- Runs the `claude` CLI on the JPEG to write a title (max 100 characters), description (max 500) and alt text (max 400), checked against a JSON schema. Titles already used on other Pins are passed in so new ones differ.
- Assigns each image a slot: `everyDays` after the last Pin in the calendar (waiting or posted), or the first day with room in the posting window, at a random minute inside the window.
- Writes one folder per Pin to `queue/` (for example `queue/2026-11-12_1127/` with the JPEG and `pin.json`) and moves the original to `scheduled/`.
- Refreshes the Pinterest access token when it is more than 7 days old.
- Temporary failures are not fatal: if a caption cannot be written the image stays in the root for the next night, and after two caption failures in a row the rest of the batch is left for the next scan. An image that cannot be opened goes to `failed/`.

**Posting (`post.mjs`)**

- Posts every Pin in `queue/` whose time has come, with `POST /v5/pins` and the image sent as base64.
- Finds the board by name (case-insensitive) through `GET /v5/boards`, or uses `boardId` from `config.json` if set.
- A posted Pin moves to `posted/` with its `pin_id` and `posted_at`.
- A failed Pin stays in `queue/` with `last_error` and is tried again every `retryMinutes`. Once it is more than `maxLateHours` late it leaves the calendar: its original moves from `scheduled/` to `failed/` with a text note saying why, and the calendar carries on.
- If Pinterest rejects the access token, it refreshes the token once and tries again.

**Login (`auth.mjs`)**

- One-time OAuth authorization-code flow with a local callback server and a `state` check. Saves the tokens in `.env`.

## Getting started

### Prerequisites

- Windows. The runner is started from the Windows Startup folder and Task Scheduler, the login opens the browser with `start`, and the caption step looks for `claude.exe`.
- Node.js 22 (the code relies on `import.meta.dirname` and the built-in test runner).
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

1. Copy `.env.example` to `.env` and fill in `PINTEREST_APP_ID` and `PINTEREST_APP_SECRET` from the Pinterest app page. The remaining variables (`PINTEREST_REFRESH_TOKEN`, `PINTEREST_ACCESS_TOKEN`, `PINTEREST_TOKEN_DATE`) are written by the login and kept fresh by the runner. `.env` is git-ignored.
2. On the Pinterest app page, add `http://localhost:8080/callback` to the Redirect URIs (this is `redirectUri` in `config.json`).
3. Adjust `config.json`:

| Key | Default | Meaning |
| --- | --- | --- |
| `timezone` | `Europe/Rome` | Timezone of the posting calendar. The PC clock must be in the same timezone |
| `windowStart`, `windowEnd` | `10:00`, `13:00` | Posting window; each Pin gets a random time inside it |
| `everyDays` | `2` | Days between Pins |
| `maxLateHours` | `24` | How late a Pin may be before it moves to `failed/` |
| `retryMinutes` | `15` | Wait between two tries of a Pin that failed to post |
| `board` | `personal pins` | Name of the board to post to |
| `boardId` | empty | Board id; when set, the lookup by name is skipped |
| `apiBase` | `https://api.pinterest.com` | Set to `https://api-sandbox.pinterest.com` to test against the Pinterest sandbox |
| `scopes` | `boards:read,pins:read,pins:write` | OAuth scopes requested at login |
| `redirectUri` | `http://localhost:8080/callback` | Local OAuth callback |
| `captionModel` | `opus` | Model passed to the `claude` CLI |
| `jpegWidth`, `jpegQuality` | `1440`, `88` | Size and quality of the JPEG that is posted |

### Log in to Pinterest

```
npm run login
```

Approve the app in the browser. The tokens are saved in `.env`.

## Running in the background

```
powershell -ExecutionPolicy Bypass -File install.ps1
```

This does three things:

1. Adds a shortcut to the Windows Startup folder, so the runner starts with no window every time you log in.
2. Registers the task `pinterest-autopost`, which at 02:00 every night wakes the PC if it is asleep and starts the runner if it is not running.
3. Starts the runner now.

Stop the runner, or stop it and remove the autostart:

```
powershell -ExecutionPolicy Bypass -File stop.ps1
powershell -ExecutionPolicy Bypass -File stop.ps1 -Uninstall
```

To watch it work in a terminal instead, run `npm start` (Ctrl+C stops it).

## Usage

Drop images into the project root and leave the rest to the runner. The file name is passed to the caption writer as a hint for the exercise shown, so a descriptive name helps.

| Command | What it does |
| --- | --- |
| `npm start` | Runs the runner in the terminal |
| `npm run scan` | Runs the scan now: captions and schedules the new images |
| `npm run plan` | `node scan.mjs --dry-run`: prints which image would get which date and changes nothing |
| `node preview-caption.mjs <image>` | Prints the JPEG size and the text that would be written for one image, without scheduling it |
| `npm run post` | Posts the due Pins now |
| `npm run login` | One-time Pinterest login |
| `npm test` | Runs the tests: calendar rules, and the poster against a fake Pinterest API |

To retry an image that ended up in `failed/`, drag it back to the project root.

## Project structure

```
runner.mjs          background runner: nightly scan and posting
scan.mjs            scan: captions and schedules new images
post.mjs            posts the due Pins
auth.mjs            one-time Pinterest OAuth login
preview-caption.mjs caption preview for one image
config.json         settings
install.ps1         makes the runner start at login and at 02:00, and starts it
stop.ps1            stops the runner, optionally removes the autostart
run-hidden.vbs      starts the runner with no window
lib/caption.mjs     prompt, schema and claude CLI call for the Pin text
lib/slots.mjs       calendar logic (pure date functions)
lib/token.mjs       token requests and refresh
lib/env.mjs         reads and updates .env
lib/util.mjs        paths, pin folder helpers, safe moves, log
tests/              node:test suites for the calendar and the poster
app-icon/           icon for the Pinterest app
```

Folders created while it runs, all local only:

```
(root)       new images you drop in
scheduled/   originals that got a date
queue/       one folder per waiting Pin, with the JPEG and pin.json
posted/      Pins that went out
failed/      originals that could not be scheduled or posted, each with a note saying why
duplicates/  images that were already scheduled or posted
logs/        runner.log, and the runner's lock and state
```

## Tech stack

- Node.js 22, ES modules, built-in `fetch` and `node:test`
- `sharp` for image conversion
- Pinterest API v5 (OAuth, boards, pins)
- Claude Code CLI for the Pin text
- Windows Startup folder, Task Scheduler and PowerShell to keep the runner alive

## Further documentation

There are no separate docs. The header comments of `runner.mjs`, `scan.mjs`, `post.mjs`, `auth.mjs` and `lib/token.mjs` explain the reasoning behind each part.

## Status

A personal tool, built for one account and one Windows PC. Posting to the live Pinterest API requires an approved Pinterest developer app; no Pin has been posted with it yet.

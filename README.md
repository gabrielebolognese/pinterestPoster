# pinterest-autopost

Drop images in this folder. Every night at 02:00 a scan on this PC schedules the new ones, one Pin every two days at a random time between 10:00 and 13:00 (Italian time). GitHub Actions posts them through the official Pinterest API, so the PC can be off at posting time.

## Folders

```
(root)       new images you drop in
scheduled/   originals that got a date                      (local only)
failed/      originals that could not be scheduled or posted (drag one back to the root to try again)
duplicates/  images that were already scheduled or posted    (local only)
queue/       one folder per waiting Pin: 2026-11-12_1127/ with the small .jpg and pin.json
posted/      Pins that went out
```

## Night scan (`node scan.mjs`)

1. Pulls from GitHub and refreshes the Pinterest token when it is over 7 days old.
2. Takes the images in the root, oldest first. Files changed in the last 5 minutes wait for the next night.
3. Skips an image whose content is already in `queue/` or `posted/` (moved to `duplicates/`).
4. Converts each image to a light JPEG and has the `claude` CLI look at it and write the title, description and alt text for Pinterest search.
5. Gives each image a date: two days after the last Pin in the calendar (waiting or posted), or the first free day if that is already past.
6. Moves the original to `scheduled/`, commits and pushes.

`node scan.mjs --dry-run` prints the dates it would give and changes nothing.
`node caption-test.mjs <image>` prints the text it would write for one image.

If the text cannot be written (usage limit, no network) the image stays in the root and is tried again the next night. An image that cannot be opened goes to `failed/`.

## Posting (`post.mjs`, on GitHub)

Runs every 30 minutes from 08:07 to 12:37 UTC, plus 15:07 and 19:07 UTC for retries. A Pin goes out between its time and about 30 minutes after. A failed Pin is retried on every run; after 24 hours it moves to `failed/` and the calendar carries on. The next night scan moves its original from `scheduled/` to `failed/`.

## Going live (once the Pinterest app is approved)

1. Copy `.env.example` to `.env` and fill in `PINTEREST_APP_ID` and `PINTEREST_APP_SECRET`.
2. On the Pinterest app page, add `http://localhost:8080/callback` to the Redirect URIs.
3. Create a private GitHub repo for this folder and push it.
4. `npm run login`: approve in the browser. The tokens are saved in `.env` and the access token is sent to the GitHub secret `PINTEREST_ACCESS_TOKEN`.
5. `powershell -ExecutionPolicy Bypass -File install-task.ps1` registers the 02:00 scan.

## Settings (`config.json`)

Posting window, days between Pins, board name, how late a Pin may be, the caption model and the JPEG size. `apiBase` is `https://api.pinterest.com`; set it to `https://api-sandbox.pinterest.com` to test against the Pinterest sandbox.

## Tests

`npm test` (calendar rules, and the poster against a fake Pinterest API).

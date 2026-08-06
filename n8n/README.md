# n8n setup: Google Sheets to daily quote videos

Import [`zvid-daily-quote-reels.workflow.json`](zvid-daily-quote-reels.workflow.json)
into n8n. The workflow uses only built-in Schedule, Set, Code, IF, HTTP Request,
Wait, and Google Sheets nodes.

## Credentials

### Zvid API

Create a key at [https://app.zvid.io/api-keys](https://app.zvid.io/api-keys),
then create an n8n **Header Auth** credential:

- Header name: `x-api-key`
- Header value: your `zvid_…` key

Attach it to **Validate project (free)**, **Save draft to editor**,
**Submit render**, and **Get render status**.

### Google Sheets

Attach a standard Google Sheets OAuth credential to **Read quote sheet** and
**Mark row done**. Select the same spreadsheet and tab in both nodes.

Import [`../data/quotes.csv`](../data/quotes.csv) into a new Google Sheet to get
the exact headers and three pending examples. `Quote` and `Author` are required;
`AuthorNote` is optional. Leave `Status` and `VideoUrl` empty.

## First run

1. Open **Config** and set `channelName` and `ctaText`.
2. Recommended: set `dryRun` to `true` and execute manually. Validation and the
   editor draft are free; the Sheet remains unchanged.
3. Open the returned `editorLink` to review the draft.
4. Set `dryRun` to `false` and execute again. A short sample quote renders in
   about 10.8 seconds of video and costs approximately 11 credits.
5. Confirm that the first pending Sheet row now contains `Status = done` and a
   `VideoUrl`, while the next row remains empty.
6. Click **▶ Watch video** to play or download the MP4 inside n8n.
7. Activate the workflow after checking the instance timezone. The Schedule
   trigger is configured for 8am daily.

## Queue behavior

- Rows are read top to bottom.
- The first empty `Status` row is selected.
- Missing `Quote` or `Author` fails with the Sheet row number.
- A successful render writes `done` and the MP4 URL to the captured
  `row_number`.
- Dry runs and failed renders do not mark the row done.
- When every row has a Status, the workflow returns a friendly
  “nothing to render” result.

Do not sort or delete rows while a run is active. The update deliberately uses
the row number captured when the Sheet was read.

## Optional publishing

The required path stops after the Sheet write-back and the in-n8n video player.
To publish elsewhere, extend the workflow after **Mark row done** or
**Run summary** and pass along `videoUrl`. Any platform-specific credential is
optional and separate from this example.

For more templates, visit
[Zvid's n8n video automation workflows](https://zvid.io/n8n-workflows).

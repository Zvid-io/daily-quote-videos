# n8n setup: Google Sheets to daily quote videos

Import [`zvid-daily-quote-reels.workflow.json`](zvid-daily-quote-reels.workflow.json)
into n8n. Before configuring Zvid credentials, install **`@zvid/n8n-nodes-zvid`**
from **Settings → Community nodes**. A workspace owner/admin may need to install it.
The four supported Zvid operations use the published Zvid node. The final HTTP
Request node downloads completed media; it does not replace a supported Zvid action.

## Credentials

### Zvid API

Create a key at [https://app.zvid.io/api-keys](https://app.zvid.io/api-keys),
then create an n8n **Zvid API** credential using your key.

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
4. Set `dryRun` to `false` and execute again. The tested short sample produces
   10.8 seconds of video, with an 11-credit validation quote. This is output
   duration, not a render-time promise. Check the quote for your own project.
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
Avoid overlapping scheduled and manual runs: this Sheet queue has no atomic
row claim. A polling timeout can leave a render still running; check its existing
job before retrying. Review longer quotes for fit before publication.

## Optional publishing

The required path stops after the Sheet write-back and the in-n8n video player.
To publish elsewhere, extend the workflow after **Mark row done** or
**Run summary** and pass along `videoUrl`. Any platform-specific credential is
optional and separate from this example.

For more templates, visit
[Zvid's n8n video automation workflows](https://zvid.io/n8n/workflows).

- [Official template](https://n8n.io/workflows/19632-create-daily-quote-videos-from-google-sheets-with-zvid/)
- [Video walkthrough](https://youtu.be/Ra6mPdmDDYs)
- Support: https://zvid.io/contact

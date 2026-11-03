# Data.xlsx → Supabase live sync

This program watches **Data.xlsx** in the Performance Report folder. Every time the file is saved, it sends the changes to Supabase. Open dashboards on the website then refresh by themselves within a few seconds.

| Sheet in Data.xlsx | Supabase table | Matched on |
|---|---|---|
| site_tech_info | sites | Site Name |
| performance | performance | Site Name + Date (month) |
| Comments | performance (comment columns) | Site Name + Date (month) |
| OG | offtake_guarantees | Site Name |

The columns are mapped exactly like the CSV uploads in the dashboard. Only rows that changed since the last sync are sent.

## One-time setup (about 10 minutes)

1. **Turn on live updates in Supabase.** Open Supabase, go to SQL Editor and choose New query. Paste the contents of `realtime-setup.sql` and click Run. The result should list `sites`, `performance` and `offtake_guarantees`.
2. **Check Node.js.** Open Command Prompt and type `node -v`. If you see an error, install the LTS version from nodejs.org.
3. **Add the keys.**
   1. Copy `.env.example` to `C:\Users\<your name>\.sosimple-sync.env`. Keep it outside OneDrive, so the secret key isn't shared with everyone on the team drive.
   2. Open the file in Notepad and fill in `SUPABASE_URL`, which is the same value as in `my-app\.env.local`.
   3. Fill in `SUPABASE_SERVICE_ROLE_KEY`, found in Supabase under Project Settings, then API, as the "service_role" secret.
4. **Test without uploading.** Double-click `test-sync.bat`. It lists how many rows it found in each sheet and what it would send.
5. **Start it.** Double-click `start-sync.bat`. The first run sends everything, which takes about a minute. After that it says *Watching for changes…*. Leave the window open, or minimise it.
6. **Start it automatically when you log in (optional).**
   1. Press Win + R, type `shell:startup` and press Enter.
   2. In the folder that opens, right-click, choose New, then Shortcut, and point it to `start-sync.bat`.
   3. Open the shortcut's Properties and set Run to "Minimized".

## Daily use

- Edit **Data.xlsx** as usual and save (Ctrl + S). About 5 seconds later the website updates.
- A green **Live** badge in the dashboard's top bar means it is receiving updates, and shows the time of the last one.
- `sync.log` records every sync, and any rows that failed with the reason.
- `sync-once.bat` runs a single sync without watching.
- `npm run full` resends every row, which is useful after a database restore.

## Good to know

- **Your PC must be on.** The sync only runs while your PC is on and the window is open. When a colleague saves Data.xlsx, OneDrive downloads the change to your PC and the sync picks it up. You can also run the sync on a second PC; running it twice does no harm.
- **Deleted rows:** deleting a row in Excel does **not** delete it on the website. Remove it in Supabase, or ask for a "mirror" option to be added.
- **Formulas:** Excel saves the calculated results, which the sync reads, so performance %, expected kWh and OG values are always the latest.
- **Percentages:** cells formatted as % (for example Performance 77.0%) are stored as 77.0, the same as the CSV upload did.
- **Manual uploads still work:** the CSV upload buttons in the dashboard still work, and they also trigger the live refresh.
- **Key safety:** the service role key bypasses database security. Keep it only in your `.sosimple-sync.env`, and never in the my-app folder or in Git. To avoid it, set `SUPABASE_ANON_KEY`, `SYNC_EMAIL` and `SYNC_PASSWORD` for a portal employee account instead.

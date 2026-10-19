# Trackman Winter League

A small website for an indoor golf league: snap the Trackman scorecard after each round, and the standings rank every player on their best **y** Stableford rounds out of the **x** played. The winter is split into three competitions (autumn, Christmas, spring), and each one starts from zero.

- **The website** is one static page in `docs/`, hosted free on GitHub Pages.
- **The scores** live in a free Supabase database. Anyone with the link can see the standings; only players on the league list can add or fix rounds; only organisers can change competitions.
- **Photo reading** (optional) is a small Supabase function that sends the photo to Claude and fills in the score table. It needs an Anthropic API key, which stays on the server.

Try it without any setup: open `docs/index.html?demo` (or `https://<you>.github.io/<repo>/?demo` once it's online). The demo uses made-up players and saves nothing.

## Setup (about 20 minutes, once)

### 1. Create the database (Supabase, free)

1. Sign up at [supabase.com](https://supabase.com) and click **New project**. Pick a region near you (e.g. Europe West). Note the database password somewhere safe; you won't need it for this guide.
2. When the project is ready, open **SQL Editor**, paste the whole of [`supabase/schema.sql`](supabase/schema.sql), and click **Run**. This creates the tables, the access rules and the three competitions:

   | Competition | Dates | Rounds planned (x) | Best that count (y) |
   |---|---|---|---|
   | Autumn 2026 | 1 Nov – 15 Dec | 6 | 4 |
   | Christmas 2026 | 16 Dec – 15 Jan | 4 | 3 |
   | Spring 2027 | 16 Jan – 30 Apr | 15 | 10 |

   You can change these later on the page's **Competitions** tab.
3. Open **Table Editor → members** and add a row for each player: their **email** and **name**. Tick **is_admin** for yourself (and anyone else who should manage competitions).
4. Open **Project Settings → API** (or **Data API**) and copy the **Project URL** and the **anon / publishable** key.

### 2. Put the page on GitHub Pages

1. Fill in `docs/config.js` with the URL and key from step 1.4. (Both are meant to be public; the access rules protect the data.)
2. Create a repository on GitHub (e.g. `winter-league`) and push this folder to it:

   ```bash
   git init && git add . && git commit -m "Trackman Winter League"
   ```

   ```bash
   git branch -M main && git remote add origin https://github.com/<you>/winter-league.git && git push -u origin main
   ```

3. On GitHub, open **Settings → Pages**, set **Source: Deploy from a branch**, branch **main**, folder **/docs**, and save. After a minute the site is at `https://<you>.github.io/winter-league/`.

### 3. Turn on email sign-in

Players sign in with a link emailed to them (no passwords).

1. In Supabase, open **Authentication → URL Configuration**. Set **Site URL** to your GitHub Pages address (e.g. `https://<you>.github.io/winter-league/`) and add the same address under **Redirect URLs**.
2. Email sign-in is on by default (**Authentication → Sign In / Providers → Email**).

Supabase's built-in email sender only sends a few emails per hour. That's enough for a league, since people stay signed in on their phone. If it ever gets in the way, connect a free email service under **Authentication → Emails → SMTP Settings** (Resend and Brevo both have free plans).

### 4. Photo reading with Claude (optional)

Without this step everything works; players type the scores in by hand. With it, a player picks a photo of the scorecard and the table fills itself in for them to check.

1. Get an API key at [console.anthropic.com](https://console.anthropic.com) (**API Keys → Create Key**) and add a little credit under **Billing**. A scorecard read costs a few US cents, so a winter of weekly rounds comes to a dollar or two. Set a monthly spend limit in the console if you like.
2. Install the Supabase command-line tool (on a Mac: `brew install supabase/tap/supabase`), then from this folder:

   ```bash
   supabase login
   ```

   ```bash
   supabase link --project-ref <your-project-ref>
   ```

   ```bash
   supabase secrets set ANTHROPIC_API_KEY=<your-anthropic-key>
   ```

   ```bash
   supabase functions deploy read-scorecard
   ```

   The project ref is the `abcdefghijkl` part of your Supabase URL.

The function checks that the caller is signed in and on the members list before it reads anything, so strangers can't spend your API credit. It uses Claude Opus 5.5 with Anthropic's automatic fallback switched on: if a safety check ever declined a photo, the request is retried on another Claude model instead of failing. If you skip this step, set `photoReading: false` in `docs/config.js` to hide the photo box.

## Running the league

- **After a round:** open the site, **Add round**, choose the photo, **Read scorecard**, check the numbers, **Save round**. Anyone on the list can also edit or delete a round from the **Rounds** tab.
- **New player:** add their email in Supabase **Table Editor → members**.
- **Names:** a player is matched by name, so keep spellings consistent ("Jon" and "jon" count as one player; "Jón" and "Jon" count as two). The name box suggests names already used.
- **Ranking:** Stableford is ranked on the total of each player's best y rounds in that competition. Ties go to the better best counting round, then the next best. The Gross view ranks the lowest average gross over the best y rounds.
- **Next winter:** add new competitions on the Competitions tab; old ones stay viewable.

## Files

| Path | What it is |
|---|---|
| `docs/index.html` | The website |
| `docs/standings.js` | The ranking rules (best y of x, tie-breaks) |
| `docs/config.js` | Your Supabase URL and public key |
| `supabase/schema.sql` | Tables, access rules and the three competitions |
| `supabase/functions/read-scorecard/` | The Claude photo reader |
| `claude-artifact/` | The earlier claude.ai version, kept for reference |

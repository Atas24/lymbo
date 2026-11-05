# Lymbo

Desktop app for an assisted job search. **KASPR** finds jobs that fit you, **SONNY** helps tailor your resume and cover letters, and the **Control Room** keeps your resumes, application timeline and stats. Everything is stored on your computer. The agents use your own Anthropic API key, which is kept in your system keychain.

## What works in v0.1

- **Control Room:** resume library (newest one is "current"), application timeline with status, saved cover letters, stats (jobs applied, SONNY workshops, time applying, estimated API spend), and the **KILL SWITCH**.
- **Sessions:** the agents only work during a session you start. The kill switch (or End session) stops the session right away. Any agent reply still on its way is thrown out.
- **KASPR + Handshake:** you give KASPR your Handshake login (school sign-in or Handshake password). It's stored in your Keychain. KASPR opens a Chrome window, signs you in, asks where you want to work, searches Handshake, and goes through jobs one at a time, scoring each against your resume and location. You open the job and click Apply yourself, then tell KASPR you applied.
  - If your school uses Duo or other 2-factor, KASPR stops and you approve it, then click **I'm signed in**.
  - The first time Handshake sends KASPR to your school's login page, it asks before typing your login there.
  - KASPR pauses a few seconds between page loads, only browses joinhandshake.com, and never clicks Apply or Submit.
  - If it can't find job listings (Handshake changes its pages sometimes), search in the Chrome window yourself and click **read that page**.
  - The Chrome window starts fresh every time, so you're signed in again each time you open the app.
  - You can still paste a job by hand under **Paste a job instead**.
- **SONNY:** pops up if your resume should be tailored for a job KASPR recommended. In the workshop it lists missing keywords and suggests specific edits (it never edits for you), and drafts cover letters on request.
- **Settings:** add/replace/remove your API key (checked with Anthropic before it's saved), pick the model, set a per-session spending limit, and set token prices for cost estimates.

**Needs testing on a real Handshake account:** the login steps and job search were tested against mock pages, not the live site. If something doesn't match Handshake's real pages, KASPR stops and hands you control instead of guessing. Tell Claude what happened and it can be adjusted.

## Run it on your Mac (first time)

You need Xcode Command Line Tools, Rust, Node, and Google Chrome (KASPR drives it for Handshake):

```bash
xcode-select --install
curl --proto '=https' --tlsv1.2 https://sh.rustup.rs -sSf | sh
brew install node        # or the LTS installer from nodejs.org
```

Then, in this folder:

```bash
cd ~/Desktop/lymbo
npm install
npm run tauri dev
```

The first `tauri dev` compiles everything and takes a few minutes. After that it's quick, and the window reloads when you edit the React code.

Once it opens:

1. Go to **Settings** and paste your Anthropic API key (from console.anthropic.com).
2. Check the **model name** and prices. The default is `claude-sonnet-4-5`. Change it if Anthropic has a newer model you'd rather use.
3. Add your resume in the **Control Room** (paste the text).
4. Click **Start session**, then open **KASPR**, save your Handshake login, and click **Connect**.

## Build an installer

```bash
npm run tauri build
```

The `.dmg` and `.app` end up in `src-tauri/target/release/bundle/`. Windows installers have to be built on Windows. The easiest way is a GitHub Actions workflow, which we can add later.

The app isn't code-signed, so macOS will warn that the developer can't be verified. Right-click the app and choose **Open** to get past it.

## Where things are

```
src/                     React + TypeScript UI
  App.tsx                app shell, session bar, SONNY's listener for KASPR handoffs
  pages/                 ControlRoom, KasprPage, SonnyPage, SettingsPage
  components/Sprites.tsx pixel-art KASPR and SONNY (edit the grids to redraw them)
  lib/prompts.ts         what each agent is told — tune these
  lib/agents.ts          KASPR/SONNY calls
  lib/bus.ts             structured messages between agents
src-tauri/src/           Rust backend
  commands.rs            everything the UI can call
  db.rs                  SQLite tables (resumes, applications, cover_letters, kv)
  keys.rs                API key + Handshake login in Keychain / Credential Manager
  ai.rs                  shared Anthropic client used by both agents
  handshake.rs           KASPR's Chrome control: login, search, reading jobs (selectors live here)
  session.rs             session state for the kill switch and cost tracking
```

Your data lives in `~/Library/Application Support/com.lymbo.app/lymbo.db`, so updating the app doesn't touch it.

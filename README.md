# Lymbo

A desktop app that helps you find and apply to jobs on Handshake, with two assistants:

- **KASPR** signs in to Handshake for you, searches for jobs, and goes through them one at a time. It scores each one against your resume and where you want to work. You always click Apply yourself.
- **SONNY** shows which of a job's keywords your resume covers and which it's missing. It suggests specific edits and drafts cover letters. It never changes your resume on its own.

Everything else lives in the **Control Room**: your resumes (uploaded as PDFs), the jobs you've applied to and their status, saved cover letters, and a kill switch that stops everything immediately.

## Download

Get the latest version from the [Releases page](https://github.com/Atas24/lymbo/releases/latest).

- **Mac:** download the `.dmg`, open it, and drag Lymbo into Applications. The first time, right-click Lymbo and choose **Open** (the app isn't signed by Apple, so macOS asks once).
- **Windows:** download the `-setup.exe` and run it. If SmartScreen warns you, click **More info → Run anyway**.

Lymbo updates itself. When a new version is out, it offers to install it the next time you open the app. Your data stays put.

## What you need

- **Google Chrome.** KASPR uses a Chrome window for Handshake.
- **An Anthropic API key** from [console.anthropic.com](https://console.anthropic.com), with a few dollars of credit. You don't need a Claude subscription. You pay Anthropic directly for what the assistants use, usually about a cent or less per job. Lymbo shows the running cost and lets you set a spending limit.
- **A Handshake account.**

## Getting started

1. Open **Settings** and paste your API key.
2. Upload your resume PDF in the **Control Room**.
3. Click **Start session**, open **KASPR**, save your Handshake login, and click **Connect**.
4. Tell KASPR where you want to work, search, and go through the jobs.

If your school uses Duo or another 2-factor step, approve it when Chrome asks, then click **I'm signed in**.

## Privacy

- Your resumes, applications and settings are stored only on your computer.
- Your API key and Handshake login are kept in your system keychain (Keychain on Mac, Credential Manager on Windows). Your login is only typed into Handshake, or into your school's sign-in page after you approve it. It's never sent to the AI.
- When KASPR or SONNY needs the AI, Lymbo sends only what that step needs (your resume text and the job description) to Anthropic.
- Keyword matching runs on your computer and isn't sent anywhere.

## How KASPR behaves on Handshake

- It only works while you have a session running, never in the background.
- It waits a few seconds between pages, like a person would.
- It only browses joinhandshake.com and only reads what you could see yourself.
- It never clicks Apply or Submit.
- If a page doesn't look the way it expects, it stops and hands control back to you instead of guessing.
  ai.rs                    Anthropic client
  commands.rs              everything the UI can call
  db.rs                    SQLite: resumes, applications, cover letters, cache
  keys.rs                  API key and Handshake login in the system keychain
.github/workflows/         release builds
```

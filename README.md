# Lymbo

A desktop app that helps you find and apply to jobs on Handshake, with two assistants:

- **KASPR** signs in to Handshake for you, searches for jobs based on your resume, and flies you through them one at a time from a spaceship cockpit. Each job is a planet; the dashboard shows which of your resumes to use and how well it matches. You always click Apply yourself.
- **SONNY** builds tailored versions of your resume. After KASPR reads a batch of jobs, SONNY sorts them by kind of role (say, "Data Analyst" and "Sports Science Research") and drafts a version of your Word resume for each, keeping your formatting. You approve each version once. After that, KASPR matches new jobs to the right version on its own, and SONNY only steps in for a kind of role it hasn't seen. SONNY also shows keyword coverage for any job and drafts cover letters on request.

Everything else lives in the **Control Room**: your resumes, the jobs you've applied to (and which resume version you used), saved cover letters, and a kill switch that stops everything immediately.

## Download

Get the latest version from the [Releases page](https://github.com/Atas24/lymbo/releases/latest).

- **Mac:** download the `.dmg`, open it, and drag Lymbo into Applications. The first time, right-click Lymbo and choose **Open** (the app isn't signed by Apple, so macOS asks once).
- **Windows:** download the `-setup.exe` and run it. If SmartScreen warns you, click **More info → Run anyway**.

Lymbo updates itself. When a new version is out, it offers to install it the next time you open the app. Your data stays put.

## What you need

- **Google Chrome.** KASPR uses a Chrome window for Handshake.
- **Optional: Microsoft Word or LibreOffice**, so Lymbo can save each resume version as a PDF automatically. Without either, you get the Word file and can save it as PDF yourself.
- **An Anthropic API key** from [console.anthropic.com](https://console.anthropic.com), with a few dollars of credit. You don't need a Claude subscription. You pay Anthropic directly for what the assistants use, usually about a cent or less per job. Lymbo shows the running cost and lets you set a spending limit.
- **A Handshake account.**

## Getting started

1. Open **Settings** and paste your API key.
2. Upload your resume in the **Control Room**. Use the Word file (.docx) so SONNY can make tailored versions of it. A PDF works too, but then SONNY can't make versions.
3. Click **Start session**, open **KASPR**, save your Handshake login, and click **Connect**.
4. Pick where you want to work and whether you want internships or full-time jobs, set how specific KASPR should be, and hit **Find jobs**.
5. Go through the jobs with **Next planet**. If none of your resumes fit a job, click **Work with SONNY**.

New to Lymbo? The first time you open it, you can take a short tour that walks through each screen. You can replay it anytime from **Settings**.

If your school uses Duo or another 2-factor step, approve it when Chrome asks, then click **I'm signed in**.

## Privacy

- Your resumes, applications and settings are stored only on your computer.
- Your API key and Handshake login are kept in your system keychain (Keychain on Mac, Credential Manager on Windows). Your login is only typed into Handshake, or into your school's sign-in page after you approve it. It's never sent to the AI.
- When KASPR or SONNY needs the AI, Lymbo sends only what that step needs (your resume text and the job description) to Anthropic.
- Keyword matching, and choosing which resume version fits a job, run on your computer and aren't sent anywhere.

## How KASPR behaves on Handshake

- It only works while you have a session running, never in the background.
- It waits a few seconds between pages, like a person would.
- It only browses joinhandshake.com and only reads what you could see yourself.
- It never clicks Apply or Submit.
- If a page doesn't look the way it expects, it stops and hands control back to you instead of guessing.

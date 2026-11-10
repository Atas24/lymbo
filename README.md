# Lymbo

A desktop app that helps you apply to jobs on Handshake, with two assistants:

- **KASPR** signs you in to Handshake in a Chrome window, then watches the jobs you open. The moment you open one, he reads it and tells you which of your resumes to use and why. He also shows the skills the job asks for that you have and don't have, and checks details like degree, graduation date, GPA, pay and location against your resume. KASPR never clicks or browses on his own, and you always click Apply yourself.
- **SONNY** tailors your resume and writes cover letters. Both buttons are on every job: **Tailor with SONNY** drafts a version of your Word resume for that job, keeping your formatting, and **Cover letter with SONNY** writes a cover letter for it. You approve each resume version once. After that, KASPR compares every job against it too.

Everything else lives in the **Control Room**: your resume, the jobs you've applied to (and which resume you used), saved cover letters, and a kill switch that stops everything immediately.

## Download

Get the latest version from the [Releases page](https://github.com/Atas24/lymbo/releases/latest).

- **Mac:** download the `.dmg`, open it, and drag Lymbo into Applications. The first time, right-click Lymbo and choose **Open** (the app isn't signed by Apple, so macOS asks once).
- **Windows:** download the `-setup.exe` and run it. If SmartScreen warns you, click **More info → Run anyway**.

When a new version is out, Lymbo offers to install it the next time you open the app. If your Mac blocks it, Lymbo gives you a link to download it instead: drag it into Applications and choose **Replace**. Your data stays put either way.

## What you need

- **Google Chrome.** KASPR uses a Chrome window for Handshake.
- **Optional: Microsoft Word or LibreOffice**, so Lymbo can save each resume version as a PDF automatically. Without either, you get the Word file and can save it as PDF yourself.
- **An Anthropic API key** from [console.anthropic.com](https://console.anthropic.com), with a few dollars of credit. You don't need a Claude subscription. You pay Anthropic directly for what SONNY uses, a few cents per tailored resume or cover letter. KASPR's checks run on your computer and are free. Lymbo shows the running cost and lets you set a spending limit.
- **A Handshake account.**

## Getting started

1. Open **Settings** and paste your API key.
2. Upload your resume in the **Control Room**. Use the Word file (.docx) so SONNY can make tailored versions of it. A PDF works too, but then SONNY can't make versions.
3. Click **Start session**, open **KASPR**, save your Handshake login, and click **Connect**.
4. Browse Handshake in the Chrome window like you normally would, and open any job. KASPR shows which resume to use right away.
5. Click **Tailor with SONNY** or **Cover letter with SONNY** on any job. When you've applied, click **I applied** to add it to your timeline.

For jobs that aren't on Handshake, use **Paste a job instead** on KASPR's screen.

New to Lymbo? The first time you open it, you can take a short tour that walks through each screen. You can replay it anytime from **Settings**.

If your school uses Duo or another 2-factor step, approve it when Chrome asks, then click **I'm signed in**.

## Privacy

- Your resumes, applications and settings are stored only on your computer.
- Your API key and Handshake login are kept in your system keychain (Keychain on Mac, Credential Manager on Windows). Your login is only typed into Handshake, or into your school's sign-in page after you approve it. It's never sent to the AI.
- KASPR's checks run on your computer and aren't sent anywhere.
- When SONNY works on a job, Lymbo sends only your resume text and that job's description to Anthropic.
- SONNY is AI and can get things wrong. Read what he writes before you send it.

## How KASPR behaves on Handshake

- He only works while you have a session running, never in the background.
- He only reads the job you have open in the Chrome window. He doesn't search, open pages, or click anything.
- He never clicks Apply or Submit.

---

Lymbo is an independent project. It isn't affiliated with or endorsed by Handshake or Anthropic.

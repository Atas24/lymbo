#!/bin/bash
# One-time setup for Lymbo's auto-updater. Run from the lymbo folder:
#   bash scripts/setup-updates.sh
# It makes an update-signing key, stores it as GitHub secrets, puts the public
# half in the app's config, and makes the repo public so apps can download updates.
set -e
cd "$(dirname "$0")/.."
REPO="Atas24/lymbo"
KEY="$HOME/.tauri/lymbo.key"

echo "== 1/4  Update-signing key"
if [ -f "$KEY" ]; then
  echo "Found an existing key at $KEY — using it."
else
  mkdir -p "$HOME/.tauri"
  echo "Choose a password for the key (you'll type it twice). Nothing shows while you type."
  npx tauri signer generate -w "$KEY"
fi
echo
read -r -s -p "Type the key's password once more so it can be saved to GitHub: " PW
echo

echo "== 2/4  Saving the key to GitHub (as encrypted secrets)"
gh secret set TAURI_SIGNING_PRIVATE_KEY --repo "$REPO" < "$KEY"
printf '%s' "$PW" | gh secret set TAURI_SIGNING_PRIVATE_KEY_PASSWORD --repo "$REPO"

echo "== 3/4  Putting the public key in the app's config"
PUB="$(cat "$KEY.pub")" node -e '
  const fs = require("fs"); const p = "src-tauri/tauri.conf.json";
  const c = JSON.parse(fs.readFileSync(p, "utf8"));
  c.plugins.updater.pubkey = process.env.PUB.trim();
  fs.writeFileSync(p, JSON.stringify(c, null, 2) + "\n");'

echo "== 4/4  Making the repo public so apps can fetch updates"
gh repo edit "$REPO" --visibility public --accept-visibility-change-consequences

echo
echo "Done. KEEP $KEY AND ITS PASSWORD SAFE (e.g. in your password manager)."
echo "Without them you can't ship updates to people who already installed Lymbo."

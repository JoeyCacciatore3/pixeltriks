#!/usr/bin/env bash
# Forge Studio — end-to-end runtime test.
# Injects tests/e2e.js into a copy of index.html, drives the real app in
# headless Chrome, and prints pass/fail per feature.
#
# Usage:  bash tests/run-e2e.sh
#
# Note: WebP export may report a false "timeout" under headless --virtual-time-budget
# (virtual timers fast-forward past the real WebP encoder). It works in real browsers.
set -e
cd "$(dirname "$0")/.."
CHROME="${CHROME:-google-chrome-stable}"

node -e 'const fs=require("fs");let h=fs.readFileSync("index.html","utf8");fs.writeFileSync("index-e2e.html",h.replace("</body>","<script src=\"tests/e2e.js\"></script>\n</body>"));'
OUT=$("$CHROME" --headless=new --disable-gpu --no-sandbox --allow-file-access-from-files \
  --window-size=1280,820 --virtual-time-budget=90000 \
  --dump-dom "file://$PWD/index-e2e.html" 2>/dev/null)
rm -f index-e2e.html

echo "$OUT" | grep -oE "<title>[^<]*" | sed 's/<title>//'
echo "$OUT" | sed -n 's/.*<pre id="RESULTS">\(.*\)<\/pre>.*/\1/p' | python3 -c "import sys,html,json
raw=html.unescape(sys.stdin.read()).strip()
if not raw: print('NO RESULTS'); sys.exit(1)
d=json.loads(raw)
print('PASS %d / %d'%(d['pass'],d['total']))
for f in d['failures']: print('  FAIL:',f['name'],'::',f['info'])"

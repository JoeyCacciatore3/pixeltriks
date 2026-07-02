#!/usr/bin/env bash
# Forge Studio — user-flow audit.
# Drives the app like a real user (genuine pointer drags, dialogs, keyboard) and
# reports every console error / warning / uncaught exception, tagged with the flow.
#
# Usage:  bash tests/run-userflow.sh
set -e
cd "$(dirname "$0")/.."
CHROME="${CHROME:-google-chrome-stable}"
TMP="$(mktemp -d)"

node -e 'const fs=require("fs");let h=fs.readFileSync("index.html","utf8");fs.writeFileSync("index-flow.html",h.replace("</body>","<script src=\"tests/userflow.js\"></script>\n</body>"));'
timeout 110 "$CHROME" --headless=new --disable-gpu --no-sandbox --allow-file-access-from-files \
  --window-size=1280,820 --virtual-time-budget=20000 \
  --dump-dom "file://$PWD/index-flow.html" > "$TMP/dom.html" 2>/dev/null || true
rm -f index-flow.html

grep -oE "<title>[^<]*</title>" "$TMP/dom.html" | sed 's/<[^>]*>//g'
python3 - "$TMP/dom.html" <<'PY'
import sys,html,json,re
out=open(sys.argv[1]).read()
m=re.search(r'<pre id="RESULTS">(.*?)</pre>', out, re.S)
if not m: print("NO RESULTS BLOCK (run may have hung)"); sys.exit(1)
d=json.loads(html.unescape(m.group(1)))
print("ran=%s lastStep=%s  ISSUES=%d SOFT=%d"%(d.get('tag'),d.get('lastStep'),len(d['issues']),len(d.get('soft',[]))))
for e in d['issues']: print("  [%s] %s :: %s"%(e['level'],e['step'],e['msg']))
for e in d.get('soft',[]): print("  [soft] %s :: %s"%(e['step'],e['msg']))
PY
rm -rf "$TMP"

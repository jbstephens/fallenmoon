#!/bin/bash
# Assemble the single self-contained index.html from source parts.
# three.min.js (r147, vendored) is inlined verbatim into its own <script> block.
set -euo pipefail
DIR="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$DIR/test/src"
OUT="$DIR/index.html"
{
  cat "$SRC/p1-head.html"
  printf '<script>\n'
  cat "$DIR/three.min.js"
  printf '\n</script>\n'
  cat "$SRC/p2-core.html" "$SRC/p3-art.html" "$SRC/p4-world.html" \
      "$SRC/p5-ent.html" "$SRC/p6-game.html" "$SRC/p6b-forest.html" "$SRC/p6c-tide.html" \
      "$SRC/p6d-sea.html" "$SRC/p6e-isles.html" "$SRC/p6f-lamp.html" \
      "$SRC/p6g-crown.html" "$SRC/p6h-green.html" \
      "$SRC/p6i-mouth.html" "$SRC/p6j-night.html" \
      "$SRC/p6k-stars.html" \
      "$SRC/p6l-moth.html" \
      "$SRC/p6m-bone.html" \
      "$SRC/p6n-coin.html" \
      "$SRC/p7-flow.html"
} > "$OUT"
echo "built $OUT ($(wc -c < "$OUT") bytes)"

# node --check every inline script block except the vendored three.min.js one
node - "$OUT" <<'EOF'
const fs = require('fs'), cp = require('child_process'), os = require('os'), path = require('path');
const html = fs.readFileSync(process.argv[2], 'utf8');
const blocks = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
let checked = 0;
for (const b of blocks) {
  if (b.includes('three.js Authors') || b.length > 400000) continue; // vendored lib
  const f = path.join(os.tmpdir(), 'fm-check-' + (checked++) + '.js');
  fs.writeFileSync(f, b);
  const r = cp.spawnSync('node', ['--check', f], { encoding: 'utf8' });
  if (r.status !== 0) { console.error('SYNTAX FAIL block', checked, '\n', r.stderr); process.exit(1); }
}
console.log('node --check passed on', checked, 'inline game script block(s)');
EOF

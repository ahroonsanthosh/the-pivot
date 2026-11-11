#!/bin/sh
# Builds the single-file simulator from sim/src.
#   sim/wearable-aps-sim.html  page without a document skeleton (the artifact host adds one)
#   sim/index.html             the same page wrapped in a full HTML document; opens straight from disk
# Markers in src/page.html:
#   <!-- @css file -->            inlined as <style>
#   <!-- @js file -->             inlined as <script>
#   <!-- @app file file ... -->   concatenated into one <script> inside a single strict-mode IIFE
set -eu
cd "$(dirname "$0")"
awk '
  function emit(f,   line) { while ((getline line < f) > 0) print line; close(f) }
  /<!-- @css / { print "<style>"; emit($3); print "</style>"; next }
  /<!-- @js /  { print "<script>"; emit($3); print "</script>"; next }
  /<!-- @app / { print "<script>"; print "(() => {"; print "\"use strict\";"; for (i = 3; i < NF; i++) emit($i); print "})();"; print "</script>"; next }
  { print }
' src/page.html > wearable-aps-sim.html
{
  printf '<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n</head>\n<body>\n'
  cat wearable-aps-sim.html
  printf '\n</body>\n</html>\n'
} > index.html
echo "built sim/wearable-aps-sim.html and sim/index.html"

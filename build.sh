#!/bin/bash
# Inject Supabase anon key into any HTML file that still has the placeholder.
# dashboard.html no longer uses frontend Supabase auth (PIN lock migration).
# SUPABASE_ANON_KEY is set in Netlify → Site Configuration → Environment Variables.

set -e

echo "build.sh: starting"
echo "build.sh: working directory = $(pwd)"

if [ -z "$SUPABASE_ANON_KEY" ]; then
  echo "ERROR: SUPABASE_ANON_KEY environment variable is not set." >&2
  exit 1
fi

echo "build.sh: SUPABASE_ANON_KEY is set (length=${#SUPABASE_ANON_KEY})"

# Replace placeholder in any HTML file that contains it (skip dashboard.html — PIN auth migration removed it)
REPLACED=0
for f in *.html; do
  if grep -q "SUPABASE_ANON_PLACEHOLDER" "$f" 2>/dev/null; then
    sed -i "s|SUPABASE_ANON_PLACEHOLDER|${SUPABASE_ANON_KEY}|g" "$f"
    echo "build.sh: injected SUPABASE_ANON_KEY into $f"
    REPLACED=$((REPLACED + 1))
  fi
done

if [ "$REPLACED" -eq 0 ]; then
  echo "build.sh: no files contained SUPABASE_ANON_PLACEHOLDER — skipping injection (PIN auth migration complete)"
fi

echo "build.sh: done"

#!/bin/bash
# Inject Supabase anon key into dashboard.html at build time.
# SUPABASE_ANON_KEY is set in Netlify → Site Configuration → Environment Variables.
# The real key never touches the repo.

set -e

echo "build.sh: starting"
echo "build.sh: working directory = $(pwd)"
echo "build.sh: dashboard.html exists = $(test -f dashboard.html && echo YES || echo NO)"

if [ -z "$SUPABASE_ANON_KEY" ]; then
  echo "ERROR: SUPABASE_ANON_KEY environment variable is not set." >&2
  exit 1
fi

echo "build.sh: SUPABASE_ANON_KEY is set (length=${#SUPABASE_ANON_KEY})"

# Confirm placeholder is present before replacing
if ! grep -q "SUPABASE_ANON_PLACEHOLDER" dashboard.html; then
  echo "ERROR: SUPABASE_ANON_PLACEHOLDER token not found in dashboard.html — was it already replaced or is the file missing?" >&2
  exit 1
fi

sed -i "s|SUPABASE_ANON_PLACEHOLDER|${SUPABASE_ANON_KEY}|g" dashboard.html

# Verify replacement succeeded
if grep -q "SUPABASE_ANON_PLACEHOLDER" dashboard.html; then
  echo "ERROR: placeholder still present after sed — replacement failed." >&2
  exit 1
fi

echo "build.sh: SUPABASE_ANON_KEY injected into dashboard.html — OK"

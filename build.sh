#!/bin/bash
# Inject Supabase anon key into dashboard.html at build time.
# SUPABASE_ANON_KEY is set in Netlify → Site Configuration → Environment Variables.
# The real key never touches the repo.

set -e

if [ -z "$SUPABASE_ANON_KEY" ]; then
  echo "ERROR: SUPABASE_ANON_KEY environment variable is not set." >&2
  exit 1
fi

sed -i "s/SUPABASE_ANON_PLACEHOLDER/${SUPABASE_ANON_KEY}/" dashboard.html

echo "build.sh: SUPABASE_ANON_KEY injected into dashboard.html"

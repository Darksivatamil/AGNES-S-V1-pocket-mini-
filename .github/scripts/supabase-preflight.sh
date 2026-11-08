#!/usr/bin/env bash
# Determines whether the remote database already has the AGNES schema.
#
# Outputs one of:
#   state=full     all tables and both RPCs exist (safe to baseline)
#   state=empty    no AGNES tables exist (migrations should apply)
#   state=partial  some objects exist (do not guess; repair manually)
#
# Uses only the public publishable key. A table that exists but is protected by
# RLS/grants returns 401/403, which is still proof that the table exists.
set -euo pipefail

: "${SUPABASE_URL:?SUPABASE_URL is required}"
: "${SUPABASE_PUBLISHABLE_KEY:?SUPABASE_PUBLISHABLE_KEY is required}"

url="${SUPABASE_URL%/}"
key="$SUPABASE_PUBLISHABLE_KEY"

probe_table() {
  local table="$1" code
  code=$(curl -sS --retry 3 --retry-delay 2 -o /dev/null -w "%{http_code}" \
    "$url/rest/v1/$table?select=*&limit=0" -H "apikey: $key")
  case "$code" in
    200|401|403) return 0 ;;
    404) return 1 ;;
    *) echo "Unexpected HTTP $code while probing table $table" >&2; return 2 ;;
  esac
}

probe_rpc() {
  local name="$1" data="$2" code
  code=$(curl -sS --retry 3 --retry-delay 2 -o /dev/null -w "%{http_code}" \
    -X POST "$url/rest/v1/rpc/$name" \
    -H "apikey: $key" -H "Content-Type: application/json" --data "$data")
  case "$code" in
    200|401|403) return 0 ;;
    404) return 1 ;;
    *) echo "Unexpected HTTP $code while probing RPC $name" >&2; return 2 ;;
  esac
}

mapfile -t tables < <(
  sed -nE 's/^create table public\.([a-z_]+).*/\1/p' supabase/migrations/*.sql | sort -u
)
if [ "${#tables[@]}" -eq 0 ]; then
  echo "No table definitions found in supabase/migrations" >&2
  exit 2
fi

present=0
missing=0
for table in "${tables[@]}"; do
  if probe_table "$table"; then
    present=$((present + 1))
  else
    rc=$?
    if [ "$rc" -eq 1 ]; then
      missing=$((missing + 1))
    else
      exit 2
    fi
  fi
done

rpcs_present=0
rpcs_missing=0
check_rpc() {
  local name="$1" data="$2"
  if probe_rpc "$name" "$data"; then
    rpcs_present=$((rpcs_present + 1))
  else
    rc=$?
    if [ "$rc" -eq 1 ]; then
      rpcs_missing=$((rpcs_missing + 1))
    else
      exit 2
    fi
  fi
}

rate_limit_data='{"p_bucket":"ci-preflight-probe-12345","p_limit":1,"p_window_seconds":60}'
finalize_data='{"p_user_id":null,"p_conversation_id":null,"p_user_content":null,"p_user_source":null,"p_user_metadata":null,"p_assistant_content":null,"p_assistant_metadata":null,"p_provider":null,"p_model":null,"p_emotion":null,"p_animation":null,"p_intensity":null,"p_mood_delta":null,"p_question":null,"p_question_expires":null,"p_answered_question_id":null,"p_selected_option_id":null,"p_request_id":null,"p_usage":null,"p_conversation_title":null}'

check_rpc agnes_rate_limit "$rate_limit_data"
check_rpc agnes_finalize_chat "$finalize_data"

echo "tables: $present present, $missing missing, ${#tables[@]} total"
echo "rpcs:   $rpcs_present present, $rpcs_missing missing, 2 total"

if [ "$present" -eq "${#tables[@]}" ] && [ "$rpcs_present" -eq 2 ]; then
  state="full"
elif [ "$present" -eq 0 ]; then
  state="empty"
else
  state="partial"
fi

echo "state=$state"
if [ -n "${GITHUB_OUTPUT:-}" ]; then
  echo "state=$state" >> "$GITHUB_OUTPUT"
fi

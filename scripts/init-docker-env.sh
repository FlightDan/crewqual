#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

if [[ -e .env ]]; then
  echo ".env already exists; refusing to overwrite it" >&2
  exit 1
fi
for command_name in openssl base32; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "$command_name is required" >&2
    exit 1
  fi
done

read -r -p "Public domain (for example crewqual.example.com): " app_domain
read -r -p "TLS notification email: " tls_email
read -r -p "S3 HTTPS endpoint: " s3_endpoint
read -r -p "S3 region [us-east-1]: " s3_region
s3_region=${s3_region:-us-east-1}
read -r -p "S3 private bucket [crewqual-private]: " s3_bucket
s3_bucket=${s3_bucket:-crewqual-private}
read -r -p "S3 access key ID: " s3_access_key_id
read -r -s -p "S3 secret access key: " s3_secret_access_key
echo
read -r -p "SMS webhook HTTPS URL: " sms_webhook_url
read -r -s -p "SMS webhook auth token (optional): " sms_webhook_auth_token
echo
read -r -p "Initial super-admin email: " initial_admin_email

if [[ -z "$app_domain" || "$app_domain" == *://* || "$app_domain" == */* ]]; then
  echo "Public domain must be a hostname without scheme or path" >&2
  exit 1
fi
if [[ "$s3_endpoint" != https://* ]]; then
  echo "Production S3 endpoint must use HTTPS" >&2
  exit 1
fi
if [[ "$sms_webhook_url" != https://* ]]; then
  echo "Production SMS webhook URL must use HTTPS" >&2
  exit 1
fi
if (( ${#s3_secret_access_key} < 16 )); then
  echo "S3 secret access key must contain at least 16 characters" >&2
  exit 1
fi
for value in \
  "$app_domain" "$tls_email" "$s3_endpoint" "$s3_region" "$s3_bucket" \
  "$s3_access_key_id" "$s3_secret_access_key" "$sms_webhook_url" \
  "$sms_webhook_auth_token" "$initial_admin_email"; do
  if [[ "$value" == *"'"* || "$value" == *$'\n'* || "$value" == *$'\r'* ]]; then
    echo "Values may not contain single quotes or newlines" >&2
    exit 1
  fi
done

postgres_password=$(openssl rand -hex 32)
session_secret=$(openssl rand -hex 48)
settings_encryption_key=$(openssl rand -hex 32)
initial_admin_password=$(openssl rand -hex 24)
initial_admin_totp_secret=$(openssl rand 20 | base32 | tr -d '=\n')

umask 077
{
  printf '%s\n' "NODE_ENV=production" "SERVICE_MODE=remote" "NEXT_PUBLIC_SERVICE_MODE=remote"
  printf "APP_ORIGIN='https://%s'\nAPP_DOMAIN='%s'\nTLS_EMAIL='%s'\n" \
    "$app_domain" "$app_domain" "$tls_email"
  printf "POSTGRES_PASSWORD='%s'\n" "$postgres_password"
  printf "DATABASE_URL='postgresql://crewqual:%s@postgres:5432/crewqual'\n" "$postgres_password"
  printf "DIRECT_URL='postgresql://crewqual:%s@postgres:5432/crewqual'\n" "$postgres_password"
  printf "SESSION_SECRET='%s'\nSETTINGS_ENCRYPTION_KEY='%s'\n" \
    "$session_secret" "$settings_encryption_key"
  printf '%s\n' "PILOT_SESSION_TTL_MINUTES=60" "ADMIN_SESSION_TTL_HOURS=8"
  printf "S3_ENDPOINT='%s'\nS3_REGION='%s'\nS3_BUCKET='%s'\n" \
    "$s3_endpoint" "$s3_region" "$s3_bucket"
  printf "S3_ACCESS_KEY_ID='%s'\nS3_SECRET_ACCESS_KEY='%s'\n" \
    "$s3_access_key_id" "$s3_secret_access_key"
  printf '%s\n' "S3_FORCE_PATH_STYLE=false"
  printf '%s\n' "SMS_ADAPTER=webhook"
  printf "SMS_WEBHOOK_URL='%s'\nSMS_WEBHOOK_AUTH_TOKEN='%s'\n" \
    "$sms_webhook_url" "$sms_webhook_auth_token"
  printf '%s\n' "FEISHU_ADAPTER=disabled" "FEISHU_WEBHOOK_URL=''" \
    "FEISHU_WEBHOOK_AUTH_TOKEN=''" "VLM_ADAPTER=disabled" \
    "QWEN_BASE_URL='http://host.docker.internal:8000/v1'" "QWEN_MODEL='Qwen3.7-35B'" \
    "TRUSTED_PROXY_HOPS=1"
  printf "INITIAL_ADMIN_EMAIL='%s'\nINITIAL_ADMIN_PASSWORD='%s'\nINITIAL_ADMIN_TOTP_SECRET='%s'\n" \
    "$initial_admin_email" "$initial_admin_password" "$initial_admin_totp_secret"
} >.env

echo
echo "Created .env with mode 0600. Save these one-time login values in a password manager:"
echo "  admin email: $initial_admin_email"
echo "  admin password: $initial_admin_password"
echo "  TOTP secret: $initial_admin_totp_secret"
echo "After the first successful login, remove INITIAL_ADMIN_PASSWORD and INITIAL_ADMIN_TOTP_SECRET from .env."

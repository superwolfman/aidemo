#!/usr/bin/env bash
set -euo pipefail

# 通过 Atlas CLI 创建两个数据库级应用身份。脚本不会把密码打印到终端，
# 只写入被 Git 忽略且权限为 0600 的本地文件。
: "${ATLAS_PROJECT_ID:?Set ATLAS_PROJECT_ID first}"

DEV_DB="${ATLAS_DEV_DATABASE:-aidemo_dev}"
PROD_DB="${ATLAS_PROD_DATABASE:-aidemo_prod}"
DEV_USER="${ATLAS_DEV_USERNAME:-aidemo_dev_app}"
PROD_USER="${ATLAS_PROD_USERNAME:-aidemo_prod_app}"
OUTPUT_FILE="${ATLAS_CREDENTIAL_OUTPUT:-deploy/.atlas-users.env}"

command -v atlas >/dev/null 2>&1 || {
  echo "Atlas CLI is required: https://www.mongodb.com/docs/atlas/cli/current/install-atlas-cli/"
  exit 1
}
command -v openssl >/dev/null 2>&1 || {
  echo "openssl is required to generate application passwords"
  exit 1
}

atlas auth whoami >/dev/null

DEV_PASSWORD="${ATLAS_DEV_PASSWORD:-$(openssl rand -hex 32)}"
PROD_PASSWORD="${ATLAS_PROD_PASSWORD:-$(openssl rand -hex 32)}"

echo "Creating least-privilege Atlas users in project $ATLAS_PROJECT_ID ..."
atlas dbusers create \
  --projectId "$ATLAS_PROJECT_ID" \
  --username "$DEV_USER" \
  --password "$DEV_PASSWORD" \
  --role "readWrite@$DEV_DB"
atlas dbusers create \
  --projectId "$ATLAS_PROJECT_ID" \
  --username "$PROD_USER" \
  --password "$PROD_PASSWORD" \
  --role "readWrite@$PROD_DB"

umask 077
mkdir -p "$(dirname "$OUTPUT_FILE")"
{
  printf 'ATLAS_DEV_USERNAME=%s\n' "$DEV_USER"
  printf 'ATLAS_DEV_PASSWORD=%s\n' "$DEV_PASSWORD"
  printf 'ATLAS_PROD_USERNAME=%s\n' "$PROD_USER"
  printf 'ATLAS_PROD_PASSWORD=%s\n' "$PROD_PASSWORD"
} > "$OUTPUT_FILE"
chmod 600 "$OUTPUT_FILE"

echo "Created $DEV_USER with readWrite@$DEV_DB"
echo "Created $PROD_USER with readWrite@$PROD_DB"
echo "Credentials were written to $OUTPUT_FILE (mode 0600); copy them to the appropriate secret stores, then remove the file."

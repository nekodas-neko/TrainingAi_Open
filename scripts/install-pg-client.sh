#!/usr/bin/env bash
# Install the Postgres client tools of one major version on an Ubuntu CI runner, from the
# PostgreSQL project's own apt repository (Ubuntu's lags behind). Used by db-backup.yml and
# db-restore.yml: pg_dump refuses a server newer than itself, so the version must match production.
#   install-pg-client.sh 18   →   /usr/lib/postgresql/18/bin/{pg_dump,pg_restore,psql}
set -euo pipefail
MAJOR="${1:?usage: install-pg-client.sh <major version>}"
sudo install -d /usr/share/postgresql-common/pgdg
sudo curl -fsSL -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc \
  https://www.postgresql.org/media/keys/ACCC4CF8.asc
echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt $(. /etc/os-release && echo "$VERSION_CODENAME")-pgdg main" \
  | sudo tee /etc/apt/sources.list.d/pgdg.list > /dev/null
sudo apt-get update -qq
sudo apt-get install -y -qq "postgresql-client-$MAJOR"
"/usr/lib/postgresql/$MAJOR/bin/pg_dump" --version

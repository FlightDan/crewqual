# Operations, backup, and recovery

[Documentation index](README.md) · [简体中文](../zh-CN/operations.md)

These commands target the installer's default deployment at `/opt/crewqual`. Replace paths for a custom installation directory. Source deployments use the repository's Compose file.

## Check services

```bash
sudo docker compose --project-directory /opt/crewqual \
  --env-file /opt/crewqual/.env -f /opt/crewqual/compose.yaml ps -a
sudo docker compose --project-directory /opt/crewqual \
  --env-file /opt/crewqual/.env -f /opt/crewqual/compose.yaml \
  logs --tail=100 web worker caddy
```

If initialization fails, inspect the logs for `migrate`, `bootstrap`, and `minio-init`. Exit code 0 is expected for these one-time jobs. Web readiness probes use a dedicated secret; keep it out of public monitoring URLs.

On regular Linux, inspect the host updater with the following commands. WSL2 manual mode does not use these systemd units:

```bash
sudo systemctl status crewqual-updater.service crewqual-updater.socket
sudo journalctl -u crewqual-updater.service -n 100 --no-pager
```

Start troubleshooting with configuration errors, database connectivity, object storage, and outbound allowlists. Remove credentials and personal information before sharing logs.

## Upgrade

Check that recent database and gallery backups succeeded, and save `.env`, certificates, and updater configuration. On regular Linux, System settings can check for and install updates, subject to account permissions and host updater availability. WSL2 uses manual updates.

Rerun the installation command to upgrade an existing deployment:

```bash
curl -fsSL https://raw.githubusercontent.com/FlightDan/crewqual/main/install.sh | sudo bash
```

See [installation arguments](installation.md) to select a version or channel. The installer preserves secrets in the existing `.env` and Docker volumes while updating managed Compose/Caddy files and image versions. It does not change the network mode or port during an upgrade. Do not use `docker compose down -v` as an upgrade step; it deletes volumes.

The host updater creates an encrypted database backup before upgrading and attempts recovery or rollback if migrations or health checks fail. Automatic recovery can also fail; inspect the update job error. Updater database backups do not include gallery files and do not replace application backups.

## Backup plans

Configure destinations and plans in initial setup or under Backup and recovery in System settings. Database backups are full backups. Gallery backups support full and incremental modes. Check successful runs, retention counts, and retention days for both, and perform recovery drills.

Local backups use `/backups` inside the container, mounted to the `backup-data` volume in release deployments. This is on the same host as the original data. Copy backups to another host or use a remote destination to cover host loss. Keep the credentials and keys needed to decrypt encrypted backups.

Include these items in recovery preparation:

| Item                                 | Default location or purpose                                                            |
| ------------------------------------ | -------------------------------------------------------------------------------------- |
| Database                             | `postgres-data` volume; contains business data, settings, and backup run records.      |
| Evidence files                       | Built-in storage's `minio-data` volume or the external private S3 bucket.              |
| Application backups                  | `backup-data` volume or the configured remote destination.                             |
| Deployment settings and certificates | `/opt/crewqual/.env`, `compose.yaml`, `Caddyfile`, and `tls/`.                         |
| Updater configuration and backups    | `/etc/crewqual-updater/config.json` and `/var/lib/crewqual-updater/` on regular Linux. |

These locations can contain secrets. Restrict backup access and preserve `SETTINGS_ENCRYPTION_KEY`; losing it affects decryption of existing sensitive settings and backup credentials.

## Offline recovery

The current restore script uses a successful backup run ID (`runId`). It needs a readable source database with backup records, the settings encryption key, and the backup artifacts. It is not a standalone archive importer for an empty host. If the source database is completely lost, first recover readable control data in an isolated environment before using this procedure.

Recovery requires a **new isolated database and a new empty S3 bucket**. The database must not resolve to the actual source database. The bucket must differ from both the source gallery bucket and any S3 backup bucket. The script accesses the target bucket through the source storage endpoint and credentials, so create the bucket and grant access to those credentials first. Both database and gallery recovery require both destination parameters.

Run in an isolated maintenance environment with readable source deployment settings. This template uses a one-time worker container for runtime dependencies and the `/backups` mount. Replace the backup ID, connection details, and bucket name. The database address must be reachable from that container:

```bash
read -r -s -p 'Restore database URL: ' RESTORE_DATABASE_URL
printf '\n'
export RESTORE_DATABASE_URL
export RESTORE_S3_BUCKET='crewqual-recovery'
sudo --preserve-env=RESTORE_DATABASE_URL,RESTORE_S3_BUCKET \
  docker compose --project-directory /opt/crewqual \
  --env-file /opt/crewqual/.env -f /opt/crewqual/compose.yaml \
  run --rm --no-deps -e RESTORE_DATABASE_URL -e RESTORE_S3_BUCKET \
  worker node --import tsx scripts/restore-backup.ts 'BACKUP_RUN_ID' '恢复'
unset RESTORE_DATABASE_URL RESTORE_S3_BUCKET
```

`恢复` is the exact confirmation argument required by the script, including in English environments. The target database account needs restoration privileges; source services must remain accessible for metadata reads. The restore command retains archive ownership and grants. Before restoring to another PostgreSQL instance, provision the database roles referenced by the archive and confirm that the restore account can restore those owners and permissions. Use the respective successful run IDs for database and gallery recovery. Incremental gallery recovery requires its full baseline and the required incremental chain; retaining only the last incremental file is insufficient.

The script checks artifact checksums and destination isolation. It restores databases with `pg_restore` and validates gallery archives and object sets. Afterward, inspect members, qualification records, evidence images, and login in an isolated deployment before deciding to switch traffic. The script does not update the live `.env` or switch the domain.

Sources: [restore entry point](../../scripts/restore-backup.ts), [backup and recovery implementation](../../src/server/backup-runner.ts), [backup settings service](../../src/server/backup-service.ts), [host updater](../../updater/main.go), [release Compose](../../docker-compose.install.yml).

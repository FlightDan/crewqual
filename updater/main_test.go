package main

import (
	"bytes"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"
)

func TestPruneBackupFilesSmallSets(t *testing.T) {
	for _, count := range []int{1, 2, 3} {
		t.Run(strconv.Itoa(count), func(t *testing.T) {
			directory := t.TempDir()
			current := ""
			for index := 0; index < count; index++ {
				name := fmt.Sprintf("backup-%d.dump.enc", index)
				path := filepath.Join(directory, name)
				if err := os.WriteFile(path, []byte(name), 0600); err != nil {
					t.Fatal(err)
				}
				current = path
			}
			if err := pruneBackupFiles(directory, current, 3); err != nil {
				t.Fatal(err)
			}
			entries, err := os.ReadDir(directory)
			if err != nil {
				t.Fatal(err)
			}
			if len(entries) != count {
				t.Fatalf("got %d backups, want %d", len(entries), count)
			}
		})
	}
}

func TestPruneBackupFilesPreservesCurrentAndNewestPrevious(t *testing.T) {
	directory := t.TempDir()
	baseTime := time.Now().Add(-time.Hour)
	names := []string{"prior-1.dump.enc", "prior-2.dump.enc", "prior-3.dump.enc", "prior-4.dump.enc", "000-current.dump.enc"}
	for index, name := range names {
		path := filepath.Join(directory, name)
		if err := os.WriteFile(path, []byte(name), 0600); err != nil {
			t.Fatal(err)
		}
		when := baseTime.Add(time.Duration(index) * time.Minute)
		if name == "000-current.dump.enc" {
			when = baseTime.Add(-time.Minute)
		}
		if err := os.Chtimes(path, when, when); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.WriteFile(filepath.Join(directory, "notes.txt"), []byte("keep"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(filepath.Join(directory, "ignored.dump.enc"), 0700); err != nil {
		t.Fatal(err)
	}
	current := filepath.Join(directory, "000-current.dump.enc")
	if err := pruneBackupFiles(directory, current, 3); err != nil {
		t.Fatal(err)
	}
	wantPresent := map[string]bool{
		"000-current.dump.enc": true,
		"prior-3.dump.enc":     true,
		"prior-4.dump.enc":     true,
		"notes.txt":            true,
		"ignored.dump.enc":     true,
	}
	entries, err := os.ReadDir(directory)
	if err != nil {
		t.Fatal(err)
	}
	for _, entry := range entries {
		if !wantPresent[entry.Name()] {
			t.Fatalf("unexpected retained entry %q", entry.Name())
		}
		delete(wantPresent, entry.Name())
	}
	if len(wantPresent) != 0 {
		t.Fatalf("missing retained entries: %v", wantPresent)
	}
}

func TestRestoreManagedFilesPreservesConfigureDomainState(t *testing.T) {
	for _, existed := range []bool{false, true} {
		t.Run(strconv.FormatBool(existed), func(t *testing.T) {
			directory := t.TempDir()
			cfg := Config{
				InstallDir:  directory,
				ComposeFile: filepath.Join(directory, "compose.yaml"),
				CaddyFile:   filepath.Join(directory, "Caddyfile"),
				EnvFile:     filepath.Join(directory, ".env"),
			}
			for path, contents := range map[string]string{
				cfg.ComposeFile: "baseline-compose\n",
				cfg.CaddyFile:   "baseline-caddy\n",
				cfg.EnvFile:     "BASELINE=true\n",
			} {
				if err := os.WriteFile(path, []byte(contents), 0600); err != nil {
					t.Fatal(err)
				}
			}
			configurePath := filepath.Join(directory, "configure-domain.sh")
			if existed {
				if err := os.WriteFile(configurePath, []byte("baseline-script\n"), 0700); err != nil {
					t.Fatal(err)
				}
			}
			snapshot, err := snapshotManagedFiles(cfg, []byte("BASELINE=true\n"))
			if err != nil {
				t.Fatal(err)
			}
			for path, contents := range map[string]string{
				cfg.ComposeFile: "target-compose\n",
				cfg.CaddyFile:   "target-caddy\n",
				cfg.EnvFile:     "TARGET=true\n",
				configurePath:   "target-script\n",
			} {
				if err := os.WriteFile(path, []byte(contents), 0755); err != nil {
					t.Fatal(err)
				}
			}
			if err := restoreManagedFiles(cfg, snapshot); err != nil {
				t.Fatal(err)
			}
			for path, expected := range map[string]string{
				cfg.ComposeFile: "baseline-compose\n",
				cfg.CaddyFile:   "baseline-caddy\n",
				cfg.EnvFile:     "BASELINE=true\n",
			} {
				raw, readErr := os.ReadFile(path)
				if readErr != nil || string(raw) != expected {
					t.Fatalf("%s was not restored: contents=%q err=%v", path, raw, readErr)
				}
			}
			info, statErr := os.Stat(configurePath)
			if existed {
				if statErr != nil {
					t.Fatal(statErr)
				}
				raw, readErr := os.ReadFile(configurePath)
				if readErr != nil || string(raw) != "baseline-script\n" || info.Mode().Perm() != 0700 {
					t.Fatalf("configure-domain.sh was not restored: contents=%q mode=%o err=%v", raw, info.Mode().Perm(), readErr)
				}
			} else if !errors.Is(statErr, os.ErrNotExist) {
				t.Fatalf("new configure-domain.sh was retained: %v", statErr)
			}
		})
	}
}

func TestApplyUpgradeFailureRecoveryStateMachine(t *testing.T) {
	tests := []struct {
		name              string
		failureStage      string
		wantPhase         string
		wantCode          string
		wantMaintenance   bool
		wantTargetFiles   bool
		wantTargetVersion bool
	}{
		{name: "shutdown", failureStage: "shutdown", wantPhase: "FAILED", wantCode: "DATABASE_CLIENT_SHUTDOWN_FAILED"},
		{name: "backup", failureStage: "backup", wantPhase: "FAILED", wantCode: "BACKUP_FAILED"},
		{name: "migration", failureStage: "migration", wantPhase: "ROLLED_BACK", wantCode: "MIGRATION_FAILED"},
		{name: "bootstrap", failureStage: "bootstrap", wantPhase: "ROLLED_BACK", wantCode: "BOOTSTRAP_FAILED"},
		{name: "restore", failureStage: "migration-restore", wantPhase: "NEEDS_MANUAL_RECOVERY", wantCode: "DATABASE_ROLLBACK_FAILED", wantMaintenance: true},
		{name: "restart", failureStage: "restart", wantPhase: "FAILED", wantCode: "RESTART_FAILED"},
		{name: "health", failureStage: "health", wantPhase: "ROLLED_BACK", wantCode: "HEALTH_CHECK_FAILED"},
		{name: "success", wantPhase: "SUCCEEDED", wantTargetFiles: true, wantTargetVersion: true},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			directory := t.TempDir()
			installDirectory := filepath.Join(directory, "install")
			artifactDirectory := filepath.Join(directory, "artifacts")
			if err := os.MkdirAll(artifactDirectory, 0700); err != nil {
				t.Fatal(err)
			}
			if err := os.MkdirAll(installDirectory, 0700); err != nil {
				t.Fatal(err)
			}
			cfg := Config{
				InstallDir:  installDirectory,
				DataDir:     filepath.Join(directory, "data"),
				ComposeFile: filepath.Join(installDirectory, "compose.yaml"),
				CaddyFile:   filepath.Join(installDirectory, "Caddyfile"),
				EnvFile:     filepath.Join(installDirectory, ".env"),
				Socket:      filepath.Join(directory, "runtime", "api.sock"),
				BackupKey:   "fixture-backup-key",
			}
			baseline := map[string]string{
				cfg.ComposeFile: "baseline-compose\n",
				cfg.CaddyFile:   "baseline-caddy\n",
				cfg.EnvFile:     "CREWQUAL_VERSION='v1.0.0'\n",
				filepath.Join(installDirectory, "configure-domain.sh"): "baseline-script\n",
			}
			for path, contents := range baseline {
				if err := os.WriteFile(path, []byte(contents), 0700); err != nil {
					t.Fatal(err)
				}
			}
			composePath := filepath.Join(artifactDirectory, "compose.yaml")
			caddyPath := filepath.Join(artifactDirectory, "Caddyfile")
			configurePath := filepath.Join(artifactDirectory, "configure-domain.sh")
			stagedEnv := filepath.Join(artifactDirectory, ".env")
			target := map[string]string{
				composePath:   "target-compose\n",
				caddyPath:     "target-caddy\n",
				configurePath: "target-script\n",
				stagedEnv:     "CREWQUAL_VERSION='v1.1.0'\n",
			}
			for path, contents := range target {
				if err := os.WriteFile(path, []byte(contents), 0600); err != nil {
					t.Fatal(err)
				}
			}

			docker := filepath.Join(directory, "docker")
			dockerScript := `#!/bin/sh
printf '%s\n' "$*" >>"$DOCKER_CALLS_FILE"
state_dir="$DOCKER_STATE_DIR"
args=" $* "
case "$args" in
  *" stop --timeout 30 web worker "*)
    count=0
    if [ -f "$state_dir/stop-count" ]; then count=$(cat "$state_dir/stop-count"); fi
    count=$((count + 1)); printf '%s' "$count" >"$state_dir/stop-count"
    if [ "$count" -ge 2 ]; then touch "$state_dir/rollback-stopped"; fi
    if [ "${DOCKER_FAILURE_STAGE:-}" = shutdown ] && [ "$count" -eq 1 ]; then exit 41; fi ;;
  *" pg_dump "*)
    if [ "${DOCKER_FAILURE_STAGE:-}" = backup ]; then exit 42; fi
    printf 'fixture-database-dump' ;;
  *" pg_restore --list "*) cat >/dev/null ;;
  *" run --rm --no-deps migrate "*)
    case "${DOCKER_FAILURE_STAGE:-}" in migration|migration-restore) exit 43 ;; esac ;;
  *" run --rm --no-deps bootstrap "*)
    if [ "${DOCKER_FAILURE_STAGE:-}" = bootstrap ]; then exit 44; fi ;;
  *" psql "*) ;;
  *" pg_restore "*)
    cat >/dev/null
    if [ "${DOCKER_FAILURE_STAGE:-}" = migration-restore ]; then exit 45; fi ;;
  *" up -d --no-deps web worker "*)
    if [ "${DOCKER_FAILURE_STAGE:-}" = restart ] && [ ! -f "$state_dir/restart-failed" ]; then
      touch "$state_dir/restart-failed"; exit 46
    fi ;;
  *" ps -q web "*) printf 'fixture-web-container\n' ;;
  *" ps -q worker "*) printf 'fixture-worker-container\n' ;;
  *" inspect --format "*)
    if [ "${DOCKER_FAILURE_STAGE:-}" = health ] && [ ! -f "$state_dir/rollback-stopped" ]; then
      printf 'unhealthy\n'
    else
      printf 'healthy\n'
    fi ;;
  *" up -d --no-deps caddy "*) ;;
  *) exit 99 ;;
esac
`
			if err := os.WriteFile(docker, []byte(dockerScript), 0700); err != nil {
				t.Fatal(err)
			}
			callsFile := filepath.Join(directory, "docker-calls")
			t.Setenv("DOCKER_CALLS_FILE", callsFile)
			t.Setenv("DOCKER_STATE_DIR", directory)
			t.Setenv("DOCKER_FAILURE_STAGE", test.failureStage)
			t.Setenv("PATH", directory+string(os.PathListSeparator)+os.Getenv("PATH"))

			job := &Job{ID: "fixture-job", RequestedVersion: "v1.1.0", Phase: "STAGING", StartedAt: time.Now().UTC().Format(time.RFC3339)}
			app := &App{
				cfg:                 cfg,
				state:               State{CurrentVersion: "v1.0.0", Job: job},
				healthCheckTimeout:  20 * time.Millisecond,
				healthCheckInterval: time.Millisecond,
			}
			manifest := Manifest{Version: "v1.1.0", WebImage: "target-web", RuntimeImage: "target-runtime", ConfigureDomainURL: "https://github.com/FlightDan/crewqual/releases/download/v1.1.0/configure-domain.sh"}
			app.applyUpgrade(job, manifest, composePath, caddyPath, configurePath, stagedEnv, []byte(baseline[cfg.EnvFile]), func() error { return nil })

			if job.Phase != test.wantPhase || job.ErrorCode != test.wantCode || job.CompletedAt == "" {
				t.Fatalf("unexpected terminal job: %+v", job)
			}
			if (app.state.CurrentVersion == "v1.1.0") != test.wantTargetVersion {
				t.Fatalf("unexpected current version %q", app.state.CurrentVersion)
			}
			_, markerErr := os.Stat(app.maintenancePath())
			if (markerErr == nil) != test.wantMaintenance {
				t.Fatalf("maintenance marker state mismatch: %v", markerErr)
			}
			if markerErr != nil && !errors.Is(markerErr, os.ErrNotExist) {
				t.Fatal(markerErr)
			}
			wantFiles := baseline
			if test.wantTargetFiles {
				wantFiles = map[string]string{
					cfg.ComposeFile: "target-compose\n",
					cfg.CaddyFile:   "target-caddy\n",
					cfg.EnvFile:     "",
					filepath.Join(installDirectory, "configure-domain.sh"): "target-script\n",
				}
			}
			for path, expected := range wantFiles {
				if test.wantTargetFiles && path == cfg.EnvFile {
					if readEnv(path, "CREWQUAL_VERSION") != "v1.1.0" || readEnv(path, "CREWQUAL_WEB_IMAGE") != "target-web" || readEnv(path, "CREWQUAL_RUNTIME_IMAGE") != "target-runtime" {
						t.Fatalf("target environment was not installed: %s", path)
					}
					continue
				}
				raw, err := os.ReadFile(path)
				if err != nil || string(raw) != expected {
					t.Fatalf("unexpected managed file %s: contents=%q err=%v", path, raw, err)
				}
			}
			calls, err := os.ReadFile(callsFile)
			if err != nil {
				t.Fatal(err)
			}
			callsText := string(calls)
			if test.failureStage != "shutdown" {
				stopIndex := strings.Index(callsText, " stop --timeout 30 web worker")
				backupIndex := strings.Index(callsText, " pg_dump ")
				if stopIndex < 0 || backupIndex <= stopIndex {
					t.Fatalf("database clients were not stopped before backup:\n%s", calls)
				}
			}
			if test.failureStage == "migration-restore" {
				restoreIndex := strings.LastIndex(callsText, " pg_restore --create ")
				if restoreIndex < 0 || strings.Contains(callsText[restoreIndex:], " up -d --no-deps web worker") {
					t.Fatalf("database clients restarted after failed restore:\n%s", calls)
				}
			}
		})
	}
}

func TestBackupDatabaseRetainsThreeVerifiedBackups(t *testing.T) {
	directory := t.TempDir()
	docker := filepath.Join(directory, "docker")
	dockerScript := `#!/bin/sh
printf '%s\n' "$*" >>"$DOCKER_CALLS_FILE"
case " $* " in
  *" pg_dump "*) printf 'fixture-database-dump' ;;
  *" pg_restore --list "*) cat >/dev/null ;;
  *" pg_restore "*) cat >/dev/null; if [ "${DOCKER_FAIL_RESTORE:-}" = 1 ]; then exit 42; fi ;;
  *" psql "*) ;;
  *" stop --timeout 30 web worker "*) ;;
  *" up -d --no-deps web worker "*) ;;
  *" ps -q web "*) printf 'fixture-web-container\n' ;;
  *" ps -q worker "*) printf 'fixture-worker-container\n' ;;
  *" inspect --format "*) printf 'healthy\n' ;;
  *) exit 99 ;;
esac
`
	if err := os.WriteFile(docker, []byte(dockerScript), 0700); err != nil {
		t.Fatal(err)
	}
	callsFile := filepath.Join(directory, "docker-calls")
	t.Setenv("DOCKER_CALLS_FILE", callsFile)
	t.Setenv("PATH", directory+string(os.PathListSeparator)+os.Getenv("PATH"))
	dataDirectory := filepath.Join(directory, "data")
	app := App{cfg: Config{
		InstallDir:  "/fixture/install",
		DataDir:     dataDirectory,
		ComposeFile: "/fixture/compose.yaml",
		EnvFile:     "/fixture/.env",
		BackupKey:   "fixture-backup-key",
	}}
	latest := ""
	for index := 1; index <= 5; index++ {
		path, err := app.backupDatabase(fmt.Sprintf("retention-%d-%d", os.Getpid(), index))
		if err != nil {
			t.Fatalf("backup %d failed: %v", index, err)
		}
		plain, err := decryptFile(path, app.cfg.BackupKey)
		if err != nil {
			t.Fatalf("decrypt backup %d: %v", index, err)
		}
		if string(plain) != "fixture-database-dump" {
			t.Fatalf("backup %d has unexpected contents %q", index, plain)
		}
		if _, err := os.Stat(path); err != nil {
			t.Fatalf("current backup %d was not preserved: %v", index, err)
		}
		entries, err := os.ReadDir(filepath.Join(dataDirectory, backupDir))
		if err != nil {
			t.Fatal(err)
		}
		wantCount := index
		if wantCount > 3 {
			wantCount = 3
		}
		if len(entries) != wantCount {
			t.Fatalf("after backup %d got %d retained backups, want %d", index, len(entries), wantCount)
		}
		latest = path
	}
	if err := app.restoreDatabaseWithServices(latest); err != nil {
		t.Fatalf("restore current backup: %v", err)
	}
	calls, err := os.ReadFile(callsFile)
	if err != nil {
		t.Fatal(err)
	}
	callsText := string(calls)
	expectedOrder := []string{
		" stop --timeout 30 web worker",
		" psql --no-psqlrc --no-password --username=crewqual --dbname=postgres --set=ON_ERROR_STOP=1 --command=DROP DATABASE IF EXISTS crewqual WITH (FORCE);",
		" pg_restore --create --no-owner --exit-on-error --no-password --dbname=postgres --username=crewqual",
		" up -d --no-deps web worker",
	}
	previous := -1
	for _, expected := range expectedOrder {
		index := strings.Index(callsText, expected)
		if index <= previous {
			t.Fatalf("restore command %q missing or out of order:\n%s", expected, calls)
		}
		previous = index
	}
	if err := os.WriteFile(callsFile, nil, 0600); err != nil {
		t.Fatal(err)
	}
	t.Setenv("DOCKER_FAIL_RESTORE", "1")
	if err := app.restoreDatabaseWithServices(latest); err == nil {
		t.Fatal("failed restore succeeded")
	}
	failedCalls, err := os.ReadFile(callsFile)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(failedCalls), " up -d --no-deps web worker") {
		t.Fatalf("database clients restarted after failed restore:\n%s", failedCalls)
	}
}

func TestValidateManifest(t *testing.T) {
	valid := Manifest{SchemaVersion: 1, Version: "v1.0.0", Channel: "stable", SigningKeyID: "test-ed25519", PublishedAt: "2026-08-24T00:00:00Z", ReleaseNotesURL: "https://github.com/FlightDan/crewqual/releases/tag/v1.0.0", ComposeURL: "https://github.com/FlightDan/crewqual/releases/download/v1.0.0/docker-compose.install.yml", CaddyURL: "https://github.com/FlightDan/crewqual/releases/download/v1.0.0/Caddyfile", ConfigureDomainURL: "https://github.com/FlightDan/crewqual/releases/download/v1.0.0/configure-domain.sh", ComposeSHA256: strings.Repeat("a", 64), CaddySHA256: strings.Repeat("b", 64), ConfigureDomainSHA256: strings.Repeat("e", 64), WebImage: "ghcr.io/flightdan/crewqual-web@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", RuntimeImage: "ghcr.io/flightdan/crewqual-runtime@sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", MigrationPolicy: "backward-compatible"}
	valid.Updater.AMD64 = strings.Repeat("c", 64)
	valid.Updater.ARM64 = strings.Repeat("d", 64)
	valid.Updater.AMD64URL = "https://github.com/FlightDan/crewqual/releases/download/v1.0.0/crewqual-updater-linux-amd64"
	valid.Updater.ARM64URL = "https://github.com/FlightDan/crewqual/releases/download/v1.0.0/crewqual-updater-linux-arm64"
	if err := validateManifest(valid); err != nil {
		t.Fatalf("valid manifest rejected: %v", err)
	}
	valid.Channel = "beta"
	if err := validateManifest(valid); err == nil {
		t.Fatal("non-stable manifest accepted")
	}
	valid.Channel = "stable"
	valid.Updater.ARM64 = "missing"
	if err := validateManifest(valid); err == nil {
		t.Fatal("manifest without a complete updater checksum accepted")
	}
}

func TestValidateNetworkInput(t *testing.T) {
	base := NetworkInput{
		Mode: "lan", Origin: "http://192.168.1.20:8080", Port: 8080,
		Domain: "lan.local",
		Site:   "http://:8080", AppBind: "0.0.0.0", AcmeBind: "127.0.0.1", AcmePort: 18080,
	}
	if err := validateNetworkInput(base); err != nil {
		t.Fatalf("valid LAN configuration rejected: %v", err)
	}
	invalid := base
	invalid.Origin = "http://example.com:8080"
	if err := validateNetworkInput(invalid); err == nil {
		t.Fatal("public HTTP origin accepted in LAN mode")
	}
	publicHTTP := base
	publicHTTP.Mode, publicHTTP.Origin, publicHTTP.Domain = "http", "http://203.0.113.20:8080", "203.0.113.20"
	if err := validateNetworkInput(publicHTTP); err != nil {
		t.Fatalf("valid public HTTP configuration rejected: %v", err)
	}
	invalid = base
	invalid.Port = 80
	if err := validateNetworkInput(invalid); err == nil {
		t.Fatal("application port 80 accepted")
	}
	tls := base
	tls.Mode, tls.Origin, tls.Port, tls.Domain, tls.TLSEmail = "tls", "https://crewqual.example.com:8443", 8443, "crewqual.example.com", "ops@example.com"
	if err := validateNetworkInput(tls); err != nil {
		t.Fatalf("valid TLS configuration rejected: %v", err)
	}
	tls.Origin = "https://crewqual.example.com:9443"
	if err := validateNetworkInput(tls); err == nil {
		t.Fatal("origin with mismatched port accepted")
	}
}

func TestCompareVersion(t *testing.T) {
	if compareVersion("v1.2.0", "v1.1.9") <= 0 || compareVersion("v1.0.0", "v1.0.0") != 0 || compareVersion("v0.9.9", "v1.0.0") >= 0 || compareVersion("v1.0.0-rc.1", "v1.0.0-rc.2") >= 0 || compareVersion("v1.0.0-rc.2", "v1.0.0") >= 0 {
		t.Fatal("semver comparison failed")
	}
}

func TestStrictJSONRejectsDuplicateAndTrailingData(t *testing.T) {
	var target map[string]string
	if err := decodeStrictJSON([]byte(`{"version":"v1.0.0","version":"v1.0.1"}`), &target); err == nil {
		t.Fatal("duplicate JSON object key was accepted")
	}
	if err := decodeStrictJSON([]byte(`{"version":"v1.0.0"} {"extra":true}`), &target); err == nil {
		t.Fatal("trailing JSON data was accepted")
	}
}

func TestReplayNonce(t *testing.T) {
	app := &App{cfg: Config{SharedSecret: "secret"}, nonces: map[string]time.Time{}}
	body := []byte(`{"ok":true}`)
	ts := time.Now().UnixMilli()
	nonce := "nonce-1"
	mac := hmac.New(sha256.New, []byte(app.cfg.SharedSecret))
	mac.Write([]byte(fmtTimestamp(ts) + "." + nonce + "." + string(body)))
	req := httptest.NewRequest("POST", "http://unix/v1/check", bytes.NewReader(body))
	req.Header.Set("X-Crewqual-Timestamp", fmtTimestamp(ts))
	req.Header.Set("X-Crewqual-Nonce", nonce)
	req.Header.Set("X-Crewqual-Signature", hex.EncodeToString(mac.Sum(nil)))
	if !app.validMAC(req, body) || app.validMAC(req, body) {
		t.Fatal("replay nonce was accepted")
	}
}

func fmtTimestamp(value int64) string { return strconv.FormatInt(value, 10) }

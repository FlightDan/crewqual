package main

import (
	"bytes"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
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

func TestBackupDatabaseRetainsThreeVerifiedBackups(t *testing.T) {
	directory := t.TempDir()
	docker := filepath.Join(directory, "docker")
	dockerScript := `#!/bin/sh
printf '%s\n' "$*" >>"$DOCKER_CALLS_FILE"
case " $* " in
  *" pg_dump "*) printf 'fixture-database-dump' ;;
  *" pg_restore --list "*) cat >/dev/null ;;
  *" pg_restore "*) cat >/dev/null ;;
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
	if err := app.restoreDatabase(latest); err != nil {
		t.Fatalf("restore current backup: %v", err)
	}
	calls, err := os.ReadFile(callsFile)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(calls), "pg_restore --clean --if-exists --no-owner --exit-on-error --dbname=crewqual --username=crewqual") {
		t.Fatalf("restore did not select the crewqual database role:\n%s", calls)
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

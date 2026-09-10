package main

import (
	"bytes"
	"encoding/hex"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

const legacyUpgradeEnv = "# retained operator configuration\nCREWQUAL_VERSION='v1.0.4'\nPOSTGRES_PASSWORD='owner-secret'\nDATABASE_URL='postgresql://crewqual:owner-secret@postgres:5432/crewqual'\nDIRECT_URL='postgresql://crewqual:owner-secret@postgres:5432/crewqual'\nSESSION_SECRET='existing-session-secret'\nSETTINGS_ENCRYPTION_KEY='existing-encryption-key'\nOUTBOUND_ALLOWED_HOSTS='storage.example.invalid:443'\n"

func TestPrepareLegacyUpgradeEnvironment(t *testing.T) {
	original := []byte(legacyUpgradeEnv)
	manifest := Manifest{Version: "v1.0.7", WebImage: "web@sha256:target", RuntimeImage: "runtime@sha256:target"}
	candidate, err := prepareUpgradeEnv(original, manifest)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(original, []byte(legacyUpgradeEnv)) {
		t.Fatal("live environment changed while staging")
	}
	for _, key := range []string{"READINESS_PROBE_SECRET", "POSTGRES_APP_PASSWORD"} {
		value := envValue(candidate, key)
		decoded, err := hex.DecodeString(value)
		if err != nil || len(decoded) != 32 {
			t.Fatalf("invalid generated %s", key)
		}
	}
	if envValue(candidate, "READINESS_PROBE_SECRET") == envValue(candidate, "POSTGRES_APP_PASSWORD") {
		t.Fatal("secrets must be independent")
	}
	runtimeURL, err := url.Parse(envValue(candidate, "DATABASE_URL"))
	if err != nil || runtimeURL.User.Username() != "crewqual_app" {
		t.Fatal("runtime account not migrated")
	}
	password, _ := runtimeURL.User.Password()
	if password != envValue(candidate, "POSTGRES_APP_PASSWORD") {
		t.Fatal("role password disagrees with runtime URL")
	}
	for _, key := range []string{"DIRECT_URL", "POSTGRES_PASSWORD", "SESSION_SECRET", "SETTINGS_ENCRYPTION_KEY", "OUTBOUND_ALLOWED_HOSTS"} {
		if envValue(candidate, key) != envValue(original, key) {
			t.Fatalf("existing %s changed", key)
		}
	}
	if envValue(candidate, "CREWQUAL_VERSION") != manifest.Version || !strings.Contains(string(candidate), "# retained operator configuration") {
		t.Fatal("release or operator configuration lost")
	}
	next, err := prepareUpgradeEnv(candidate, manifest)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(candidate, next) {
		t.Fatal("retry rotated credentials or changed prepared configuration")
	}
}

func TestUpgradeEnvironmentBackfillsEmptySecrets(t *testing.T) {
	current := []byte(legacyUpgradeEnv + "READINESS_PROBE_SECRET=''\nPOSTGRES_APP_PASSWORD=''\n")
	candidate, err := prepareUpgradeEnv(current, Manifest{})
	if err != nil {
		t.Fatal(err)
	}
	for _, key := range []string{"READINESS_PROBE_SECRET", "POSTGRES_APP_PASSWORD"} {
		if len(envValue(candidate, key)) != 64 || strings.Count(string(candidate), key+"=") != 1 {
			t.Fatalf("empty %s was not replaced exactly once", key)
		}
	}
}

func TestUpgradeEnvironmentRefusesCustomDatabaseWithoutMutation(t *testing.T) {
	for _, key := range []string{"DATABASE_URL", "DIRECT_URL"} {
		current := []byte(updateEnv(legacyUpgradeEnv, map[string]string{key: "postgresql://custom:secret@external.example:5432/custom"}))
		original := bytes.Clone(current)
		if _, err := prepareUpgradeEnv(current, Manifest{}); err == nil {
			t.Fatalf("silently redirected %s", key)
		}
		if !bytes.Equal(current, original) {
			t.Fatal("custom configuration mutated")
		}
	}
}

func TestUpgradeEnvironmentRefusesRolePasswordRotation(t *testing.T) {
	for _, appPassword := range []string{"", "different-password"} {
		current := []byte(updateEnv(legacyUpgradeEnv, map[string]string{"DATABASE_URL": "postgresql://crewqual_app:existing-password@postgres:5432/crewqual", "POSTGRES_APP_PASSWORD": appPassword}))
		if _, err := prepareUpgradeEnv(current, Manifest{}); err == nil {
			t.Fatal("accepted inconsistent role credentials; rollback cannot restore a rotated cluster role password")
		}
	}
}

func TestLegacyUpgradeEnvironmentValidatesCurrentCompose(t *testing.T) {
	if err := exec.Command("docker", "compose", "version").Run(); err != nil {
		t.Skip("Docker Compose CLI unavailable")
	}
	baseline := []byte(legacyUpgradeEnv + "APP_ORIGIN='http://172.20.0.1:8080'\nAPP_DOMAIN='172.20.0.1'\nCADDY_SITE_ADDRESS=':8080'\nTLS_EMAIL='fixture@example.invalid'\nNETWORK_ACCESS_SECRET='network-fixture'\nSETUP_AUTH_CODE_HASH='setup-fixture'\nMINIO_ROOT_USER='storage-fixture'\nMINIO_ROOT_PASSWORD='storage-password-fixture'\nS3_ACCESS_KEY_ID='storage-fixture'\nS3_SECRET_ACCESS_KEY='storage-password-fixture'\n")
	candidate, err := prepareUpgradeEnv(baseline, Manifest{Version: "v1.0.7", WebImage: "ghcr.io/flightdan/crewqual-web:fixture", RuntimeImage: "ghcr.io/flightdan/crewqual-runtime:fixture"})
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(t.TempDir(), ".env")
	if err := os.WriteFile(path, candidate, 0600); err != nil {
		t.Fatal(err)
	}
	cmd := exec.Command("docker", "compose", "--env-file", path, "-f", "../docker-compose.install.yml", "config", "--quiet")
	if output, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("migrated legacy environment failed real Compose validation: %v %s", err, output)
	}
}

package main

import (
	"bytes"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"time"
)

func TestValidateManifest(t *testing.T) {
	valid := Manifest{SchemaVersion: 1, Version: "v1.0.0", Channel: "stable", ComposeURL: "https://example.invalid/compose", CaddyURL: "https://example.invalid/Caddyfile", ComposeSHA256: strings.Repeat("a", 64), CaddySHA256: strings.Repeat("b", 64), WebImage: "ghcr.io/example/web@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", RuntimeImage: "ghcr.io/example/runtime@sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", MigrationPolicy: "backward-compatible"}
	valid.Updater.AMD64 = strings.Repeat("c", 64)
	valid.Updater.ARM64 = strings.Repeat("d", 64)
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
	if compareVersion("v1.2.0", "v1.1.9") <= 0 || compareVersion("v1.0.0", "v1.0.0") != 0 || compareVersion("v0.9.9", "v1.0.0") >= 0 {
		t.Fatal("semver comparison failed")
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

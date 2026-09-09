package main

import (
	"context"
	"errors"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func startIPv4Server(t *testing.T, handler http.Handler, tlsEnabled bool) *httptest.Server {
	t.Helper()
	listener, err := net.Listen("tcp4", "127.0.0.1:0")
	if err != nil {
		t.Skipf("local TCP listeners unavailable: %v", err)
	}
	server := &httptest.Server{Listener: listener, Config: &http.Server{Handler: handler}}
	if tlsEnabled {
		server.StartTLS()
	} else {
		server.Start()
	}
	return server
}

func TestManagedCaddyPathsRejectMissingMarkerAndEscapes(t *testing.T) {
	if os.Geteuid() != 0 {
		t.Skip("managed paths must be root-owned")
	}
	dir := t.TempDir()
	app := &App{cfg: Config{InstallDir: dir, EnvFile: filepath.Join(dir, ".env"), ComposeFile: filepath.Join(dir, "compose.yaml"), CaddyFile: filepath.Join(dir, "Caddyfile")}}
	for _, p := range []string{app.cfg.EnvFile, app.cfg.ComposeFile, app.cfg.CaddyFile} {
		if err := os.WriteFile(p, []byte(""), 0600); err != nil {
			t.Fatal(err)
		}
	}
	if app.validateCaddyPaths() == nil {
		t.Fatal("missing official marker accepted")
	}
	marker := filepath.Join(dir, ".crewqual-official-install")
	if err := os.WriteFile(marker, nil, 0644); err != nil {
		t.Fatal(err)
	}
	if err := app.validateCaddyPaths(); err != nil {
		t.Fatal(err)
	}
	app.cfg.EnvFile = filepath.Join(t.TempDir(), ".env")
	if app.validateCaddyPaths() == nil {
		t.Fatal("external env accepted")
	}
}

func TestManagedCaddyPathsRejectWritableInstallRoot(t *testing.T) {
	if os.Geteuid() != 0 {
		t.Skip("managed paths must be root-owned")
	}
	dir := t.TempDir()
	app := &App{cfg: Config{InstallDir: dir, EnvFile: filepath.Join(dir, ".env"), ComposeFile: filepath.Join(dir, "compose.yaml"), CaddyFile: filepath.Join(dir, "Caddyfile")}}
	for _, p := range []string{filepath.Join(dir, ".crewqual-official-install"), app.cfg.EnvFile, app.cfg.ComposeFile, app.cfg.CaddyFile} {
		if err := os.WriteFile(p, nil, 0600); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.Chmod(dir, 0775); err != nil {
		t.Fatal(err)
	}
	if app.validateCaddyPaths() == nil {
		t.Fatal("group-writable managed root accepted")
	}
}

func TestCaddyExactPorts(t *testing.T) {
	expected := map[string][]caddyBinding{"443/tcp": {{"192.0.2.10", "443"}}, "80/tcp": {{"127.0.0.1", "18080"}}}
	if !exactCaddyPorts(expected, expected) {
		t.Fatal("correct ports rejected")
	}
	for _, actual := range []map[string][]caddyBinding{nil, {"443/tcp": {{"0.0.0.0", "443"}}, "80/tcp": {{"127.0.0.1", "18080"}}}, {"443/tcp": {{"192.0.2.10", "443"}, {"0.0.0.0", "443"}}, "80/tcp": {{"127.0.0.1", "18080"}}}} {
		if exactCaddyPorts(actual, expected) {
			t.Fatal("missing or wider bind accepted")
		}
	}
}

func TestUpgradeEntranceFailureCannotSucceed(t *testing.T) {
	for _, stage := range []string{"start", "probe", "success"} {
		t.Run(stage, func(t *testing.T) {
			job := &Job{Phase: "HEALTH_CHECKING"}
			app := &App{cfg: Config{DataDir: t.TempDir()}, state: State{CurrentVersion: "v1.0.0", Job: job}}
			probed := false
			app.finishUpgradeEntrance(job, "v1.1.0", func() error {
				if stage == "start" {
					return errors.New("injected startup failure")
				}
				return nil
			}, func() error {
				probed = true
				if stage == "probe" {
					return errors.New("injected TLS failure")
				}
				return nil
			})
			if stage == "success" {
				if job.Phase != "SUCCEEDED" {
					t.Fatal(job.Phase)
				}
			} else if job.Phase != "FAILED" || job.ErrorCode == "" {
				t.Fatalf("failure reported as %+v", job)
			}
			if stage == "start" && probed {
				t.Fatal("probe ran despite failed startup")
			}
			if app.state.CurrentVersion != "v1.1.0" {
				t.Fatal("actual installed version lost")
			}
		})
	}
}

func TestCaddyRecoveryStateMachine(t *testing.T) {
	for _, mode := range []string{"healthy", "missing-ports", "delayed-address", "absent-address", "recreate-failure", "backend-not-ready"} {
		t.Run(mode, func(t *testing.T) {
			ctx, cancel := context.WithTimeout(context.Background(), 1100*time.Millisecond)
			defer cancel()
			addresses, recreates, probes := 0, 0, 0
			err := reconcileCaddyLoop(ctx, caddyChecks{
				addresses: func() (bool, error) {
					addresses++
					return mode != "absent-address" && (mode != "delayed-address" || addresses > 1), nil
				},
				ports: func() (bool, error) {
					return (mode != "missing-ports" && mode != "recreate-failure") || recreates > 0, nil
				},
				recreate: func() error {
					recreates++
					if mode == "recreate-failure" {
						return errors.New("injected failure")
					}
					return nil
				},
				probe: func() error {
					probes++
					if mode == "backend-not-ready" {
						return errors.New("HTTP 503")
					}
					return nil
				},
			})
			failed := mode == "absent-address" || mode == "recreate-failure" || mode == "backend-not-ready"
			if (err != nil) != failed {
				t.Fatalf("unexpected result %v", err)
			}
			wantRecreate := 0
			if mode == "missing-ports" || mode == "recreate-failure" {
				wantRecreate = 1
			}
			if recreates != wantRecreate {
				t.Fatalf("recreated %d times", recreates)
			}
			if mode == "absent-address" && probes > 0 {
				t.Fatal("probed unavailable address")
			}
		})
	}
}

func TestDeploymentLockExclusion(t *testing.T) {
	path := filepath.Join(t.TempDir(), "deployment.lock")
	unlock, err := lockDeployment(context.Background(), path)
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Millisecond)
	defer cancel()
	if release, err := lockDeployment(ctx, path); err == nil {
		release()
		t.Fatal("concurrent lock acquired")
	}
	unlock()
	release, err := lockDeployment(context.Background(), path)
	if err != nil {
		t.Fatal(err)
	}
	release()
}

func TestCaddyProbeRejectsUntrustedTLSAndBackendFailure(t *testing.T) {
	server := startIPv4Server(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(http.StatusOK) }), true)
	defer server.Close()
	u, _ := url.Parse(server.URL)
	envPath := filepath.Join(t.TempDir(), ".env")
	if err := os.WriteFile(envPath, []byte("READINESS_PROBE_SECRET='test-readiness-secret'\n"), 0600); err != nil {
		t.Fatal(err)
	}
	app := &App{cfg: Config{EnvFile: envPath}}
	if err := app.probeCaddy(context.Background(), caddyTarget{origin: u, address: u.Host}); err == nil {
		t.Fatal("untrusted TLS accepted")
	}
	var gotPath, gotQuery, gotSecret string
	plain := startIPv4Server(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath, gotQuery, gotSecret = r.URL.Path, r.URL.RawQuery, r.Header.Get("x-crewqual-readiness-secret")
		w.WriteHeader(http.StatusServiceUnavailable)
	}), false)
	defer plain.Close()
	u, _ = url.Parse(plain.URL)
	if err := app.probeCaddy(context.Background(), caddyTarget{origin: u, address: u.Host}); err == nil {
		t.Fatal("503 accepted")
	}
	if gotPath != "/api/health" || gotQuery != "probe=readiness" || gotSecret != "test-readiness-secret" {
		t.Fatalf("unexpected readiness probe: path=%q query=%q secret=%q", gotPath, gotQuery, gotSecret)
	}
}

func TestCaddyProbeRequestUsesReadinessEndpoint(t *testing.T) {
	origin, err := url.Parse("https://example.test:8443/ignored/path?secret=discarded")
	if err != nil {
		t.Fatal(err)
	}
	req, err := newCaddyProbeRequest(context.Background(), origin, "readiness-secret")
	if err != nil {
		t.Fatal(err)
	}
	if req.Method != http.MethodGet || req.URL.Path != "/api/health" || req.URL.RawQuery != "probe=readiness" || req.Header.Get("x-crewqual-readiness-secret") != "readiness-secret" {
		t.Fatalf("unexpected readiness request: %s %s secret=%q", req.Method, req.URL.String(), req.Header.Get("x-crewqual-readiness-secret"))
	}
}

func TestCaddyTargetRejectsNonCanonicalOrigin(t *testing.T) {
	envPath := filepath.Join(t.TempDir(), ".env")
	base := "APP_BIND='0.0.0.0'\nACME_BIND='127.0.0.1'\nAPP_PORT='443'\nACME_PORT='18080'\n"
	for _, suffix := range []string{"/path", "?query=1", "?", "#fragment"} {
		if err := os.WriteFile(envPath, []byte(base+"APP_ORIGIN='https://example.test"+suffix+"'\n"), 0600); err != nil {
			t.Fatal(err)
		}
		if _, err := (&App{cfg: Config{EnvFile: envPath}}).caddyTarget(); err == nil {
			t.Fatalf("accepted non-canonical origin %q", suffix)
		}
	}
}

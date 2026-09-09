package main

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"time"
)

const deploymentLock = "/run/crewqual-updater/deployment.lock"

// At this point the new managed files and application are installed. An
// entrance failure records that actual version and never claims a DB rollback.
func (a *App) finishUpgradeEntrance(job *Job, version string, start, probe func() error) {
	code := "CADDY_START_FAILED"
	err := start()
	if err == nil {
		code = "ENTRANCE_CHECK_FAILED"
		err = probe()
	}
	a.stateMu.Lock()
	defer a.stateMu.Unlock()
	a.state.CurrentVersion = version
	job.CompletedAt = time.Now().UTC().Format(time.RFC3339)
	if err != nil {
		job.Phase, job.ErrorCode, job.Message = "FAILED", code, err.Error()
		a.state.LastError = err.Error()
	} else {
		job.Phase, job.Progress, job.Message = "SUCCEEDED", 100, "更新完成"
		job.ErrorCode, a.state.LastError = "", ""
	}
	_ = a.saveState()
}

func lockDeployment(ctx context.Context, path string) (func(), error) {
	if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
		return nil, err
	}
	fd, err := syscall.Open(path, syscall.O_CREAT|syscall.O_RDWR|syscall.O_NOFOLLOW|syscall.O_CLOEXEC, 0600)
	if err != nil {
		return nil, err
	}
	f := os.NewFile(uintptr(fd), path)
	for {
		err = syscall.Flock(fd, syscall.LOCK_EX|syscall.LOCK_NB)
		if err == nil {
			return func() { _ = syscall.Flock(fd, syscall.LOCK_UN); _ = f.Close() }, nil
		}
		if err != syscall.EWOULDBLOCK && err != syscall.EAGAIN {
			f.Close()
			return nil, err
		}
		if err = caddyPause(ctx); err != nil {
			f.Close()
			return nil, fmt.Errorf("deployment lock timeout: %w", err)
		}
	}
}

func caddyPause(ctx context.Context) error {
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-time.After(time.Second):
		return nil
	}
}

func (a *App) validateCaddyPaths() error {
	root := filepath.Clean(a.cfg.InstallDir)
	if !filepath.IsAbs(root) || root == "/" {
		return errors.New("invalid managed installation directory")
	}
	paths := []string{root, filepath.Join(root, ".crewqual-official-install"), a.cfg.EnvFile, a.cfg.ComposeFile, a.cfg.CaddyFile}
	for i, p := range paths {
		if i > 0 && filepath.Dir(p) != root {
			return errors.New("deployment file outside managed directory")
		}
		resolved, err := filepath.EvalSymlinks(p)
		if err != nil {
			return err
		}
		if resolved != p {
			return errors.New("managed paths must not contain symlinks")
		}
		if err = validateManagedPath(p); err != nil {
			return err
		}
		info, err := os.Stat(p)
		if err != nil {
			return err
		}
		if info.Mode().Perm()&0022 != 0 || (i > 0 && !info.Mode().IsRegular()) {
			return errors.New("unsafe managed file permissions or type")
		}
	}
	return nil
}

type caddyBinding struct {
	HostIP   string `json:"HostIp"`
	HostPort string `json:"HostPort"`
}
type caddyTarget struct {
	ports   map[string][]caddyBinding
	origin  *url.URL
	address string
}

func (a *App) caddyTarget() (caddyTarget, error) {
	value := func(key, fallback string) string {
		v := readEnv(a.cfg.EnvFile, key)
		if v == "" {
			return fallback
		}
		return v
	}
	appIP, acmeIP := value("APP_BIND", "0.0.0.0"), value("ACME_BIND", "127.0.0.1")
	appPort, acmePort := value("APP_PORT", "443"), value("ACME_PORT", "18080")
	if appPort == "80" {
		return caddyTarget{}, errors.New("APP_PORT conflicts with the ACME container port")
	}
	for _, ip := range []string{appIP, acmeIP} {
		if net.ParseIP(ip) == nil {
			return caddyTarget{}, errors.New("invalid Caddy bind IP")
		}
	}
	for _, port := range []string{appPort, acmePort} {
		n, e := strconv.Atoi(port)
		if e != nil || n < 1 || n > 65535 {
			return caddyTarget{}, errors.New("invalid Caddy port")
		}
	}
	u, err := url.Parse(value("APP_ORIGIN", ""))
	if err != nil || u.Hostname() == "" || u.User != nil || u.Path != "" || u.RawQuery != "" || u.ForceQuery || u.Fragment != "" || (u.Scheme != "http" && u.Scheme != "https") {
		return caddyTarget{}, errors.New("invalid APP_ORIGIN")
	}
	originPort := u.Port()
	if originPort == "" {
		if u.Scheme == "https" {
			originPort = "443"
		} else {
			originPort = "80"
		}
	}
	if originPort != appPort {
		return caddyTarget{}, errors.New("APP_ORIGIN port does not match APP_PORT")
	}
	address := appIP
	if net.ParseIP(address).IsUnspecified() {
		if strings.Contains(address, ":") {
			address = "::1"
		} else {
			address = "127.0.0.1"
		}
	}
	return caddyTarget{map[string][]caddyBinding{appPort + "/tcp": {{appIP, appPort}}, "80/tcp": {{acmeIP, acmePort}}}, u, net.JoinHostPort(address, appPort)}, nil
}

func exactCaddyPorts(actual, expected map[string][]caddyBinding) bool {
	for port, bindings := range actual {
		if len(bindings) > 0 && len(expected[port]) == 0 {
			return false
		}
	}
	for port, wanted := range expected {
		got := actual[port]
		if len(got) != len(wanted) {
			return false
		}
		for i := range got {
			if got[i].HostPort != wanted[i].HostPort || !net.ParseIP(got[i].HostIP).Equal(net.ParseIP(wanted[i].HostIP)) {
				return false
			}
		}
	}
	return true
}

func localCaddyAddresses(target caddyTarget) (bool, error) {
	addresses, err := net.InterfaceAddrs()
	if err != nil {
		return false, err
	}
	for _, bindings := range target.ports {
		for _, binding := range bindings {
			ip := net.ParseIP(binding.HostIP)
			if ip.IsUnspecified() {
				continue
			}
			found := false
			for _, addr := range addresses {
				local, _, e := net.ParseCIDR(addr.String())
				if e == nil && local.Equal(ip) {
					found = true
					break
				}
			}
			if !found {
				return false, nil
			}
		}
	}
	return true, nil
}

func caddyDocker(ctx context.Context, args ...string) ([]byte, error) {
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	out, err := exec.CommandContext(ctx, "docker", args...).Output()
	if ctx.Err() != nil {
		return nil, fmt.Errorf("Caddy Docker command timed out: %w", ctx.Err())
	}
	if err != nil {
		return nil, errors.New("Caddy Docker command failed (inspect daemon journal for details)")
	}
	return out, nil
}

func (a *App) caddyComposeArgs(args ...string) []string {
	return append([]string{"compose", "--project-directory", a.cfg.InstallDir, "--env-file", a.cfg.EnvFile, "-f", a.cfg.ComposeFile}, args...)
}

func (a *App) caddyPorts(ctx context.Context, target caddyTarget) (bool, error) {
	out, err := caddyDocker(ctx, a.caddyComposeArgs("ps", "-a", "-q", "caddy")...)
	if err != nil {
		return false, err
	}
	ids := strings.Fields(string(out))
	if len(ids) == 0 {
		return false, nil
	}
	if len(ids) != 1 {
		return false, errors.New("expected one managed Caddy container")
	}
	status, err := caddyDocker(ctx, "inspect", "--format", "{{.State.Status}}", ids[0])
	if err != nil {
		return false, err
	}
	if strings.TrimSpace(string(status)) != "running" {
		return false, nil
	}
	out, err = caddyDocker(ctx, "inspect", "--format", "{{json .NetworkSettings.Ports}}", ids[0])
	if err != nil {
		return false, err
	}
	var ports map[string][]caddyBinding
	if err = json.Unmarshal(out, &ports); err != nil {
		return false, errors.New("invalid Caddy port inspection")
	}
	return exactCaddyPorts(ports, target.ports), nil
}

func (a *App) probeCaddy(ctx context.Context, target caddyTarget) error {
	for _, bindings := range target.ports {
		for _, binding := range bindings {
			ip := binding.HostIP
			if net.ParseIP(ip).IsUnspecified() {
				if strings.Contains(ip, ":") {
					ip = "::1"
				} else {
					ip = "127.0.0.1"
				}
			}
			dialer := net.Dialer{Timeout: 5 * time.Second}
			conn, err := dialer.DialContext(ctx, "tcp", net.JoinHostPort(ip, binding.HostPort))
			if err != nil {
				return errors.New("Caddy published TCP port is unreachable")
			}
			_ = conn.Close()
		}
	}
	roots, err := x509.SystemCertPool()
	if err != nil {
		return err
	}
	// Custom certificates are explicitly installed trust material; public ACME
	// installations use the operating system CA store.
	if strings.Contains(readEnv(a.cfg.EnvFile, "CADDY_TLS_CONFIG"), "/etc/caddy/tls/fullchain.pem") {
		certPath := filepath.Join(a.cfg.InstallDir, "tls", "fullchain.pem")
		if err = validateManagedPath(certPath); err != nil {
			return err
		}
		pem, e := os.ReadFile(certPath)
		if e != nil {
			return e
		}
		if !roots.AppendCertsFromPEM(pem) {
			return errors.New("invalid installed TLS trust material")
		}
	}
	dialer := net.Dialer{Timeout: 5 * time.Second}
	transport := &http.Transport{TLSClientConfig: &tls.Config{MinVersion: tls.VersionTLS12, RootCAs: roots}, DialContext: func(ctx context.Context, network, address string) (net.Conn, error) {
		return dialer.DialContext(ctx, network, target.address)
	}}
	defer transport.CloseIdleConnections()
	client := http.Client{Transport: transport, Timeout: 8 * time.Second, CheckRedirect: func(req *http.Request, via []*http.Request) error { return http.ErrUseLastResponse }}
	req, err := newCaddyProbeRequest(ctx, target.origin, readEnv(a.cfg.EnvFile, "READINESS_PROBE_SECRET"))
	if err != nil {
		return err
	}
	resp, err := client.Do(req)
	if err != nil {
		return errors.New("Caddy entrance TCP/TLS probe failed")
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("Caddy readiness returned HTTP %d", resp.StatusCode)
	}
	return nil
}

func newCaddyProbeRequest(ctx context.Context, origin *url.URL, readinessSecret string) (*http.Request, error) {
	if origin == nil {
		return nil, errors.New("missing Caddy probe origin")
	}
	u := *origin
	u.Path = "/api/health"
	u.RawQuery = "probe=readiness"
	u.Fragment = ""
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u.String(), nil)
	if err != nil {
		return nil, err
	}
	if readinessSecret != "" {
		req.Header.Set("x-crewqual-readiness-secret", readinessSecret)
	}
	return req, nil
}

// Hooks keep the recovery state machine testable without Docker or root network changes.
type caddyChecks struct {
	addresses func() (bool, error)
	ports     func() (bool, error)
	recreate  func() error
	probe     func() error
}

func reconcileCaddyLoop(ctx context.Context, h caddyChecks) error {
	recreated := false
	last := "waiting for configured local bind addresses"
	for {
		if ctx.Err() != nil {
			return fmt.Errorf("Caddy recovery timed out (%s): %w", last, ctx.Err())
		}
		ready, err := h.addresses()
		if err != nil {
			return err
		}
		if ready {
			correct, e := h.ports()
			if e != nil {
				last = e.Error()
			} else if !correct {
				last = "Caddy published ports do not match managed configuration"
				if !recreated {
					if e = h.recreate(); e != nil {
						return e
					}
					recreated = true
					continue
				}
			} else if e = h.probe(); e == nil {
				return nil
			} else {
				last = e.Error()
			}
		}
		if err = caddyPause(ctx); err != nil {
			return fmt.Errorf("Caddy recovery timed out (%s): %w", last, err)
		}
	}
}

func (a *App) reconcileCaddy(ctx context.Context) error {
	if err := a.validateCaddyPaths(); err != nil {
		return err
	}
	target, err := a.caddyTarget()
	if err != nil {
		return err
	}
	return reconcileCaddyLoop(ctx, caddyChecks{
		addresses: func() (bool, error) { return localCaddyAddresses(target) },
		ports:     func() (bool, error) { return a.caddyPorts(ctx, target) },
		recreate: func() error {
			_, e := caddyDocker(ctx, a.caddyComposeArgs("up", "-d", "--no-deps", "--force-recreate", "caddy")...)
			return e
		},
		probe: func() error { return a.probeCaddy(ctx, target) },
	})
}

func (a *App) ensureCaddy() error {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()
	return a.reconcileCaddy(ctx)
}
func (a *App) reconcileCaddyCommand(args []string) error {
	flags := flag.NewFlagSet("reconcile-caddy", flag.ContinueOnError)
	timeout := flags.Duration("timeout", 3*time.Minute, "total recovery timeout including deployment lock")
	if err := flags.Parse(args); err != nil {
		return err
	}
	if flags.NArg() != 0 || *timeout <= 0 || *timeout > 30*time.Minute {
		return errors.New("reconcile-caddy requires a timeout between 0 and 30m")
	}
	ctx, cancel := context.WithTimeout(context.Background(), *timeout)
	defer cancel()
	unlock, err := lockDeployment(ctx, deploymentLock)
	if err != nil {
		return err
	}
	defer unlock()
	return a.reconcileCaddy(ctx)
}

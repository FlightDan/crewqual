// Command crewqual-updater is the privileged, host-side control plane for the
// official single-host installation. It intentionally exposes only a tiny
// authenticated Unix-socket API; the web container never receives Docker
// access or permission to write the deployment directory.
package main

import (
	"bytes"
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"
)

const (
	defaultSocket   = "/run/crewqual-updater/api.sock"
	stateFile       = "state.json"
	backupDir       = "backups"
	maintenanceFile = "maintenance"
)

type Config struct {
	InstallDir        string             `json:"installDir"`
	DataDir           string             `json:"dataDir"`
	ComposeFile       string             `json:"composeFile"`
	EnvFile           string             `json:"envFile"`
	CaddyFile         string             `json:"caddyFile"`
	Socket            string             `json:"socket"`
	SharedSecret      string             `json:"sharedSecret"`
	BackupKey         string             `json:"backupKey"`
	Channel           string             `json:"channel"`
	ReleaseAPIURL     string             `json:"releaseAPIURL"`
	TrustedPublicKeys []TrustedPublicKey `json:"trustedPublicKeys"`
	TrustedPublicKey  string             `json:"trustedPublicKey"`
	ManifestURL       string             `json:"manifestURL"`
	UpdaterVersion    string             `json:"updaterVersion"`
}

type Manifest struct {
	SchemaVersion         int    `json:"schemaVersion"`
	Version               string `json:"version"`
	Channel               string `json:"channel"`
	SigningKeyID          string `json:"signingKeyId"`
	PublishedAt           string `json:"publishedAt"`
	ReleaseNotesURL       string `json:"releaseNotesUrl"`
	ComposeURL            string `json:"composeUrl"`
	ComposeSHA256         string `json:"composeSha256"`
	CaddyURL              string `json:"caddyUrl"`
	CaddySHA256           string `json:"caddySha256"`
	ConfigureDomainURL    string `json:"configureDomainUrl"`
	ConfigureDomainSHA256 string `json:"configureDomainSha256"`
	WebImage              string `json:"webImage"`
	RuntimeImage          string `json:"runtimeImage"`
	Updater               struct {
		AMD64    string `json:"amd64"`
		ARM64    string `json:"arm64"`
		AMD64URL string `json:"amd64Url"`
		ARM64URL string `json:"arm64Url"`
	} `json:"updater"`
	MinimumVersion  string `json:"minimumVersion"`
	MigrationPolicy string `json:"migrationPolicy"`
	MinimumUpdater  string `json:"minimumUpdaterVersion"`
}

type Job struct {
	ID               string `json:"id"`
	RequestedVersion string `json:"requestedVersion"`
	CurrentVersion   string `json:"currentVersion"`
	Phase            string `json:"phase"`
	Progress         int    `json:"progress"`
	Message          string `json:"message"`
	ErrorCode        string `json:"errorCode"`
	BackupPath       string `json:"backupPath"`
	StartedAt        string `json:"startedAt"`
	CompletedAt      string `json:"completedAt"`
	Actor            string `json:"actor"`
}

type State struct {
	CurrentVersion  string      `json:"currentVersion"`
	LatestVersion   string      `json:"latestVersion"`
	ReleaseNotesURL string      `json:"releaseNotesUrl"`
	PublishedAt     string      `json:"releasePublishedAt"`
	LastCheckAt     string      `json:"lastCheckAt"`
	UpdaterVersion  string      `json:"updaterVersion"`
	Job             *Job        `json:"job"`
	LastError       string      `json:"lastError"`
	NetworkJob      *NetworkJob `json:"networkJob"`
}

type NetworkJob struct {
	ID          string `json:"id"`
	Phase       string `json:"phase"`
	Progress    int    `json:"progress"`
	Message     string `json:"message"`
	ErrorCode   string `json:"errorCode"`
	StartedAt   string `json:"startedAt"`
	CompletedAt string `json:"completedAt"`
	Actor       string `json:"actor"`
	TargetURL   string `json:"targetUrl"`
}

type NetworkInput struct {
	Mode     string `json:"mode"`
	Origin   string `json:"origin"`
	Domain   string `json:"domain"`
	TLSEmail string `json:"tlsEmail"`
	Port     int    `json:"port"`
	Site     string `json:"siteAddress"`
	AppBind  string `json:"appBind"`
	AcmeBind string `json:"acmeBind"`
	AcmePort int    `json:"acmePort"`
	Actor    string `json:"actor"`
}

type App struct {
	cfg         Config
	stateMu     sync.Mutex
	state       State
	manifest    *Manifest
	manifestRaw []byte
	nonceMu     sync.Mutex
	nonces      map[string]time.Time
}

type envelope struct {
	Data  any    `json:"data,omitempty"`
	Error string `json:"error,omitempty"`
}

var versionPattern = exactVersionPattern

func main() {
	if len(os.Args) > 1 && os.Args[1] == "verify-manifest" {
		fatal(verifyManifestCommand(os.Args[2:]))
		return
	}
	cfgPath := os.Getenv("CREWQUAL_UPDATER_CONFIG")
	if cfgPath == "" {
		cfgPath = "/etc/crewqual-updater/config.json"
	}
	cfg, err := loadConfig(cfgPath)
	if err != nil {
		fatal(err)
	}
	if len(os.Args) > 1 && os.Args[1] == "reconcile-caddy" {
		if err = validateManagedPath(cfgPath); err != nil {
			fatal(err)
		}
		fatal((&App{cfg: cfg}).reconcileCaddyCommand(os.Args[2:]))
		return
	}
	app, err := newApp(cfg)
	if err != nil {
		fatal(err)
	}
	command := "serve"
	if len(os.Args) > 1 {
		command = os.Args[1]
	}
	switch command {
	case "serve":
		fatal(app.serve())
	case "check":
		_, err := app.check()
		fatal(err)
	case "status":
		fatal(writeJSON(os.Stdout, app.status()))
	case "reconcile-caddy":
		fatal(app.reconcileCaddyCommand(os.Args[2:]))
	default:
		fatal(fmt.Errorf("usage: crewqual-updater [serve|check|status|verify-manifest|reconcile-caddy]"))
	}
}

func verifyManifestCommand(args []string) error {
	flags := flag.NewFlagSet("verify-manifest", flag.ContinueOnError)
	manifestPath := flags.String("manifest", "", "manifest JSON path")
	signaturePath := flags.String("signature", "", "manifest signature path")
	expectedTag := flags.String("tag", "", "expected release tag")
	if err := flags.Parse(args); err != nil {
		return err
	}
	if *manifestPath == "" || *signaturePath == "" {
		return errors.New("verify-manifest requires --manifest and --signature")
	}
	keys, err := builtinTrustedKeys()
	if err != nil {
		return err
	}
	if os.Getenv("CREWQUAL_INSTALL_TEST_MODE") == "1" {
		if testKey := os.Getenv("CREWQUAL_TEST_TRUSTED_PUBLIC_KEY"); testKey != "" {
			keys = []TrustedPublicKey{{ID: os.Getenv("CREWQUAL_TEST_KEY_ID"), PublicKey: testKey, Status: "active"}}
			if keys[0].ID == "" {
				keys[0].ID = "test-ed25519"
			}
		}
	}
	raw, err := os.ReadFile(*manifestPath)
	if err != nil {
		return err
	}
	signature, err := os.ReadFile(*signaturePath)
	if err != nil {
		return err
	}
	manifest, err := verifyManifestBytes(raw, signature, keys, *expectedTag)
	if err != nil {
		return err
	}
	return writeJSON(os.Stdout, manifest)
}

func fatal(err error) {
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func loadConfig(path string) (Config, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return Config{}, err
	}
	var cfg Config
	if err := json.Unmarshal(raw, &cfg); err != nil {
		return Config{}, err
	}
	if cfg.InstallDir == "" || cfg.ComposeFile == "" || cfg.EnvFile == "" || cfg.SharedSecret == "" {
		return Config{}, errors.New("updater config is incomplete")
	}
	if cfg.Socket == "" {
		cfg.Socket = defaultSocket
	}
	if cfg.CaddyFile == "" {
		cfg.CaddyFile = filepath.Join(cfg.InstallDir, "Caddyfile")
	}
	if cfg.DataDir == "" {
		cfg.DataDir = "/var/lib/crewqual-updater"
	}
	if cfg.UpdaterVersion == "" {
		cfg.UpdaterVersion = "0.1.0"
	}
	if cfg.Channel == "" {
		cfg.Channel = "stable"
	}
	if cfg.Channel != "stable" && cfg.Channel != "rc" {
		return Config{}, errors.New("updater channel must be stable or rc")
	}
	if cfg.ReleaseAPIURL == "" {
		cfg.ReleaseAPIURL = "https://api.github.com/repos/" + officialRepository + "/releases"
	}
	if len(cfg.TrustedPublicKeys) == 0 {
		builtin, keyringErr := builtinTrustedKeys()
		if keyringErr != nil {
			return Config{}, keyringErr
		}
		if cfg.TrustedPublicKey != "" {
			matched := false
			for _, key := range builtin {
				if key.PublicKey == cfg.TrustedPublicKey && key.Status != "retired" {
					cfg.TrustedPublicKeys = []TrustedPublicKey{key}
					matched = true
					break
				}
			}
			if !matched {
				return Config{}, errors.New("legacy trustedPublicKey is not present in the built-in keyring")
			}
		} else {
			cfg.TrustedPublicKeys = builtin
		}
	}
	keyringRaw, err := json.Marshal(keyringDocument{SchemaVersion: 1, Keys: cfg.TrustedPublicKeys})
	if err != nil {
		return Config{}, err
	}
	if _, err := loadKeyring(keyringRaw); err != nil {
		return Config{}, fmt.Errorf("invalid updater trustedPublicKeys: %w", err)
	}
	return cfg, nil
}

func newApp(cfg Config) (*App, error) {
	app := &App{cfg: cfg, state: State{UpdaterVersion: cfg.UpdaterVersion}, nonces: make(map[string]time.Time)}
	if raw, err := os.ReadFile(filepath.Join(cfg.DataDir, stateFile)); err == nil {
		_ = json.Unmarshal(raw, &app.state)
	}
	if app.state.CurrentVersion == "" {
		app.state.CurrentVersion = readEnv(filepath.Join(cfg.InstallDir, ".env"), "CREWQUAL_VERSION")
	}
	if app.state.UpdaterVersion == "" {
		app.state.UpdaterVersion = cfg.UpdaterVersion
	}
	return app, nil
}

func (a *App) statePath() string { return filepath.Join(a.cfg.DataDir, stateFile) }

func (a *App) maintenancePath() string {
	return filepath.Join(filepath.Dir(a.cfg.Socket), maintenanceFile)
}

func (a *App) setMaintenance(enabled bool, job *Job) error {
	path := a.maintenancePath()
	if !enabled {
		if err := os.Remove(path); err != nil && !errors.Is(err, os.ErrNotExist) {
			return err
		}
		return nil
	}
	if err := os.MkdirAll(filepath.Dir(path), 0750); err != nil {
		return err
	}
	payload := map[string]string{
		"jobId":     job.ID,
		"version":   job.RequestedVersion,
		"startedAt": job.StartedAt,
	}
	raw, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	return atomicWrite(path, append(raw, '\n'), 0644)
}

func (a *App) saveState() error {
	a.state.UpdaterVersion = a.cfg.UpdaterVersion
	raw, err := json.MarshalIndent(a.state, "", "  ")
	if err != nil {
		return err
	}
	if err := os.MkdirAll(a.cfg.DataDir, 0700); err != nil {
		return err
	}
	tmp := a.statePath() + ".new"
	if err := os.WriteFile(tmp, append(raw, '\n'), 0600); err != nil {
		return err
	}
	return os.Rename(tmp, a.statePath())
}

func (a *App) status() map[string]any {
	a.stateMu.Lock()
	defer a.stateMu.Unlock()
	job := a.state.Job
	jobRunning := job != nil && !jobDone(job)
	networkRunning := a.state.NetworkJob != nil && !networkJobDone(a.state.NetworkJob)
	canInstall := a.manifest != nil && !jobRunning && !networkRunning
	reason := ""
	if jobRunning {
		canInstall = false
		reason = "更新任务正在执行"
	}
	if networkRunning {
		canInstall = false
		if reason == "" {
			reason = "网络配置任务正在执行"
		}
	}
	if a.manifest == nil && reason == "" {
		reason = "尚未检查正式版本或签名清单不可用"
	}
	return map[string]any{
		"mode": "managed", "currentVersion": a.state.CurrentVersion,
		"latestVersion": a.state.LatestVersion, "releaseNotesUrl": a.state.ReleaseNotesURL,
		"releasePublishedAt": a.state.PublishedAt, "canInstall": canInstall,
		"reason": reason, "updaterVersion": a.state.UpdaterVersion,
		"job": job, "networkJob": a.state.NetworkJob,
	}
}

func (a *App) serve() error {
	var listener net.Listener
	var err error
	if os.Getenv("LISTEN_FDS") == "1" {
		file := os.NewFile(uintptr(3), "crewqual-updater.socket")
		listener, err = net.FileListener(file)
		_ = file.Close()
	} else {
		if err := os.MkdirAll(filepath.Dir(a.cfg.Socket), 0750); err != nil {
			return err
		}
		_ = os.Remove(a.cfg.Socket)
		listener, err = net.Listen("unix", a.cfg.Socket)
	}
	if err != nil {
		return err
	}
	defer listener.Close()
	if os.Getenv("LISTEN_FDS") != "1" {
		if err := os.Chmod(a.cfg.Socket, 0666); err != nil {
			return err
		}
	}
	mux := http.NewServeMux()
	mux.HandleFunc("/v1/status", a.auth(a.handleStatus))
	mux.HandleFunc("/v1/check", a.auth(a.handleCheck))
	mux.HandleFunc("/v1/install", a.auth(a.handleInstall))
	mux.HandleFunc("/v1/network/apply", a.auth(a.handleNetworkApply))
	return http.Serve(listener, mux)
}

func (a *App) auth(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		body, err := io.ReadAll(io.LimitReader(r.Body, 64*1024))
		if err != nil {
			writeError(w, 400, err)
			return
		}
		if !a.validMAC(r, body) {
			writeError(w, 401, errors.New("invalid updater request signature"))
			return
		}
		r.Body = io.NopCloser(strings.NewReader(string(body)))
		next(w, r)
	}
}

func (a *App) validMAC(r *http.Request, body []byte) bool {
	timestamp := r.Header.Get("X-Crewqual-Timestamp")
	nonce := r.Header.Get("X-Crewqual-Nonce")
	provided := r.Header.Get("X-Crewqual-Signature")
	when, err := strconv.ParseInt(timestamp, 10, 64)
	if err != nil || time.Since(time.UnixMilli(when)) > 30*time.Second || time.Since(time.UnixMilli(when)) < -30*time.Second || nonce == "" || provided == "" {
		return false
	}
	a.nonceMu.Lock()
	now := time.Now()
	for key, seen := range a.nonces {
		if now.Sub(seen) > 2*time.Minute {
			delete(a.nonces, key)
		}
	}
	if _, exists := a.nonces[nonce]; exists {
		a.nonceMu.Unlock()
		return false
	}
	a.nonces[nonce] = now
	a.nonceMu.Unlock()
	mac := hmac.New(sha256.New, []byte(a.cfg.SharedSecret))
	_, _ = mac.Write([]byte(timestamp + "." + nonce + "." + string(body)))
	actual := hex.EncodeToString(mac.Sum(nil))
	return hmac.Equal([]byte(actual), []byte(provided))
}

func (a *App) handleStatus(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, 405, errors.New("method not allowed"))
		return
	}
	writeData(w, a.status())
}

func (a *App) handleCheck(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, 405, errors.New("method not allowed"))
		return
	}
	manifest, err := a.check()
	if err != nil {
		writeError(w, 503, err)
		return
	}
	writeData(w, a.statusWithManifest(manifest))
}

func (a *App) handleInstall(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, 405, errors.New("method not allowed"))
		return
	}
	var input struct {
		Version string `json:"version"`
		ActorID string `json:"actorId"`
		Actor   string `json:"actorName"`
	}
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil || !versionPattern.MatchString(input.Version) {
		writeError(w, 422, errors.New("invalid install request"))
		return
	}
	a.stateMu.Lock()
	if a.state.Job != nil && !jobDone(a.state.Job) {
		a.stateMu.Unlock()
		writeError(w, 409, errors.New("an update is already running"))
		return
	}
	if a.state.NetworkJob != nil && !networkJobDone(a.state.NetworkJob) {
		a.stateMu.Unlock()
		writeError(w, 409, errors.New("a network configuration job is already running"))
		return
	}
	if a.manifest == nil || a.manifest.Version != input.Version {
		a.stateMu.Unlock()
		writeError(w, 409, errors.New("requested version is not the verified latest release"))
		return
	}
	job := &Job{ID: randomID(), RequestedVersion: input.Version, CurrentVersion: a.state.CurrentVersion, Phase: "CHECKING", Progress: 1, Message: "更新任务已接受", StartedAt: time.Now().UTC().Format(time.RFC3339), Actor: input.Actor}
	a.state.Job = job
	_ = a.saveState()
	a.stateMu.Unlock()
	go a.run(job, *a.manifest)
	writeData(w, map[string]any{"job": job})
}

func (a *App) handleNetworkApply(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, 405, errors.New("method not allowed"))
		return
	}
	var input NetworkInput
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		writeError(w, 422, errors.New("invalid network configuration"))
		return
	}
	if err := validateNetworkInput(input); err != nil {
		writeError(w, 422, err)
		return
	}
	a.stateMu.Lock()
	if a.state.Job != nil && !jobDone(a.state.Job) {
		a.stateMu.Unlock()
		writeError(w, 409, errors.New("an update is already running"))
		return
	}
	if a.state.NetworkJob != nil && !networkJobDone(a.state.NetworkJob) {
		a.stateMu.Unlock()
		writeError(w, 409, errors.New("a network configuration job is already running"))
		return
	}
	job := &NetworkJob{
		ID: randomID(), Phase: "STAGING", Progress: 5,
		Message: "网络配置任务已接受", StartedAt: time.Now().UTC().Format(time.RFC3339),
		Actor: input.Actor, TargetURL: input.Origin,
	}
	a.state.NetworkJob = job
	_ = a.saveState()
	a.stateMu.Unlock()
	go a.runNetwork(job, input)
	w.WriteHeader(http.StatusAccepted)
	writeData(w, map[string]any{"networkJob": job})
}

func networkJobDone(job *NetworkJob) bool {
	return job.Phase == "SUCCEEDED" || job.Phase == "FAILED" || job.Phase == "ROLLED_BACK"
}

func jobDone(job *Job) bool {
	return job.Phase == "SUCCEEDED" || job.Phase == "FAILED" || job.Phase == "ROLLED_BACK" || job.Phase == "NEEDS_MANUAL_RECOVERY"
}

func validateNetworkInput(input NetworkInput) error {
	if input.Mode != "lan" && input.Mode != "http" && input.Mode != "tls" {
		return errors.New("network mode must be lan, http, or tls")
	}
	if input.Port < 1 || input.Port > 65535 || input.Port == 80 {
		return errors.New("application port must be 1-65535 and cannot be 80")
	}
	parsed, err := url.Parse(input.Origin)
	if err != nil || parsed.Path != "" || parsed.RawQuery != "" || parsed.Fragment != "" || parsed.Host == "" || parsed.User != nil {
		return errors.New("origin must be an exact URL without a path")
	}
	if input.Mode == "tls" && parsed.Scheme != "https" {
		return errors.New("TLS mode requires an HTTPS origin")
	}
	if (input.Mode == "lan" || input.Mode == "http") && parsed.Scheme != "http" {
		return errors.New("LAN and public HTTP modes require an HTTP origin")
	}
	if input.Mode == "lan" {
		ip := net.ParseIP(parsed.Hostname())
		privateIPv4 := ip != nil && ip.To4() != nil && ip.IsPrivate()
		loopbackIPv4 := ip != nil && ip.To4() != nil && ip.IsLoopback()
		if parsed.Hostname() != "localhost" && !privateIPv4 && !loopbackIPv4 {
			return errors.New("LAN mode requires a private or loopback origin")
		}
	}
	expectedPort := strconv.Itoa(input.Port)
	actualPort := parsed.Port()
	if actualPort == "" {
		actualPort = map[string]string{"http": "80", "https": "443"}[parsed.Scheme]
	}
	if actualPort != expectedPort {
		return errors.New("origin port must match application port")
	}
	if input.Domain == "" {
		return errors.New("network domain is required")
	}
	if input.Mode == "tls" && input.TLSEmail == "" {
		return errors.New("TLS email is required")
	}
	if input.AcmePort < 1 || input.AcmePort > 65535 {
		return errors.New("ACME port is invalid")
	}
	if input.Site == "" || input.AppBind == "" || input.AcmeBind == "" {
		return errors.New("network bind fields are required")
	}
	return nil
}

func (a *App) runNetwork(job *NetworkJob, input NetworkInput) {
	setPhase := func(phase string, progress int, message string) {
		a.stateMu.Lock()
		job.Phase, job.Progress, job.Message = phase, progress, message
		_ = a.saveState()
		a.stateMu.Unlock()
	}
	fail := func(code string, err error, rolledBack bool) {
		a.stateMu.Lock()
		job.ErrorCode, job.Message, job.CompletedAt = code, err.Error(), time.Now().UTC().Format(time.RFC3339)
		job.Phase = "FAILED"
		if rolledBack {
			job.Phase = "ROLLED_BACK"
		}
		a.state.LastError = err.Error()
		_ = a.saveState()
		a.stateMu.Unlock()
	}
	lockCtx, lockCancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer lockCancel()
	unlock, err := lockDeployment(lockCtx, deploymentLock)
	if err != nil {
		fail("DEPLOYMENT_LOCK_FAILED", err, false)
		return
	}
	defer unlock()
	if err = a.validateCaddyPaths(); err != nil {
		fail("PREFLIGHT_FAILED", err, false)
		return
	}
	previous, err := os.ReadFile(a.cfg.EnvFile)
	if err != nil {
		fail("ENV_READ_FAILED", err, false)
		return
	}
	values := map[string]string{
		"DEPLOYMENT_NETWORK_MODE": input.Mode,
		"APP_ORIGIN":              input.Origin,
		"APP_DOMAIN":              input.Domain,
		"TLS_EMAIL":               input.TLSEmail,
		"APP_PORT":                strconv.Itoa(input.Port),
		"CADDY_SITE_ADDRESS":      input.Site,
		"APP_BIND":                input.AppBind,
		"ACME_BIND":               input.AcmeBind,
		"ACME_PORT":               strconv.Itoa(input.AcmePort),
	}
	if secret := readEnv(a.cfg.EnvFile, "NETWORK_ACCESS_SECRET"); secret != "" {
		values["NETWORK_ACCESS_SECRET"] = secret
	} else {
		values["NETWORK_ACCESS_SECRET"] = randomID()
	}
	staged := []byte(updateEnv(string(previous), values))
	stagedFile, tempErr := os.CreateTemp("", "crewqual-network-env-")
	if tempErr != nil {
		fail("STAGED_ENV_FAILED", tempErr, false)
		return
	}
	stagedPath := stagedFile.Name()
	defer os.Remove(stagedPath)
	if _, err = stagedFile.Write(staged); err != nil {
		_ = stagedFile.Close()
		fail("STAGED_ENV_FAILED", err, false)
		return
	}
	_ = stagedFile.Close()
	_ = os.Chmod(stagedPath, 0600)
	if err = a.runComposeWith(a.cfg.ComposeFile, stagedPath, "config", "--quiet"); err != nil {
		fail("CONFIG_VALIDATE_FAILED", err, false)
		return
	}
	if err = atomicWrite(a.cfg.EnvFile, staged, 0600); err != nil {
		fail("ENV_WRITE_FAILED", err, false)
		return
	}
	setPhase("RESTARTING", 45, "重建网络入口和应用容器")
	restoreNetwork := func(code string, cause error) {
		if e := atomicWrite(a.cfg.EnvFile, previous, 0600); e != nil {
			fail("MANUAL_RECOVERY_REQUIRED", e, false)
			return
		}
		if e := a.runCompose("up", "-d", "--no-deps", "web", "worker", "caddy"); e != nil {
			fail("MANUAL_RECOVERY_REQUIRED", e, false)
			return
		}
		if e := a.ensureCaddy(); e != nil {
			fail("MANUAL_RECOVERY_REQUIRED", e, false)
			return
		}
		fail(code, cause, true)
	}
	if err = a.runCompose("up", "-d", "--no-deps", "web", "worker", "caddy"); err != nil {
		restoreNetwork("RESTART_FAILED", err)
		return
	}
	setPhase("HEALTH_CHECKING", 75, "等待 Web 与 Worker 健康")
	if err = a.waitHealthy("web"); err != nil {
		restoreNetwork("HEALTH_CHECK_FAILED", err)
		return
	}
	if err = a.waitHealthy("worker"); err != nil {
		restoreNetwork("HEALTH_CHECK_FAILED", err)
		return
	}
	if err = a.ensureCaddy(); err != nil {
		restoreNetwork("ENTRANCE_CHECK_FAILED", err)
		return
	}
	setPhase("SUCCEEDED", 100, "网络配置已应用")
	a.stateMu.Lock()
	a.state.LastError = ""
	_ = a.saveState()
	a.stateMu.Unlock()
}

func randomID() string {
	b := make([]byte, 12)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

func (a *App) statusWithManifest(m *Manifest) map[string]any {
	status := a.status()
	status["latestVersion"] = m.Version
	status["releaseNotesUrl"] = m.ReleaseNotesURL
	status["releasePublishedAt"] = m.PublishedAt
	a.stateMu.Lock()
	busy := (a.state.Job != nil && !jobDone(a.state.Job)) || (a.state.NetworkJob != nil && !networkJobDone(a.state.NetworkJob))
	currentVersion := a.state.CurrentVersion
	a.stateMu.Unlock()
	status["canInstall"] = !busy && compareVersion(m.Version, currentVersion) > 0 && m.MigrationPolicy != "manual-required" && (m.MinimumVersion == "" || compareVersion(currentVersion, m.MinimumVersion) >= 0)
	if m.MigrationPolicy == "manual-required" {
		status["reason"] = "该版本包含破坏性数据库迁移，需要人工维护升级"
	}
	return status
}

func (a *App) check() (*Manifest, error) {
	manifestURL, expectedTag, err := resolveManifestRelease(a.cfg)
	if err != nil {
		return nil, err
	}
	raw, err := newReleaseHTTPClient().get(manifestURL, 2*1024*1024)
	if err != nil {
		return nil, err
	}
	signature, err := newReleaseHTTPClient().get(manifestURL+".sig", 4096)
	if err != nil {
		return nil, err
	}
	manifest, err := verifyManifestBytes(raw, signature, a.cfg.TrustedPublicKeys, expectedTag)
	if err != nil {
		return nil, err
	}
	if a.cfg.Channel == "stable" && manifest.Channel != "stable" {
		return nil, errors.New("stable updater channel refuses a release candidate")
	}
	a.stateMu.Lock()
	a.manifest, a.manifestRaw = &manifest, raw
	a.state.LatestVersion, a.state.ReleaseNotesURL, a.state.PublishedAt = manifest.Version, manifest.ReleaseNotesURL, manifest.PublishedAt
	a.state.LastCheckAt = time.Now().UTC().Format(time.RFC3339)
	_ = a.saveState()
	a.stateMu.Unlock()
	return &manifest, nil
}

func (a *App) run(job *Job, manifest Manifest) {
	setPhase := func(phase string, progress int, message string) {
		a.stateMu.Lock()
		job.Phase, job.Progress, job.Message = phase, progress, message
		_ = a.saveState()
		a.stateMu.Unlock()
	}
	fail := func(code string, err error) {
		a.stateMu.Lock()
		job.Phase, job.ErrorCode, job.Message, job.CompletedAt = "FAILED", code, err.Error(), time.Now().UTC().Format(time.RFC3339)
		a.state.LastError = err.Error()
		_ = a.saveState()
		a.stateMu.Unlock()
	}
	rollbackDatabase := func(code string, cause error, backupPath string) {
		if restoreErr := a.restoreDatabase(backupPath); restoreErr != nil {
			fail("DATABASE_ROLLBACK_FAILED", fmt.Errorf("%s；数据库自动恢复失败: %w", cause, restoreErr))
			a.stateMu.Lock()
			job.Phase = "NEEDS_MANUAL_RECOVERY"
			_ = a.saveState()
			a.stateMu.Unlock()
			return
		}
		fail(code, cause)
		a.stateMu.Lock()
		job.Phase = "ROLLED_BACK"
		_ = a.saveState()
		a.stateMu.Unlock()
	}

	if manifest.MigrationPolicy == "manual-required" {
		fail("MANUAL_MIGRATION_REQUIRED", errors.New("该版本需要人工维护升级"))
		return
	}
	lockCtx, lockCancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer lockCancel()
	unlock, lockErr := lockDeployment(lockCtx, deploymentLock)
	if lockErr != nil {
		fail("DEPLOYMENT_LOCK_FAILED", lockErr)
		return
	}
	defer unlock()
	setPhase("PREFLIGHT", 10, "检查部署与发布清单")
	if err := a.preflight(manifest); err != nil {
		fail("PREFLIGHT_FAILED", err)
		return
	}
	setPhase("DOWNLOADING", 20, "拉取并校验部署文件与镜像")
	temp, err := os.MkdirTemp("", "crewqual-update-")
	if err != nil {
		fail("TEMP_DIR_FAILED", err)
		return
	}
	defer os.RemoveAll(temp)
	composePath := filepath.Join(temp, "compose.yaml")
	caddyPath := filepath.Join(temp, "Caddyfile")
	configureDomainPath := filepath.Join(temp, "configure-domain.sh")
	if err = downloadAndHash(manifest.ComposeURL, composePath, manifest.ComposeSHA256); err != nil {
		fail("COMPOSE_DOWNLOAD_FAILED", err)
		return
	}
	if err = downloadAndHash(manifest.CaddyURL, caddyPath, manifest.CaddySHA256); err != nil {
		fail("CADDY_DOWNLOAD_FAILED", err)
		return
	}
	if manifest.ConfigureDomainURL != "" {
		if err = downloadAndHash(manifest.ConfigureDomainURL, configureDomainPath, manifest.ConfigureDomainSHA256); err != nil {
			fail("NETWORK_SCRIPT_DOWNLOAD_FAILED", err)
			return
		}
	}
	stagedEnv := filepath.Join(temp, ".env")
	currentEnv, readErr := os.ReadFile(a.cfg.EnvFile)
	if readErr != nil {
		fail("ENV_READ_FAILED", readErr)
		return
	}
	if err = os.WriteFile(stagedEnv, []byte(updateEnv(string(currentEnv), map[string]string{"CREWQUAL_VERSION": manifest.Version, "CREWQUAL_WEB_IMAGE": manifest.WebImage, "CREWQUAL_RUNTIME_IMAGE": manifest.RuntimeImage})), 0600); err != nil {
		fail("STAGED_ENV_FAILED", err)
		return
	}
	if err = a.runComposeWith(composePath, stagedEnv, "pull", "--quiet"); err != nil {
		fail("IMAGE_PULL_FAILED", err)
		return
	}
	setPhase("BACKING_UP", 35, "创建并验证数据库保护备份")
	if err := a.setMaintenance(true, job); err != nil {
		fail("MAINTENANCE_MARKER_FAILED", err)
		return
	}
	maintenanceEnabled := true
	defer func() {
		if maintenanceEnabled {
			_ = a.setMaintenance(false, job)
		}
	}()
	backup, err := a.backupDatabase(job.ID)
	if err != nil {
		fail("BACKUP_FAILED", err)
		return
	}
	job.BackupPath = backup
	setPhase("MIGRATING", 55, "执行数据库迁移与初始化")
	if err = a.runComposeWith(composePath, stagedEnv, "run", "--rm", "--no-deps", "migrate"); err != nil {
		rollbackDatabase("MIGRATION_FAILED", err, backup)
		return
	}
	if err = a.runComposeWith(composePath, stagedEnv, "run", "--rm", "--no-deps", "bootstrap"); err != nil {
		rollbackDatabase("BOOTSTRAP_FAILED", err, backup)
		return
	}
	previousCompose, _ := os.ReadFile(a.cfg.ComposeFile)
	previousCaddy, _ := os.ReadFile(a.cfg.CaddyFile)
	previousEnv, _ := os.ReadFile(a.cfg.EnvFile)
	if err = writeManagedFiles(a.cfg, composePath, caddyPath, configureDomainPath, manifest); err != nil {
		fail("ATOMIC_INSTALL_FAILED", err)
		return
	}
	setPhase("RESTARTING", 70, "重启 Web 与 Worker")
	if err = a.runCompose("up", "-d", "--no-deps", "web", "worker"); err != nil {
		rollbackErr := a.rollback(previousCompose, previousCaddy, previousEnv, backup)
		if rollbackErr != nil {
			fail("MANUAL_RECOVERY_REQUIRED", fmt.Errorf("更新失败且自动回退失败: %w", rollbackErr))
			return
		}
		fail("RESTART_FAILED", err)
		return
	}
	setPhase("HEALTH_CHECKING", 85, "等待服务健康")
	if err = a.waitHealthy("web"); err != nil {
		rollbackErr := a.rollback(previousCompose, previousCaddy, previousEnv, backup)
		if rollbackErr != nil {
			fail("MANUAL_RECOVERY_REQUIRED", fmt.Errorf("健康检查失败且自动回退失败: %w", rollbackErr))
			return
		}
		fail("HEALTH_CHECK_FAILED", err)
		a.stateMu.Lock()
		job.Phase = "ROLLED_BACK"
		_ = a.saveState()
		a.stateMu.Unlock()
		return
	}
	a.finishUpgradeEntrance(job, manifest.Version, func() error { return a.runCompose("up", "-d", "--no-deps", "caddy") }, a.ensureCaddy)
}

func (a *App) preflight(manifest Manifest) error {
	if err := a.validateCaddyPaths(); err != nil {
		return err
	}
	if _, err := a.caddyTarget(); err != nil {
		return fmt.Errorf("invalid Caddy entrance configuration: %w", err)
	}
	if err := validateManagedPath(a.cfg.InstallDir); err != nil {
		return err
	}
	if err := validateManagedPath(filepath.Join(a.cfg.InstallDir, ".crewqual-official-install")); err != nil {
		return errors.New("deployment is not marked as an official CrewQual installation")
	}
	for _, path := range []string{a.cfg.ComposeFile, a.cfg.EnvFile, a.cfg.CaddyFile} {
		if err := validateManagedPath(path); err != nil {
			return err
		}
	}
	if _, err := exec.LookPath("docker"); err != nil {
		return errors.New("docker is unavailable")
	}
	var fs syscall.Statfs_t
	if err := syscall.Statfs(a.cfg.DataDir, &fs); err == nil {
		available := uint64(fs.Bavail) * uint64(fs.Bsize)
		if available < 512*1024*1024 {
			return errors.New("磁盘可用空间不足 512 MiB")
		}
	}
	if manifest.MinimumUpdater != "" && compareVersion("v"+a.cfg.UpdaterVersion, "v"+manifest.MinimumUpdater) < 0 {
		return errors.New("当前更新器版本过低，请先修复更新器")
	}
	current := a.state.CurrentVersion
	if current != "" && compareVersion(manifest.Version, current) <= 0 {
		return errors.New("只允许升级到更高版本")
	}
	if manifest.MinimumVersion != "" && current != "" && compareVersion(current, manifest.MinimumVersion) < 0 {
		return errors.New("当前版本跨度过大，请先执行中间版本升级")
	}
	return nil
}

func (a *App) runCompose(args ...string) error {
	return a.runComposeWith(a.cfg.ComposeFile, a.cfg.EnvFile, args...)
}

func (a *App) runComposeWith(composeFile, envFile string, args ...string) error {
	full := append([]string{"compose", "--project-directory", a.cfg.InstallDir, "--env-file", envFile, "-f", composeFile}, args...)
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Minute)
	defer cancel()
	cmd := exec.CommandContext(ctx, "docker", full...)
	cmd.Stdout, cmd.Stderr = os.Stdout, os.Stderr
	err := cmd.Run()
	if ctx.Err() != nil {
		return fmt.Errorf("docker compose timed out: %w", ctx.Err())
	}
	return err
}

func (a *App) waitHealthy(service string) error {
	deadline := time.Now().Add(5 * time.Minute)
	for time.Now().Before(deadline) {
		cmd := exec.Command("docker", "compose", "--project-directory", a.cfg.InstallDir, "--env-file", a.cfg.EnvFile, "-f", a.cfg.ComposeFile, "ps", "-q", service)
		out, err := cmd.Output()
		if err == nil && strings.TrimSpace(string(out)) != "" {
			id := strings.TrimSpace(string(out))
			status, _ := exec.Command("docker", "inspect", "--format", "{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}", id).Output()
			if strings.TrimSpace(string(status)) == "healthy" {
				return nil
			}
		}
		time.Sleep(3 * time.Second)
	}
	return fmt.Errorf("%s did not become healthy", service)
}

func (a *App) backupDatabase(jobID string) (string, error) {
	if a.cfg.BackupKey == "" {
		return "", errors.New("updater backup key is not configured")
	}
	if err := os.MkdirAll(filepath.Join(a.cfg.DataDir, backupDir), 0700); err != nil {
		return "", err
	}
	rawPath := filepath.Join(os.TempDir(), "crewqual-"+jobID+".dump")
	defer os.Remove(rawPath)
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Minute)
	defer cancel()
	cmd := exec.CommandContext(ctx, "docker", "compose", "--project-directory", a.cfg.InstallDir, "--env-file", a.cfg.EnvFile, "-f", a.cfg.ComposeFile, "exec", "-T", "postgres", "pg_dump", "-U", "crewqual", "-d", "crewqual", "--format=custom")
	out, err := os.Create(rawPath)
	if err != nil {
		return "", err
	}
	if ctx.Err() != nil {
		return "", fmt.Errorf("database backup timed out: %w", ctx.Err())
	}
	cmd.Stdout, cmd.Stderr = out, os.Stderr
	err = cmd.Run()
	_ = out.Close()
	if err != nil {
		return "", err
	}
	raw, err := os.ReadFile(rawPath)
	if err != nil {
		return "", err
	}
	keyBytes := sha256.Sum256([]byte(a.cfg.BackupKey))
	block, err := aes.NewCipher(keyBytes[:])
	if err != nil {
		return "", err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}
	nonce := make([]byte, gcm.NonceSize())
	if _, err = rand.Read(nonce); err != nil {
		return "", err
	}
	sealed := append(nonce, gcm.Seal(nil, nonce, raw, nil)...)
	destination := filepath.Join(a.cfg.DataDir, backupDir, jobID+".dump.enc")
	if err = os.WriteFile(destination, sealed, 0600); err != nil {
		return "", err
	}
	check, err := decryptFile(destination, a.cfg.BackupKey)
	if err != nil || len(check) == 0 {
		return "", errors.New("backup verification failed")
	}
	validate := exec.Command("docker", "compose", "--project-directory", a.cfg.InstallDir, "--env-file", a.cfg.EnvFile, "-f", a.cfg.ComposeFile, "exec", "-T", "postgres", "pg_restore", "--list")
	validate.Stdin = bytes.NewReader(check)
	if err := validate.Run(); err != nil {
		return "", fmt.Errorf("backup pg_restore validation failed: %w", err)
	}
	if err = pruneBackupFiles(filepath.Join(a.cfg.DataDir, backupDir), destination, 3); err != nil {
		return "", fmt.Errorf("backup retention failed: %w", err)
	}
	return destination, nil
}

type backupFile struct {
	name    string
	modTime time.Time
}

func pruneBackupFiles(directory, currentPath string, limit int) error {
	if limit < 1 {
		return errors.New("backup retention limit must be positive")
	}
	entries, err := os.ReadDir(directory)
	if err != nil {
		return err
	}
	currentName := filepath.Base(currentPath)
	currentPresent := false
	backups := make([]backupFile, 0, len(entries))
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".dump.enc") {
			continue
		}
		info, infoErr := entry.Info()
		if infoErr != nil {
			return infoErr
		}
		if entry.Name() == currentName {
			currentPresent = true
		}
		backups = append(backups, backupFile{name: entry.Name(), modTime: info.ModTime()})
	}
	sort.Slice(backups, func(i, j int) bool {
		if backups[i].modTime.Equal(backups[j].modTime) {
			return backups[i].name > backups[j].name
		}
		return backups[i].modTime.After(backups[j].modTime)
	})
	otherLimit := limit
	if currentPresent {
		otherLimit--
	}
	keptOthers := 0
	for _, backup := range backups {
		if currentPresent && backup.name == currentName {
			continue
		}
		if keptOthers < otherLimit {
			keptOthers++
			continue
		}
		if err = os.Remove(filepath.Join(directory, backup.name)); err != nil {
			return err
		}
	}
	return nil
}

func decryptFile(path, key string) ([]byte, error) {
	sealed, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	keyBytes := sha256.Sum256([]byte(key))
	block, err := aes.NewCipher(keyBytes[:])
	if err != nil {
		return nil, err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	if len(sealed) < gcm.NonceSize() {
		return nil, errors.New("invalid encrypted backup")
	}
	return gcm.Open(nil, sealed[:gcm.NonceSize()], sealed[gcm.NonceSize():], nil)
}

func (a *App) rollback(compose, caddy, env []byte, backupPath string) error {
	if len(compose) == 0 || len(caddy) == 0 || len(env) == 0 {
		return errors.New("缺少上一版本受管理文件")
	}
	if err := atomicWrite(a.cfg.ComposeFile, compose, 0644); err != nil {
		return err
	}
	if err := atomicWrite(a.cfg.CaddyFile, caddy, 0644); err != nil {
		return err
	}
	if err := atomicWrite(a.cfg.EnvFile, env, 0600); err != nil {
		return err
	}
	if err := a.restoreDatabase(backupPath); err != nil {
		return fmt.Errorf("数据库恢复失败: %w", err)
	}
	if err := a.runCompose("up", "-d", "--no-deps", "web", "worker", "caddy"); err != nil {
		return err
	}
	return a.ensureCaddy()
}

func (a *App) restoreDatabase(backupPath string) error {
	if backupPath == "" {
		return errors.New("缺少数据库备份路径")
	}
	raw, err := decryptFile(backupPath, a.cfg.BackupKey)
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Minute)
	defer cancel()
	cmd := exec.CommandContext(ctx, "docker", "compose", "--project-directory", a.cfg.InstallDir, "--env-file", a.cfg.EnvFile, "-f", a.cfg.ComposeFile, "exec", "-T", "postgres", "pg_restore", "--clean", "--if-exists", "--no-owner", "--exit-on-error", "--dbname=crewqual")
	cmd.Stdin = bytes.NewReader(raw)
	cmd.Stdout, cmd.Stderr = os.Stdout, os.Stderr
	if err := cmd.Run(); err != nil {
		if ctx.Err() != nil {
			return fmt.Errorf("database restore timed out: %w", ctx.Err())
		}
		return err
	}
	return nil
}

func writeManagedFiles(cfg Config, composePath, caddyPath, configureDomainPath string, m Manifest) error {
	compose, err := os.ReadFile(composePath)
	if err != nil {
		return err
	}
	caddy, err := os.ReadFile(caddyPath)
	if err != nil {
		return err
	}
	var configureDomain []byte
	if m.ConfigureDomainURL != "" {
		configureDomain, err = os.ReadFile(configureDomainPath)
		if err != nil {
			return err
		}
	}
	env, err := os.ReadFile(cfg.EnvFile)
	if err != nil {
		return err
	}
	envText := updateEnv(string(env), map[string]string{"CREWQUAL_VERSION": m.Version, "CREWQUAL_WEB_IMAGE": m.WebImage, "CREWQUAL_RUNTIME_IMAGE": m.RuntimeImage})
	if err = atomicWrite(cfg.ComposeFile, compose, 0644); err != nil {
		return err
	}
	if err = atomicWrite(cfg.CaddyFile, caddy, 0644); err != nil {
		return err
	}
	if len(configureDomain) > 0 {
		if err = atomicWrite(filepath.Join(cfg.InstallDir, "configure-domain.sh"), configureDomain, 0755); err != nil {
			return err
		}
	}
	return atomicWrite(cfg.EnvFile, []byte(envText), 0600)
}

func atomicWrite(path string, data []byte, mode os.FileMode) error {
	tmp := path + ".new"
	if err := os.WriteFile(tmp, data, mode); err != nil {
		return err
	}
	if err := os.Chmod(tmp, mode); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}

func updateEnv(input string, values map[string]string) string {
	lines := strings.Split(strings.TrimSuffix(input, "\n"), "\n")
	seen := map[string]bool{}
	for index, line := range lines {
		for key, value := range values {
			if strings.HasPrefix(line, key+"=") {
				lines[index], seen[key] = key+"='"+strings.ReplaceAll(value, "'", "'\\''")+"'", true
			}
		}
	}
	for key, value := range values {
		if !seen[key] {
			lines = append(lines, key+"='"+value+"'")
		}
	}
	return strings.Join(lines, "\n") + "\n"
}

func downloadAndHash(url, destination, expected string) error {
	body, err := newReleaseHTTPClient().get(url, 128*1024*1024)
	if err != nil {
		return err
	}
	out, err := os.Create(destination)
	if err != nil {
		return err
	}
	hash := sha256.New()
	_, copyErr := io.Copy(io.MultiWriter(out, hash), bytes.NewReader(body))
	closeErr := out.Close()
	if copyErr != nil {
		return copyErr
	}
	if closeErr != nil {
		return closeErr
	}
	if !strings.EqualFold(hex.EncodeToString(hash.Sum(nil)), expected) {
		return errors.New("download checksum mismatch")
	}
	return nil
}

func readEnv(path, key string) string {
	raw, err := os.ReadFile(path)
	if err != nil {
		return ""
	}
	for _, line := range strings.Split(string(raw), "\n") {
		if strings.HasPrefix(line, key+"=") {
			return strings.Trim(strings.TrimPrefix(line, key+"="), "'\"")
		}
	}
	return ""
}

func validateManagedPath(path string) error {
	info, err := os.Lstat(path)
	if err != nil {
		return err
	}
	if info.Mode()&os.ModeSymlink != 0 {
		return fmt.Errorf("managed path is a symlink: %s", path)
	}
	if stat, ok := info.Sys().(*syscall.Stat_t); ok && stat.Uid != 0 {
		return fmt.Errorf("managed path is not root-owned: %s", path)
	}
	return nil
}

func compareVersion(left, right string) int {
	return compareSemVer(left, right)
}

func mustInt(value string) int { result, _ := strconv.Atoi(value); return result }

func writeData(w http.ResponseWriter, data any) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(envelope{Data: data})
}
func writeError(w http.ResponseWriter, status int, err error) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(envelope{Error: err.Error()})
}
func writeJSON(w io.Writer, value any) error { return json.NewEncoder(w).Encode(value) }

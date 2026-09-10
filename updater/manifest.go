package main

import (
	"bytes"
	"crypto/ed25519"
	_ "embed"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"regexp"
	"sort"
	"strings"
	"time"
)

const officialRepository = "FlightDan/crewqual"

//go:embed keyring.json
var embeddedKeyring []byte

type TrustedPublicKey struct {
	ID        string `json:"id"`
	PublicKey string `json:"publicKey"`
	Status    string `json:"status"`
}

type keyringDocument struct {
	SchemaVersion int                `json:"schemaVersion"`
	Keys          []TrustedPublicKey `json:"keys"`
}

var (
	exactVersionPattern = regexp.MustCompile(`^v([0-9]+)\.([0-9]+)\.([0-9]+)(?:-rc\.([0-9]+))?$`)
	sha256Pattern       = regexp.MustCompile(`^[a-f0-9]{64}$`)
	keyIDPattern        = regexp.MustCompile(`^[a-z0-9][a-z0-9._-]{1,63}$`)
	publishedAtPattern  = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$`)
)

type semver struct {
	major, minor, patch, rc int
	hasRC                   bool
}

func parseSemver(value string) (semver, error) {
	match := exactVersionPattern.FindStringSubmatch(value)
	if match == nil {
		return semver{}, fmt.Errorf("invalid CrewQual version: %s", value)
	}
	for _, component := range []string{match[1], match[2], match[3], match[4]} {
		if len(component) > 1 && strings.HasPrefix(component, "0") {
			return semver{}, fmt.Errorf("version contains a leading zero: %s", value)
		}
	}
	result := semver{major: mustInt(match[1]), minor: mustInt(match[2]), patch: mustInt(match[3])}
	if match[4] != "" {
		result.hasRC, result.rc = true, mustInt(match[4])
		if result.rc < 1 {
			return semver{}, errors.New("release candidate number must be positive")
		}
	}
	return result, nil
}

func compareSemVer(left, right string) int {
	a, errA := parseSemver(left)
	b, errB := parseSemver(right)
	if errA != nil || errB != nil {
		return strings.Compare(left, right)
	}
	for _, pair := range [][2]int{{a.major, b.major}, {a.minor, b.minor}, {a.patch, b.patch}} {
		if pair[0] < pair[1] {
			return -1
		}
		if pair[0] > pair[1] {
			return 1
		}
	}
	if a.hasRC && !b.hasRC {
		return -1
	}
	if !a.hasRC && b.hasRC {
		return 1
	}
	if a.hasRC && b.hasRC {
		if a.rc < b.rc {
			return -1
		}
		if a.rc > b.rc {
			return 1
		}
	}
	return 0
}

func loadKeyring(raw []byte) ([]TrustedPublicKey, error) {
	var document keyringDocument
	if err := decodeStrictJSON(raw, &document); err != nil {
		return nil, fmt.Errorf("invalid update manifest keyring: %w", err)
	}
	if document.SchemaVersion != 1 {
		return nil, errors.New("unsupported update manifest keyring schema")
	}
	seen := make(map[string]bool, len(document.Keys))
	result := make([]TrustedPublicKey, 0, len(document.Keys))
	for _, key := range document.Keys {
		if !keyIDPattern.MatchString(key.ID) || seen[key.ID] {
			return nil, errors.New("keyring contains an invalid or duplicate key id")
		}
		if key.Status != "active" && key.Status != "next" && key.Status != "retired" {
			return nil, fmt.Errorf("keyring key %q has an invalid status", key.ID)
		}
		public, err := base64.StdEncoding.DecodeString(key.PublicKey)
		if err != nil || len(public) != ed25519.PublicKeySize {
			return nil, fmt.Errorf("keyring key %q is not a 32-byte Ed25519 public key", key.ID)
		}
		seen[key.ID] = true
		result = append(result, key)
	}
	return result, nil
}

func builtinTrustedKeys() ([]TrustedPublicKey, error) {
	return loadKeyring(embeddedKeyring)
}

func trustedKeyByID(keys []TrustedPublicKey, id string) (TrustedPublicKey, error) {
	for _, key := range keys {
		if key.ID == id {
			if key.Status == "retired" {
				return TrustedPublicKey{}, fmt.Errorf("manifest uses retired signing key %q", id)
			}
			return key, nil
		}
	}
	return TrustedPublicKey{}, fmt.Errorf("manifest signing key %q is not trusted", id)
}

func expectedReleaseAssetURL(version, asset string) string {
	return "https://github.com/" + officialRepository + "/releases/download/" + version + "/" + asset
}

func validateManifest(m Manifest) error {
	version, err := parseSemver(m.Version)
	if err != nil {
		return err
	}
	if m.SchemaVersion != 1 || m.SigningKeyID == "" {
		return errors.New("manifest schemaVersion or signingKeyId is invalid")
	}
	if (version.hasRC && m.Channel != "rc") || (!version.hasRC && m.Channel != "stable") {
		return errors.New("manifest channel does not match version")
	}
	if !publishedAtPattern.MatchString(m.PublishedAt) {
		return errors.New("manifest publishedAt must be a UTC RFC3339 timestamp")
	}
	if _, err := time.Parse(time.RFC3339Nano, m.PublishedAt); err != nil {
		return errors.New("manifest publishedAt is not a valid timestamp")
	}
	if m.ReleaseNotesURL != "https://github.com/"+officialRepository+"/releases/tag/"+m.Version {
		return errors.New("manifest release notes URL is not the official tag URL")
	}
	assets := [][2]string{
		{m.ComposeURL, expectedReleaseAssetURL(m.Version, "docker-compose.install.yml")},
		{m.CaddyURL, expectedReleaseAssetURL(m.Version, "Caddyfile")},
		{m.ConfigureDomainURL, expectedReleaseAssetURL(m.Version, "configure-domain.sh")},
		{m.Updater.AMD64URL, expectedReleaseAssetURL(m.Version, "crewqual-updater-linux-amd64")},
		{m.Updater.ARM64URL, expectedReleaseAssetURL(m.Version, "crewqual-updater-linux-arm64")},
	}
	for _, asset := range assets {
		actual, wanted := asset[0], asset[1]
		if actual == "" || actual != wanted {
			return errors.New("manifest contains an unexpected release asset URL")
		}
	}
	for _, digest := range []string{m.ComposeSHA256, m.CaddySHA256, m.ConfigureDomainSHA256, m.Updater.AMD64, m.Updater.ARM64} {
		if !sha256Pattern.MatchString(digest) {
			return errors.New("manifest contains an invalid SHA-256 checksum")
		}
	}
	if !officialDigestImagePattern("ghcr.io/flightdan/crewqual-web", m.WebImage) {
		return errors.New("webImage must be the official immutable GHCR image")
	}
	if !officialDigestImagePattern("ghcr.io/flightdan/crewqual-runtime", m.RuntimeImage) {
		return errors.New("runtimeImage must be the official immutable GHCR image")
	}
	if m.MinimumVersion != "" {
		if _, err := parseSemver(m.MinimumVersion); err != nil {
			return errors.New("minimumVersion must be a supported SemVer")
		}
	}
	if m.MinimumUpdater != "" {
		minimumUpdater := m.MinimumUpdater
		if !strings.HasPrefix(minimumUpdater, "v") {
			minimumUpdater = "v" + minimumUpdater
		}
		if _, err := parseSemver(minimumUpdater); err != nil {
			return errors.New("minimumUpdaterVersion must be a stable SemVer")
		}
	}
	if m.MigrationPolicy != "backward-compatible" && m.MigrationPolicy != "manual-required" {
		return errors.New("unsupported migration policy")
	}
	return nil
}

func officialDigestImagePattern(repository, value string) bool {
	return regexp.MustCompile("^" + regexp.QuoteMeta(repository) + `@sha256:[a-f0-9]{64}$`).MatchString(value)
}

func verifyManifestBytes(raw, signatureRaw []byte, keys []TrustedPublicKey, expectedTag string) (Manifest, error) {
	var manifest Manifest
	if err := decodeStrictJSON(raw, &manifest); err != nil {
		return Manifest{}, fmt.Errorf("manifest JSON is not strict: %w", err)
	}
	if err := validateManifest(manifest); err != nil {
		return Manifest{}, err
	}
	if expectedTag != "" && manifest.Version != expectedTag {
		return Manifest{}, fmt.Errorf("manifest version %s does not match requested tag %s", manifest.Version, expectedTag)
	}
	key, err := trustedKeyByID(keys, manifest.SigningKeyID)
	if err != nil {
		return Manifest{}, err
	}
	public, _ := base64.StdEncoding.DecodeString(key.PublicKey)
	signature, err := base64.StdEncoding.DecodeString(strings.TrimSpace(string(signatureRaw)))
	if err != nil || len(signature) != ed25519.SignatureSize || !ed25519.Verify(ed25519.PublicKey(public), raw, signature) {
		return Manifest{}, errors.New("release manifest signature verification failed")
	}
	return manifest, nil
}

func decodeStrictJSON(raw []byte, target any) error {
	decoder := json.NewDecoder(bytes.NewReader(raw))
	if err := ensureUniqueJSON(decoder); err != nil {
		return err
	}
	decoder = json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		return err
	}
	var extra any
	if err := decoder.Decode(&extra); err != io.EOF {
		if err == nil {
			return errors.New("trailing JSON data")
		}
		return err
	}
	return nil
}

func ensureUniqueJSON(decoder *json.Decoder) error {
	var walk func(json.Token) error
	walk = func(token json.Token) error {
		delim, ok := token.(json.Delim)
		if !ok {
			return nil
		}
		switch delim {
		case '{':
			seen := map[string]bool{}
			for decoder.More() {
				keyToken, err := decoder.Token()
				if err != nil {
					return err
				}
				key, ok := keyToken.(string)
				if !ok || seen[key] {
					return fmt.Errorf("duplicate JSON object key %q", key)
				}
				seen[key] = true
				value, err := decoder.Token()
				if err != nil {
					return err
				}
				if err := walk(value); err != nil {
					return err
				}
			}
			_, err := decoder.Token()
			return err
		case '[':
			for decoder.More() {
				value, err := decoder.Token()
				if err != nil {
					return err
				}
				if err := walk(value); err != nil {
					return err
				}
			}
			_, err := decoder.Token()
			return err
		default:
			return nil
		}
	}
	first, err := decoder.Token()
	if err != nil {
		return err
	}
	if err := walk(first); err != nil {
		return err
	}
	return nil
}

type boundedHTTPClient struct {
	client *http.Client
}

func newReleaseHTTPClient() *boundedHTTPClient {
	return &boundedHTTPClient{client: &http.Client{
		Timeout: 60 * time.Second,
		CheckRedirect: func(req *http.Request, _ []*http.Request) error {
			// A CI API credential must never follow release download redirects.
			req.Header.Del("Authorization")
			if !isAllowedReleaseHost(req.URL.Hostname()) {
				return errors.New("release redirect target is not allowlisted")
			}
			return nil
		},
	}}
}

func isAllowedReleaseHost(host string) bool {
	switch strings.ToLower(host) {
	case "api.github.com", "github.com", "raw.githubusercontent.com", "release-assets.githubusercontent.com", "objects.githubusercontent.com":
		return true
	default:
		return false
	}
}

func (c *boundedHTTPClient) get(urlValue string, limit int64) ([]byte, error) {
	parsed, err := url.Parse(urlValue)
	if err != nil || parsed.Scheme != "https" || !isAllowedReleaseHost(parsed.Hostname()) {
		return nil, errors.New("release URL must use HTTPS")
	}
	request, err := http.NewRequest(http.MethodGet, urlValue, nil)
	if err != nil {
		return nil, err
	}
	// Explicit opt-in for CI discovery; do not consume ambient GH_TOKEN or send
	// credentials to asset hosts, other repositories, or arbitrary API routes.
	if parsed.Host == "api.github.com" && parsed.Path == "/repos/"+officialRepository+"/releases" {
		if token := strings.TrimSpace(os.Getenv("CREWQUAL_RELEASE_API_TOKEN")); token != "" {
			request.Header.Set("Authorization", "Bearer "+token)
		}
	}
	response, err := c.client.Do(request)
	if err != nil {
		return nil, err
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("release request returned %s", response.Status)
	}
	body, err := io.ReadAll(io.LimitReader(response.Body, limit+1))
	if err != nil {
		return nil, err
	}
	if int64(len(body)) > limit {
		return nil, errors.New("release response exceeds size limit")
	}
	return body, nil
}

type githubRelease struct {
	TagName    string `json:"tag_name"`
	Draft      bool   `json:"draft"`
	Prerelease bool   `json:"prerelease"`
	Assets     []struct {
		Name               string `json:"name"`
		BrowserDownloadURL string `json:"browser_download_url"`
	} `json:"assets"`
}

func resolveManifestRelease(cfg Config) (string, string, error) {
	if cfg.ManifestURL != "" {
		parts := strings.Split(cfg.ManifestURL, "/")
		for index, part := range parts {
			if part == "download" && index+1 < len(parts) {
				if parts[index+1] == "latest" {
					return cfg.ManifestURL, "", nil
				}
				return cfg.ManifestURL, parts[index+1], nil
			}
		}
		return cfg.ManifestURL, "", nil
	}
	apiURL := cfg.ReleaseAPIURL
	separator := "?"
	if strings.Contains(apiURL, "?") {
		separator = "&"
	}
	raw, err := newReleaseHTTPClient().get(apiURL+separator+"per_page=100", 2*1024*1024)
	if err != nil {
		return "", "", err
	}
	var releases []githubRelease
	if err := json.Unmarshal(raw, &releases); err != nil {
		return "", "", fmt.Errorf("invalid GitHub release API response: %w", err)
	}
	type candidate struct {
		release githubRelease
		version string
	}
	candidates := make([]candidate, 0, len(releases))
	for _, release := range releases {
		if release.Draft {
			continue
		}
		parsed, parseErr := parseSemver(release.TagName)
		if parseErr != nil || (cfg.Channel == "stable" && parsed.hasRC) {
			continue
		}
		if cfg.Channel == "stable" && release.Prerelease {
			continue
		}
		for _, asset := range release.Assets {
			if asset.Name == "update-manifest-v1.json" && asset.BrowserDownloadURL != "" {
				candidates = append(candidates, candidate{release: release, version: release.TagName})
				break
			}
		}
	}
	if len(candidates) == 0 {
		return "", "", errors.New("no compatible signed CrewQual release was found")
	}
	sort.Slice(candidates, func(i, j int) bool { return compareSemVer(candidates[i].version, candidates[j].version) > 0 })
	selected := candidates[0].release
	for _, asset := range selected.Assets {
		if asset.Name == "update-manifest-v1.json" {
			return asset.BrowserDownloadURL, selected.TagName, nil
		}
	}
	return "", "", errors.New("selected release has no manifest asset")
}

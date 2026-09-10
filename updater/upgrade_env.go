package main

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"net/url"
)

// prepareUpgradeEnv migrates the official installer's configuration without
// changing the live environment. The result is committed only after migration;
// rollback retains the original bytes and its original owner credentials.
func prepareUpgradeEnv(current []byte, manifest Manifest) ([]byte, error) {
	values := map[string]string{
		"CREWQUAL_VERSION":       manifest.Version,
		"CREWQUAL_WEB_IMAGE":     manifest.WebImage,
		"CREWQUAL_RUNTIME_IMAGE": manifest.RuntimeImage,
	}
	ownerPassword := envValue(current, "POSTGRES_PASSWORD")
	if ownerPassword == "" {
		return nil, errors.New("POSTGRES_PASSWORD is required for upgrade")
	}
	// Refuse to silently redirect a custom database. Official deployments use
	// these local endpoints and either the legacy owner or new runtime login.
	for _, key := range []string{"DATABASE_URL", "DIRECT_URL"} {
		raw := envValue(current, key)
		if raw == "" {
			return nil, errors.New(key + " is required for upgrade")
		}
		parsed, err := url.Parse(raw)
		if err != nil || parsed.Scheme != "postgresql" || parsed.Host != "postgres:5432" || parsed.Path != "/crewqual" || parsed.RawQuery != "" || parsed.Fragment != "" || parsed.User == nil {
			return nil, errors.New("custom " + key + " requires explicit database migration")
		}
		user := parsed.User.Username()
		if (key == "DIRECT_URL" && user != "crewqual") || (key == "DATABASE_URL" && user != "crewqual" && user != "crewqual_app") {
			return nil, errors.New("custom " + key + " requires explicit database migration")
		}
	}
	runtimeURL, _ := url.Parse(envValue(current, "DATABASE_URL"))
	if runtimeURL.User.Username() == "crewqual_app" {
		password, present := runtimeURL.User.Password()
		if !present || password == "" || password != envValue(current, "POSTGRES_APP_PASSWORD") {
			return nil, errors.New("runtime database credentials disagree; repair configuration before upgrade")
		}
	}
	ownerURL, _ := url.Parse(envValue(current, "DIRECT_URL"))
	if password, present := ownerURL.User.Password(); !present || password != ownerPassword {
		return nil, errors.New("database owner credentials disagree; repair configuration before upgrade")
	}
	for _, key := range []string{"READINESS_PROBE_SECRET", "POSTGRES_APP_PASSWORD"} {
		value := envValue(current, key)
		if value == "" {
			entropy := make([]byte, 32)
			if _, err := rand.Read(entropy); err != nil {
				return nil, err
			}
			value = hex.EncodeToString(entropy)
		}
		values[key] = value
	}
	values["DATABASE_URL"] = "postgresql://" + url.UserPassword("crewqual_app", values["POSTGRES_APP_PASSWORD"]).String() + "@postgres:5432/crewqual"
	// The owner login is not rotated during a runtime-role migration.
	values["DIRECT_URL"] = envValue(current, "DIRECT_URL")
	return []byte(updateEnv(string(current), values)), nil
}

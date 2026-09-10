package main

import (
	"io"
	"net/http"
	"strings"
	"testing"
)

type releaseTestTransport func(*http.Request) (*http.Response, error)

func (f releaseTestTransport) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }
func releaseTestResponse(r *http.Request, code int, header http.Header) *http.Response {
	return &http.Response{StatusCode: code, Header: header, Body: io.NopCloser(strings.NewReader("[]")), Request: r}
}

func TestReleaseAPIAuthenticationIsExplicitAndScoped(t *testing.T) {
	t.Setenv("GH_TOKEN", "ambient-must-not-be-used")
	for _, tc := range []struct{ name, url, token, want string }{
		{"explicit repository API", "https://api.github.com/repos/FlightDan/crewqual/releases?per_page=100", "fixture", "Bearer fixture"},
		{"ambient token ignored", "https://api.github.com/repos/FlightDan/crewqual/releases", "", ""},
		{"asset host", "https://github.com/FlightDan/crewqual/releases/download/v1.0.7/update-manifest-v1.json", "fixture", ""},
		{"other API path", "https://api.github.com/user", "fixture", ""},
		{"other repository", "https://api.github.com/repos/other/repo/releases", "fixture", ""},
		{"other port", "https://api.github.com:8443/repos/FlightDan/crewqual/releases", "fixture", ""},
	} {
		t.Run(tc.name, func(t *testing.T) {
			t.Setenv("CREWQUAL_RELEASE_API_TOKEN", tc.token)
			client := newReleaseHTTPClient()
			called := false
			client.client.Transport = releaseTestTransport(func(r *http.Request) (*http.Response, error) {
				called = true
				if r.Header.Get("Authorization") != tc.want {
					t.Fatal("unexpected API credential scope")
				}
				return releaseTestResponse(r, 200, make(http.Header)), nil
			})
			if _, err := client.get(tc.url, 1024); err != nil {
				t.Fatal(err)
			}
			if !called {
				t.Fatal("request not executed")
			}
		})
	}
}

func TestReleaseAPICredentialNeverFollowsRedirect(t *testing.T) {
	t.Setenv("CREWQUAL_RELEASE_API_TOKEN", "fixture")
	for _, destination := range []string{"https://github.com/FlightDan/crewqual/releases/download/v1.0.7/manifest", "https://api.github.com/redirected", "https://untrusted.invalid/asset"} {
		client := newReleaseHTTPClient()
		calls := 0
		client.client.Transport = releaseTestTransport(func(r *http.Request) (*http.Response, error) {
			calls++
			if calls == 1 {
				if r.Header.Get("Authorization") != "Bearer fixture" {
					t.Fatal("initial API credential missing")
				}
				return releaseTestResponse(r, 302, http.Header{"Location": []string{destination}}), nil
			}
			if r.Header.Get("Authorization") != "" {
				t.Fatal("credential followed redirect")
			}
			return releaseTestResponse(r, 200, make(http.Header)), nil
		})
		_, err := client.get("https://api.github.com/repos/FlightDan/crewqual/releases", 1024)
		if strings.Contains(destination, "untrusted.invalid") {
			if err == nil || calls != 1 {
				t.Fatal("untrusted redirect was not refused before transport")
			}
		} else if err != nil || calls != 2 {
			t.Fatalf("allowed redirect failed: %v", err)
		}
	}
}

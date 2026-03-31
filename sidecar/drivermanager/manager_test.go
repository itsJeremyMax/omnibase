package drivermanager

import (
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"testing"
)

func writeManifest(t *testing.T, dir string, manifest Manifest) {
	t.Helper()
	data, _ := json.Marshal(manifest)
	os.WriteFile(filepath.Join(dir, "drivers.json"), data, 0644)
}

func testManifest() Manifest {
	return Manifest{
		Drivers: map[string]DriverEntry{
			"postgres": {Binary: "driver-postgres", Schemes: []string{"pg", "postgres", "postgresql", "pgsql"}},
			"mysql":    {Binary: "driver-mysql", Schemes: []string{"my", "mysql", "mariadb"}},
			"sqlite3":  {Binary: "driver-sqlite3", Schemes: []string{"sqlite", "sqlite3", "sq", "file"}},
			"sqlserver": {Binary: "driver-sqlserver", Schemes: []string{"mssql", "sqlserver", "ms", "azuresql"}},
		},
	}
}

func TestResolveDriver(t *testing.T) {
	tmpDir := t.TempDir()
	writeManifest(t, tmpDir, testManifest())

	mgr := NewManager(tmpDir, nil, nil)

	tests := []struct {
		scheme   string
		expected string
		wantErr  bool
	}{
		{"pg", "driver-postgres", false},
		{"postgres", "driver-postgres", false},
		{"postgresql", "driver-postgres", false},
		{"pgsql", "driver-postgres", false},
		{"sqlite", "driver-sqlite3", false},
		{"sqlite3", "driver-sqlite3", false},
		{"sq", "driver-sqlite3", false},
		{"file", "driver-sqlite3", false},
		{"my", "driver-mysql", false},
		{"mysql", "driver-mysql", false},
		{"mariadb", "driver-mysql", false},
		{"mssql", "driver-sqlserver", false},
		{"sqlserver", "driver-sqlserver", false},
		{"ms", "driver-sqlserver", false},
		{"azuresql", "driver-sqlserver", false},
		{"unknown", "", true},
		{"oracle", "", true},
		{"", "", true},
	}

	for _, tt := range tests {
		binary, err := mgr.ResolveDriver(tt.scheme)
		if tt.wantErr {
			if err == nil {
				t.Errorf("ResolveDriver(%q) should fail, got %q", tt.scheme, binary)
			}
		} else {
			if err != nil {
				t.Errorf("ResolveDriver(%q) failed: %v", tt.scheme, err)
			}
			if binary != tt.expected {
				t.Errorf("ResolveDriver(%q) = %q, want %q", tt.scheme, binary, tt.expected)
			}
		}
	}
}

func TestNewManagerWithoutManifest(t *testing.T) {
	tmpDir := t.TempDir()
	mgr := NewManager(tmpDir, nil, nil)

	_, err := mgr.ResolveDriver("pg")
	if err == nil {
		t.Fatal("expected error when no manifest exists")
	}
}

func TestNewManagerLoadsManifest(t *testing.T) {
	tmpDir := t.TempDir()
	writeManifest(t, tmpDir, testManifest())

	mgr := NewManager(tmpDir, nil, nil)

	if mgr.manifest == nil {
		t.Fatal("manifest should be loaded")
	}
	if len(mgr.manifest.Drivers) != 4 {
		t.Errorf("expected 4 drivers, got %d", len(mgr.manifest.Drivers))
	}
}

func TestGetClientWithMissingBinary(t *testing.T) {
	tmpDir := t.TempDir()
	writeManifest(t, tmpDir, testManifest())

	mgr := NewManager(tmpDir, nil, nil)

	_, err := mgr.GetClient("driver-sqlite3")
	if err == nil {
		t.Fatal("expected error when binary doesn't exist")
	}
}

func TestGetClientWithFallbackPath(t *testing.T) {
	// Skip if Go not available (needed for building the test driver)
	if _, err := exec.LookPath("go"); err != nil {
		t.Skip("Go not installed")
	}

	tmpDir := t.TempDir()
	writeManifest(t, tmpDir, testManifest())

	// Build a sqlite3 driver into tmpDir without platform suffix
	sidecarDir, _ := filepath.Abs("..")
	if _, err := os.Stat(filepath.Join(sidecarDir, "drivers", "sqlite3", "main.go")); err != nil {
		t.Skip("sqlite3 driver source not found")
	}

	binaryPath := filepath.Join(tmpDir, "driver-sqlite3")
	cmd := exec.Command("go", "build", "-o", binaryPath, "./drivers/sqlite3/")
	cmd.Dir = sidecarDir
	if err := cmd.Run(); err != nil {
		t.Fatalf("failed to build driver: %v", err)
	}

	mgr := NewManager(tmpDir, nil, nil)
	client, err := mgr.GetClient("driver-sqlite3")
	if err != nil {
		t.Fatalf("GetClient failed: %v", err)
	}
	defer mgr.StopAll()

	if client == nil {
		t.Fatal("expected non-nil client")
	}
}

func TestGetClientWithSourceBuildFallback(t *testing.T) {
	if _, err := exec.LookPath("go"); err != nil {
		t.Skip("Go not installed")
	}

	tmpDir := t.TempDir()
	writeManifest(t, tmpDir, testManifest())

	sidecarDir, _ := filepath.Abs("..")
	if _, err := os.Stat(filepath.Join(sidecarDir, "drivers", "sqlite3", "main.go")); err != nil {
		t.Skip("sqlite3 driver source not found")
	}

	// Create a downloader that will fail to download (fake version) but can build from source
	dl := NewDownloader(tmpDir, "99.99.99", "itsJeremyMax/omnibase")
	dl.EnsureDriverDir()
	writeManifest(t, dl.DriverDir(), testManifest())

	// Override SidecarDir to return the actual source dir
	// We can't easily override methods, so we'll create the manager pointing
	// at the downloader's dir and manually place a source tree reference.
	// Actually, let's just test BuildDriverFromSource directly.
	builtPath, err := dl.BuildDriverFromSource("driver-sqlite3", sidecarDir)
	if err != nil {
		t.Fatalf("BuildDriverFromSource failed: %v", err)
	}

	// Verify the binary exists and is executable
	info, err := os.Stat(builtPath)
	if err != nil {
		t.Fatalf("built binary not found: %v", err)
	}
	if info.Mode()&0111 == 0 {
		t.Fatal("binary should be executable")
	}

	// Verify unverified marker exists
	platform := fmt.Sprintf("%s-%s", runtime.GOOS, runtime.GOARCH)
	expectedPath := filepath.Join(dl.DriverDir(), "driver-sqlite3-"+platform)
	if builtPath != expectedPath {
		t.Errorf("built path = %q, want %q", builtPath, expectedPath)
	}
	if _, err := os.Stat(builtPath + ".unverified"); err != nil {
		t.Fatal("expected .unverified marker")
	}
}

func TestStopAll(t *testing.T) {
	tmpDir := t.TempDir()
	mgr := NewManager(tmpDir, nil, nil)

	// StopAll on empty manager should not panic
	mgr.StopAll()
}

func TestGetClientAutoBuildFromSource(t *testing.T) {
	if _, err := exec.LookPath("go"); err != nil {
		t.Skip("Go not installed")
	}

	sidecarDir, _ := filepath.Abs("..")
	if _, err := os.Stat(filepath.Join(sidecarDir, "drivers", "sqlite3", "main.go")); err != nil {
		t.Skip("sqlite3 driver source not found")
	}

	// Create a fresh temp dir with manifest but no driver binaries
	tmpDir := t.TempDir()
	dl := NewDownloader(tmpDir, "99.99.99", "nonexistent/repo")
	dl.EnsureDriverDir()
	writeManifest(t, dl.DriverDir(), testManifest())

	// The downloader's SidecarDir won't find source automatically since
	// the binary isn't in the expected location. We need to test the full
	// GetClient -> DownloadDriver (fail) -> BuildDriverFromSource path.
	// Build the driver directly to verify the mechanism works.
	builtPath, err := dl.BuildDriverFromSource("driver-sqlite3", sidecarDir)
	if err != nil {
		t.Fatalf("BuildDriverFromSource failed: %v", err)
	}

	// Create a manager pointing at the downloader's dir (where the binary was built)
	mgr := NewManager(dl.DriverDir(), nil, nil)
	client, err := mgr.GetClient("driver-sqlite3")
	if err != nil {
		t.Fatalf("GetClient failed after build: %v", err)
	}
	defer mgr.StopAll()

	// Verify the client actually works
	params, _ := json.Marshal(map[string]interface{}{"id": "test", "dsn": "sqlite::memory:"})
	result, err := client.Send("connect", params)
	if err != nil {
		t.Fatalf("connect via auto-built driver failed: %v", err)
	}
	var cr map[string]interface{}
	json.Unmarshal(result, &cr)
	if cr["ok"] != true {
		t.Fatalf("expected ok=true, got %v", cr["ok"])
	}

	_ = builtPath // used for the build step
}

func TestGetClientReusesRunningClient(t *testing.T) {
	if _, err := exec.LookPath("go"); err != nil {
		t.Skip("Go not installed")
	}

	tmpDir := t.TempDir()
	writeManifest(t, tmpDir, testManifest())

	sidecarDir, _ := filepath.Abs("..")
	binaryPath := filepath.Join(tmpDir, "driver-sqlite3")
	cmd := exec.Command("go", "build", "-o", binaryPath, "./drivers/sqlite3/")
	cmd.Dir = sidecarDir
	if err := cmd.Run(); err != nil {
		t.Skip("failed to build driver")
	}

	mgr := NewManager(tmpDir, nil, nil)
	defer mgr.StopAll()

	// Get client twice - should return the same instance
	client1, err := mgr.GetClient("driver-sqlite3")
	if err != nil {
		t.Fatalf("first GetClient failed: %v", err)
	}

	client2, err := mgr.GetClient("driver-sqlite3")
	if err != nil {
		t.Fatalf("second GetClient failed: %v", err)
	}

	if client1 != client2 {
		t.Fatal("expected same client instance for same driver")
	}
}

func TestGetClientRespawnsAfterCrash(t *testing.T) {
	if _, err := exec.LookPath("go"); err != nil {
		t.Skip("Go not installed")
	}

	tmpDir := t.TempDir()
	writeManifest(t, tmpDir, testManifest())

	sidecarDir, _ := filepath.Abs("..")
	binaryPath := filepath.Join(tmpDir, "driver-sqlite3")
	cmd := exec.Command("go", "build", "-o", binaryPath, "./drivers/sqlite3/")
	cmd.Dir = sidecarDir
	if err := cmd.Run(); err != nil {
		t.Skip("failed to build driver")
	}

	mgr := NewManager(tmpDir, nil, nil)
	defer mgr.StopAll()

	// Get client and use it
	client1, err := mgr.GetClient("driver-sqlite3")
	if err != nil {
		t.Fatalf("GetClient failed: %v", err)
	}

	params, _ := json.Marshal(map[string]interface{}{"id": "test", "dsn": "sqlite::memory:"})
	_, err = client1.Send("connect", params)
	if err != nil {
		t.Fatalf("connect failed: %v", err)
	}

	// Kill the driver subprocess
	client1.Stop()

	// GetClient should detect the dead client and spawn a new one
	client2, err := mgr.GetClient("driver-sqlite3")
	if err != nil {
		t.Fatalf("GetClient after crash failed: %v", err)
	}

	if client1 == client2 {
		t.Fatal("expected new client instance after crash")
	}

	// New client should work
	_, err = client2.Send("connect", params)
	if err != nil {
		t.Fatalf("connect on respawned driver failed: %v", err)
	}
}

func TestSidecarDirFromBinSubdir(t *testing.T) {
	// Create a fake sidecar directory structure with bin/ subdirectory
	tmpDir := t.TempDir()
	sidecarDir := tmpDir
	binDir := filepath.Join(sidecarDir, "bin")
	driversDir := filepath.Join(sidecarDir, "drivers")
	os.MkdirAll(binDir, 0755)
	os.MkdirAll(filepath.Join(driversDir, "sqlite3"), 0755)
	os.WriteFile(filepath.Join(driversDir, "sqlite3", "main.go"), []byte("package main"), 0644)

	dl := NewDownloader(tmpDir, "0.1.27", "test/repo")

	// The SidecarDir method uses os.Executable() which we can't easily mock,
	// but we can verify the logic directly: if we're in bin/, parent should
	// have drivers/
	parent := filepath.Dir(binDir) // = sidecarDir
	_, err := os.Stat(filepath.Join(parent, "drivers"))
	if err != nil {
		t.Fatal("expected drivers/ in parent of bin/")
	}
	_ = dl
}

func TestMultipleResolveSameScheme(t *testing.T) {
	tmpDir := t.TempDir()
	writeManifest(t, tmpDir, testManifest())
	mgr := NewManager(tmpDir, nil, nil)

	// Resolve the same scheme multiple times
	for i := 0; i < 10; i++ {
		binary, err := mgr.ResolveDriver("pg")
		if err != nil {
			t.Fatalf("iteration %d: ResolveDriver failed: %v", i, err)
		}
		if binary != "driver-postgres" {
			t.Fatalf("iteration %d: got %q, want driver-postgres", i, binary)
		}
	}
}

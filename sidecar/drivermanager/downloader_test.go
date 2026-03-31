package drivermanager

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"testing"
)

func TestEnsureDriverDir(t *testing.T) {
	tmpDir := t.TempDir()
	dl := NewDownloader(tmpDir, "0.1.27", "itsJeremyMax/omnibase")

	expected := filepath.Join(tmpDir, "0.1.27")
	if dl.DriverDir() != expected {
		t.Errorf("DriverDir() = %q, want %q", dl.DriverDir(), expected)
	}

	if err := dl.EnsureDriverDir(); err != nil {
		t.Fatalf("EnsureDriverDir failed: %v", err)
	}

	if _, err := os.Stat(expected); err != nil {
		t.Fatalf("directory not created: %v", err)
	}
}

func TestCleanOldVersions(t *testing.T) {
	tmpDir := t.TempDir()

	os.MkdirAll(filepath.Join(tmpDir, "0.1.25"), 0755)
	os.MkdirAll(filepath.Join(tmpDir, "0.1.26"), 0755)
	os.MkdirAll(filepath.Join(tmpDir, "0.1.27"), 0755)

	dl := NewDownloader(tmpDir, "0.1.27", "itsJeremyMax/omnibase")
	dl.CleanOldVersions()

	// Current (0.1.27) should remain
	if _, err := os.Stat(filepath.Join(tmpDir, "0.1.27")); err != nil {
		t.Error("current version dir should exist")
	}
	// Previous (0.1.26) should remain
	if _, err := os.Stat(filepath.Join(tmpDir, "0.1.26")); err != nil {
		t.Error("previous version dir should exist")
	}
	// Old (0.1.25) should be removed
	if _, err := os.Stat(filepath.Join(tmpDir, "0.1.25")); err == nil {
		t.Error("old version dir should be removed")
	}
}

func TestCleanOldVersionsSingleVersion(t *testing.T) {
	tmpDir := t.TempDir()
	os.MkdirAll(filepath.Join(tmpDir, "0.1.27"), 0755)

	dl := NewDownloader(tmpDir, "0.1.27", "itsJeremyMax/omnibase")
	dl.CleanOldVersions()

	if _, err := os.Stat(filepath.Join(tmpDir, "0.1.27")); err != nil {
		t.Error("current version should exist")
	}
}

func TestCleanOldVersionsKeepsTwoLatest(t *testing.T) {
	tmpDir := t.TempDir()

	os.MkdirAll(filepath.Join(tmpDir, "0.1.20"), 0755)
	os.MkdirAll(filepath.Join(tmpDir, "0.1.21"), 0755)
	os.MkdirAll(filepath.Join(tmpDir, "0.1.22"), 0755)
	os.MkdirAll(filepath.Join(tmpDir, "0.1.23"), 0755)
	os.MkdirAll(filepath.Join(tmpDir, "0.1.24"), 0755)

	dl := NewDownloader(tmpDir, "0.1.24", "itsJeremyMax/omnibase")
	dl.CleanOldVersions()

	remaining, _ := os.ReadDir(tmpDir)
	if len(remaining) != 2 {
		t.Errorf("expected 2 dirs remaining, got %d", len(remaining))
	}
	for _, entry := range remaining {
		if entry.Name() != "0.1.23" && entry.Name() != "0.1.24" {
			t.Errorf("unexpected remaining dir: %s", entry.Name())
		}
	}
}

func TestDownloadDriverSkipsExisting(t *testing.T) {
	tmpDir := t.TempDir()
	dl := NewDownloader(tmpDir, "0.1.27", "itsJeremyMax/omnibase")
	dl.EnsureDriverDir()

	// Create a fake existing binary with the correct platform name
	platform := fmt.Sprintf("%s-%s", runtime.GOOS, runtime.GOARCH)
	fakeFile := filepath.Join(dl.DriverDir(), "driver-sqlite3-"+platform)
	os.WriteFile(fakeFile, []byte("fake binary"), 0755)

	// DownloadDriver should skip when file exists (return nil, not attempt download)
	err := dl.DownloadDriver("driver-sqlite3")
	if err != nil {
		t.Errorf("expected nil error for existing driver, got: %v", err)
	}
}

func TestDownloadDriverFailsGracefully(t *testing.T) {
	tmpDir := t.TempDir()
	// Use a fake repo that won't exist
	dl := NewDownloader(tmpDir, "99.99.99", "nonexistent/repo")
	dl.EnsureDriverDir()

	err := dl.DownloadDriver("driver-sqlite3")
	if err == nil {
		t.Error("expected error for nonexistent release")
	}
}

func TestBuildDriverFromSource(t *testing.T) {
	// Check Go is available
	if _, err := exec.LookPath("go"); err != nil {
		t.Skip("Go not installed, skipping source build test")
	}

	tmpDir := t.TempDir()
	dl := NewDownloader(tmpDir, "0.1.27", "itsJeremyMax/omnibase")

	// Find the sidecar source directory
	sidecarDir, err := filepath.Abs("..") // drivermanager is in sidecar/drivermanager
	if err != nil {
		t.Fatal(err)
	}

	// Verify the source exists
	if _, err := os.Stat(filepath.Join(sidecarDir, "drivers", "sqlite3", "main.go")); err != nil {
		t.Skipf("sqlite3 driver source not found at %s", sidecarDir)
	}

	builtPath, err := dl.BuildDriverFromSource("driver-sqlite3", sidecarDir)
	if err != nil {
		t.Fatalf("BuildDriverFromSource failed: %v", err)
	}

	// Binary should exist
	if _, err := os.Stat(builtPath); err != nil {
		t.Fatalf("built binary not found: %v", err)
	}

	// Unverified marker should exist
	if _, err := os.Stat(builtPath + ".unverified"); err != nil {
		t.Fatal("expected .unverified marker file")
	}

	// Binary should be executable
	info, _ := os.Stat(builtPath)
	if info.Mode()&0111 == 0 {
		t.Fatal("binary should be executable")
	}
}

func TestBuildDriverFromSourceBadPackage(t *testing.T) {
	if _, err := exec.LookPath("go"); err != nil {
		t.Skip("Go not installed")
	}

	tmpDir := t.TempDir()
	dl := NewDownloader(tmpDir, "0.1.27", "itsJeremyMax/omnibase")

	sidecarDir, _ := filepath.Abs("..")

	_, err := dl.BuildDriverFromSource("driver-nonexistent", sidecarDir)
	if err == nil {
		t.Error("expected error for nonexistent driver package")
	}
}

func TestVerifyChecksumWithMarker(t *testing.T) {
	tmpDir := t.TempDir()
	dl := NewDownloader(tmpDir, "0.1.27", "itsJeremyMax/omnibase")
	dl.EnsureDriverDir()

	platform := fmt.Sprintf("%s-%s", runtime.GOOS, runtime.GOARCH)
	binaryName := "driver-test-" + platform
	binaryPath := filepath.Join(dl.DriverDir(), binaryName)
	markerPath := binaryPath + ".unverified"

	// Write a fake binary and marker
	content := []byte("test binary content")
	os.WriteFile(binaryPath, content, 0755)
	os.WriteFile(markerPath, []byte("built from source"), 0644)

	// Create a checksums file that matches
	h := sha256.Sum256(content)
	checksum := hex.EncodeToString(h[:])
	checksumsContent := fmt.Sprintf("%s  %s\n", checksum, binaryName)
	os.WriteFile(filepath.Join(dl.DriverDir(), "driver-checksums-sha256.txt"), []byte(checksumsContent), 0644)

	// Verify should succeed and remove the marker
	dl.VerifyUnverifiedDrivers()

	if _, err := os.Stat(markerPath); err == nil {
		t.Error("marker should be removed after successful verification")
	}
	if _, err := os.Stat(binaryPath); err != nil {
		t.Error("binary should still exist after verification")
	}
}

func TestVerifyChecksumMismatch(t *testing.T) {
	tmpDir := t.TempDir()
	dl := NewDownloader(tmpDir, "0.1.27", "itsJeremyMax/omnibase")
	dl.EnsureDriverDir()

	platform := fmt.Sprintf("%s-%s", runtime.GOOS, runtime.GOARCH)
	binaryName := "driver-test-" + platform
	binaryPath := filepath.Join(dl.DriverDir(), binaryName)
	markerPath := binaryPath + ".unverified"

	// Write a fake binary and marker
	os.WriteFile(binaryPath, []byte("local binary"), 0755)
	os.WriteFile(markerPath, []byte("built from source"), 0644)

	// Create a checksums file with a DIFFERENT hash
	checksumsContent := fmt.Sprintf("0000000000000000000000000000000000000000000000000000000000000000  %s\n", binaryName)
	os.WriteFile(filepath.Join(dl.DriverDir(), "driver-checksums-sha256.txt"), []byte(checksumsContent), 0644)

	// Verify should detect mismatch - binary and marker should both be removed
	// (it will try to re-download, which will fail, but both files should be cleaned up)
	dl.VerifyUnverifiedDrivers()

	if _, err := os.Stat(markerPath); err == nil {
		t.Error("marker should be removed after checksum mismatch")
	}
	// Binary should also be removed (download will fail but cleanup happened)
	if _, err := os.Stat(binaryPath); err == nil {
		t.Error("binary should be removed after checksum mismatch")
	}
}

func TestSidecarDir(t *testing.T) {
	tmpDir := t.TempDir()
	dl := NewDownloader(tmpDir, "0.1.27", "itsJeremyMax/omnibase")

	// SidecarDir should return something (or empty string if not found)
	dir := dl.SidecarDir()
	// We can't guarantee the exact value, but it shouldn't panic
	_ = dir
}

func TestNewDownloader(t *testing.T) {
	dl := NewDownloader("/tmp/test", "1.2.3", "owner/repo")
	if dl.baseDir != "/tmp/test" {
		t.Errorf("baseDir = %q, want /tmp/test", dl.baseDir)
	}
	if dl.version != "1.2.3" {
		t.Errorf("version = %q, want 1.2.3", dl.version)
	}
	if dl.repo != "owner/repo" {
		t.Errorf("repo = %q, want owner/repo", dl.repo)
	}
}

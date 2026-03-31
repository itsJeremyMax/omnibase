package drivermanager

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
)

// Downloader handles downloading driver plugin binaries from GitHub releases.
type Downloader struct {
	baseDir string // e.g., ~/.omnibase/drivers
	version string // e.g., "0.1.27"
	repo    string // e.g., "itsJeremyMax/omnibase"
}

// NewDownloader creates a new Downloader.
func NewDownloader(baseDir, version, repo string) *Downloader {
	return &Downloader{baseDir: baseDir, version: version, repo: repo}
}

// DriverDir returns the versioned driver directory: <baseDir>/<version>/
func (d *Downloader) DriverDir() string {
	return filepath.Join(d.baseDir, d.version)
}

// EnsureDriverDir creates the versioned driver directory if it does not exist.
func (d *Downloader) EnsureDriverDir() error {
	return os.MkdirAll(d.DriverDir(), 0755)
}

// DownloadDriver downloads a driver binary from GitHub releases into DriverDir.
func (d *Downloader) DownloadDriver(binaryName string) error {
	if err := d.EnsureDriverDir(); err != nil {
		return err
	}

	platform := fmt.Sprintf("%s-%s", runtime.GOOS, runtime.GOARCH)
	assetName := binaryName + "-" + platform
	destPath := filepath.Join(d.DriverDir(), assetName)

	// Skip if already exists
	if _, err := os.Stat(destPath); err == nil {
		return nil
	}

	url := fmt.Sprintf("https://github.com/%s/releases/download/omnibase-mcp-v%s/%s",
		d.repo, d.version, assetName)

	fmt.Fprintf(os.Stderr, "[sidecar] downloading %s...\n", assetName)

	if err := downloadFile(url, destPath); err != nil {
		os.Remove(destPath)
		return fmt.Errorf("failed to download %s: %w", assetName, err)
	}

	// Verify checksum
	if err := d.verifyChecksum(assetName, destPath); err != nil {
		os.Remove(destPath)
		return err
	}

	if err := os.Chmod(destPath, 0755); err != nil {
		return fmt.Errorf("failed to chmod %s: %w", destPath, err)
	}

	fmt.Fprintf(os.Stderr, "[sidecar] %s downloaded and verified.\n", assetName)
	return nil
}

// DownloadManifest downloads drivers.json from the release into DriverDir.
func (d *Downloader) DownloadManifest() error {
	if err := d.EnsureDriverDir(); err != nil {
		return err
	}

	destPath := filepath.Join(d.DriverDir(), "drivers.json")
	if _, err := os.Stat(destPath); err == nil {
		return nil
	}

	url := fmt.Sprintf("https://github.com/%s/releases/download/omnibase-mcp-v%s/drivers.json",
		d.repo, d.version)

	return downloadFile(url, destPath)
}

func (d *Downloader) verifyChecksum(assetName, filePath string) error {
	checksumsPath := filepath.Join(d.DriverDir(), "driver-checksums-sha256.txt")
	if _, err := os.Stat(checksumsPath); err != nil {
		url := fmt.Sprintf("https://github.com/%s/releases/download/omnibase-mcp-v%s/driver-checksums-sha256.txt",
			d.repo, d.version)
		if err := downloadFile(url, checksumsPath); err != nil {
			return fmt.Errorf("failed to download checksums: %w", err)
		}
	}

	data, err := os.ReadFile(checksumsPath)
	if err != nil {
		return fmt.Errorf("failed to read checksums: %w", err)
	}

	var expectedHash string
	for _, line := range strings.Split(string(data), "\n") {
		parts := strings.Fields(line)
		if len(parts) == 2 && parts[1] == assetName {
			expectedHash = parts[0]
			break
		}
	}
	if expectedHash == "" {
		return fmt.Errorf("no checksum found for %s", assetName)
	}

	f, err := os.Open(filePath)
	if err != nil {
		return err
	}
	defer f.Close()

	h := sha256.New()
	if _, err := io.Copy(h, f); err != nil {
		return err
	}
	actualHash := hex.EncodeToString(h.Sum(nil))

	if actualHash != expectedHash {
		return fmt.Errorf("checksum mismatch for %s: expected %s, got %s", assetName, expectedHash, actualHash)
	}

	return nil
}

// BuildDriverFromSource compiles a driver plugin from source using Go.
// The binary is marked as unverified (a .unverified marker file is created).
// Returns the path to the built binary, or an error.
// sidecarDir should point to the sidecar source directory containing drivers/<name>/main.go.
func (d *Downloader) BuildDriverFromSource(binaryName, sidecarDir string) (string, error) {
	// Check if Go is available
	if _, err := exec.LookPath("go"); err != nil {
		return "", fmt.Errorf("Go is not installed (needed to build driver from source)")
	}

	if err := d.EnsureDriverDir(); err != nil {
		return "", err
	}

	// Derive the driver package name from the binary name (e.g., "driver-postgres" -> "postgres")
	driverPkg := strings.TrimPrefix(binaryName, "driver-")
	pkgDir := filepath.Join(sidecarDir, "drivers", driverPkg)
	if _, err := os.Stat(filepath.Join(pkgDir, "main.go")); err != nil {
		return "", fmt.Errorf("driver source not found at %s", pkgDir)
	}

	platform := fmt.Sprintf("%s-%s", runtime.GOOS, runtime.GOARCH)
	destPath := filepath.Join(d.DriverDir(), binaryName+"-"+platform)

	fmt.Fprintf(os.Stderr, "[sidecar] building %s from source...\n", binaryName)

	cmd := exec.Command("go", "build", "-o", destPath, "./drivers/"+driverPkg+"/")
	cmd.Dir = sidecarDir
	cmd.Stderr = os.Stderr
	if err := cmd.Run(); err != nil {
		os.Remove(destPath)
		return "", fmt.Errorf("go build failed for %s: %w", driverPkg, err)
	}

	if err := os.Chmod(destPath, 0755); err != nil {
		return "", err
	}

	// Mark as unverified
	markerPath := destPath + ".unverified"
	os.WriteFile(markerPath, []byte("built from source"), 0644)

	fmt.Fprintf(os.Stderr, "[sidecar] %s built from source (unverified).\n", binaryName)
	return destPath, nil
}

// VerifyUnverifiedDrivers checks all .unverified markers in DriverDir and
// attempts to verify them against the release checksums. If verification
// succeeds, the marker is removed. If the checksum doesn't match, the
// binary is replaced with the official release binary.
func (d *Downloader) VerifyUnverifiedDrivers() {
	dir := d.DriverDir()
	entries, err := os.ReadDir(dir)
	if err != nil {
		return
	}

	for _, entry := range entries {
		if !strings.HasSuffix(entry.Name(), ".unverified") {
			continue
		}

		binaryFile := strings.TrimSuffix(entry.Name(), ".unverified")
		binaryPath := filepath.Join(dir, binaryFile)
		markerPath := filepath.Join(dir, entry.Name())

		// Try to verify against release checksums
		err := d.verifyChecksum(binaryFile, binaryPath)
		if err == nil {
			// Checksum matches release - remove unverified marker
			os.Remove(markerPath)
			fmt.Fprintf(os.Stderr, "[sidecar] %s verified against release checksum.\n", binaryFile)
			continue
		}

		// If we can't download checksums at all (no network), skip silently
		if strings.Contains(err.Error(), "failed to download checksums") {
			continue
		}

		// Checksum doesn't match or not found - try to download the official binary
		fmt.Fprintf(os.Stderr, "[sidecar] %s doesn't match release, downloading official binary...\n", binaryFile)

		// Extract binary name without platform suffix for download
		// e.g., "driver-postgres-darwin-arm64" -> "driver-postgres"
		platform := fmt.Sprintf("%s-%s", runtime.GOOS, runtime.GOARCH)
		baseName := strings.TrimSuffix(binaryFile, "-"+platform)

		os.Remove(binaryPath)
		os.Remove(markerPath)
		d.DownloadDriver(baseName) // best effort
	}
}

// SidecarDir attempts to find the sidecar source directory.
// Looks relative to the sidecar binary location.
func (d *Downloader) SidecarDir() string {
	exe, err := os.Executable()
	if err != nil {
		return ""
	}

	dir := filepath.Dir(exe)

	// Binary is in sidecar/ directly (e.g., sidecar/omnibase-sidecar)
	if _, err := os.Stat(filepath.Join(dir, "drivers")); err == nil {
		return dir
	}

	// Binary is in sidecar/bin/ (e.g., sidecar/bin/omnibase-sidecar)
	parent := filepath.Dir(dir)
	if _, err := os.Stat(filepath.Join(parent, "drivers")); err == nil {
		return parent
	}

	return ""
}

// CleanOldVersions removes version directories under baseDir, keeping the
// current version and the one immediately before it.
func (d *Downloader) CleanOldVersions() {
	entries, err := os.ReadDir(d.baseDir)
	if err != nil {
		return
	}

	var versions []string
	for _, entry := range entries {
		if entry.IsDir() {
			versions = append(versions, entry.Name())
		}
	}

	sort.Strings(versions)

	// Keep current version and one before it
	keep := map[string]bool{d.version: true}
	for i, v := range versions {
		if v == d.version && i > 0 {
			keep[versions[i-1]] = true
		}
	}

	for _, v := range versions {
		if !keep[v] {
			os.RemoveAll(filepath.Join(d.baseDir, v))
		}
	}
}

func downloadFile(url, dest string) error {
	resp, err := http.Get(url) //nolint:gosec
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		return fmt.Errorf("HTTP %d from %s", resp.StatusCode, url)
	}

	f, err := os.Create(dest)
	if err != nil {
		return err
	}
	defer f.Close()

	_, err = io.Copy(f, resp.Body)
	return err
}

package drivermanager

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"sync"

	"github.com/itsJeremyMax/omnibase/sidecar/driverclient"
)

// Manifest is the top-level structure of drivers.json.
type Manifest struct {
	Drivers map[string]DriverEntry `json:"drivers"`
}

// DriverEntry describes a single driver in the manifest.
type DriverEntry struct {
	Binary  string   `json:"binary"`
	Schemes []string `json:"schemes"`
}

// Manager resolves DSN schemes to driver binaries and manages subprocess lifecycle.
type Manager struct {
	driversDir       string
	downloader       *Downloader
	embeddedManifest []byte // compiled into the binary via go:embed
	manifest         *Manifest
	schemeMap        map[string]string // scheme -> binary name

	mu      sync.Mutex
	clients map[string]*driverclient.DriverClient // binary name -> client
}

// NewManager creates a Manager rooted at driversDir and loads the manifest.
// downloader may be nil; if provided it is used to download missing drivers on demand.
// embeddedManifest is the drivers.json content compiled into the binary (may be nil in tests).
func NewManager(driversDir string, downloader *Downloader, embeddedManifest []byte) *Manager {
	mgr := &Manager{
		driversDir:       driversDir,
		downloader:       downloader,
		embeddedManifest: embeddedManifest,
		clients:          make(map[string]*driverclient.DriverClient),
	}
	mgr.loadManifest()
	return mgr
}

func (m *Manager) loadManifest() {
	m.schemeMap = make(map[string]string)

	var data []byte

	// 1. Try drivers.json on disk (version-specific dir or driversDir)
	manifestPath := filepath.Join(m.driversDir, "drivers.json")
	if d, err := os.ReadFile(manifestPath); err == nil {
		data = d
	}

	// 2. Try downloading from release
	if data == nil && m.downloader != nil {
		if dlErr := m.downloader.DownloadManifest(); dlErr == nil {
			if d, err := os.ReadFile(filepath.Join(m.downloader.DriverDir(), "drivers.json")); err == nil {
				data = d
			}
		}
	}

	// 3. Use the embedded manifest (always available, compiled into the binary)
	if data == nil && len(m.embeddedManifest) > 0 {
		data = m.embeddedManifest
	}

	if data == nil {
		return
	}

	var manifest Manifest
	if err := json.Unmarshal(data, &manifest); err != nil {
		return
	}

	m.manifest = &manifest
	for _, entry := range manifest.Drivers {
		for _, scheme := range entry.Schemes {
			m.schemeMap[scheme] = entry.Binary
		}
	}
}

// ResolveDriver maps a DSN scheme to its driver binary name.
func (m *Manager) ResolveDriver(scheme string) (string, error) {
	binary, ok := m.schemeMap[scheme]
	if !ok {
		return "", fmt.Errorf("no driver found for scheme %q. Run `omnibase-mcp drivers list` to see available drivers", scheme)
	}
	return binary, nil
}

// GetClient returns an existing running client for binaryName, or spawns a new one.
func (m *Manager) GetClient(binaryName string) (*driverclient.DriverClient, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	if client, ok := m.clients[binaryName]; ok && client.IsRunning() {
		return client, nil
	}

	platform := fmt.Sprintf("%s-%s", runtime.GOOS, runtime.GOARCH)
	binaryPath := filepath.Join(m.driversDir, binaryName+"-"+platform)

	// Also check without platform suffix (for local dev builds)
	if _, err := os.Stat(binaryPath); err != nil {
		altPath := filepath.Join(m.driversDir, binaryName)
		if _, err2 := os.Stat(altPath); err2 == nil {
			binaryPath = altPath
		} else if m.downloader != nil {
			// Also check the downloader's versioned dir (may differ from m.driversDir)
			dlDirPath := filepath.Join(m.downloader.DriverDir(), binaryName+"-"+platform)
			if _, err3 := os.Stat(dlDirPath); err3 == nil {
				binaryPath = dlDirPath
			} else {
				// Binary not found locally; try downloading, then building from source
				dlErr := m.downloader.DownloadDriver(binaryName)
				if dlErr == nil {
					binaryPath = filepath.Join(m.downloader.DriverDir(), binaryName+"-"+platform)
				} else {
					// Download failed; try building from source
					sidecarDir := m.downloader.SidecarDir()
					if sidecarDir != "" {
						builtPath, buildErr := m.downloader.BuildDriverFromSource(binaryName, sidecarDir)
						if buildErr == nil {
							binaryPath = builtPath
						} else {
							return nil, fmt.Errorf("driver %s not available: download failed (%v), source build failed (%v)", binaryName, dlErr, buildErr)
						}
					} else {
						return nil, fmt.Errorf("driver %s not available and could not build from source: %w", binaryName, dlErr)
					}
				}
			}
		}
	}

	client, err := driverclient.NewDriverClient(binaryPath)
	if err != nil {
		return nil, fmt.Errorf("failed to start driver %s: %w", binaryName, err)
	}

	m.clients[binaryName] = client
	return client, nil
}

// StopAll kills all managed driver subprocesses.
func (m *Manager) StopAll() {
	m.mu.Lock()
	defer m.mu.Unlock()
	for name, client := range m.clients {
		client.Stop()
		delete(m.clients, name)
	}
}

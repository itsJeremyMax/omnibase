package main

import (
	"bufio"
	_ "embed"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"

	"github.com/xo/dburl"

	"github.com/itsJeremyMax/omnibase/sidecar/driverclient"
	dp "github.com/itsJeremyMax/omnibase/sidecar/driverplugin"
	"github.com/itsJeremyMax/omnibase/sidecar/drivermanager"
)

//go:embed drivers.json
var embeddedManifest []byte

var (
	routesMu         sync.RWMutex
	connectionRoutes = make(map[string]*driverclient.DriverClient)
)

func main() {
	fmt.Fprintln(os.Stderr, "omnibase-sidecar starting...")

	version := getVersion()
	base := resolveDriversBase()
	var dl *drivermanager.Downloader
	if base != "" {
		dl = drivermanager.NewDownloader(base, version, "itsJeremyMax/omnibase")
		if version != "dev" {
			dl.EnsureDriverDir()
			dl.CleanOldVersions()
			go dl.VerifyUnverifiedDrivers()
		}
	}

	driversDir := resolveDriversDir(dl)
	fmt.Fprintf(os.Stderr, "omnibase-sidecar drivers dir: %s\n", driversDir)
	mgr := drivermanager.NewManager(driversDir, dl, embeddedManifest)
	defer mgr.StopAll()

	scanner := bufio.NewScanner(os.Stdin)
	scanner.Buffer(make([]byte, 0, 16*1024*1024), 16*1024*1024)

	for scanner.Scan() {
		line := scanner.Text()
		if strings.TrimSpace(line) == "" {
			continue
		}

		req, err := dp.ReadRequest([]byte(line))
		if err != nil {
			resp := dp.MakeError(0, "PARSE_ERROR", "invalid JSON-RPC request", err.Error())
			writeResponse(resp)
			continue
		}

		resp := handleRequest(mgr, req, []byte(line))
		writeResponse(resp)
	}

	if err := scanner.Err(); err != nil {
		fmt.Fprintf(os.Stderr, "stdin read error: %v\n", err)
		os.Exit(1)
	}
}

func handleRequest(mgr *drivermanager.Manager, req dp.RPCRequest, rawLine []byte) dp.RPCResponse {
	switch req.Method {
	case "connect":
		return handleConnect(mgr, req, rawLine)
	case "execute", "schema", "explain", "validate", "ping", "disconnect":
		return forwardToDriver(req, rawLine)
	default:
		return dp.MakeError(req.ID, "METHOD_NOT_FOUND", fmt.Sprintf("unknown method: %s", req.Method), "")
	}
}

func handleConnect(mgr *drivermanager.Manager, req dp.RPCRequest, rawLine []byte) dp.RPCResponse {
	id := req.Params.ID
	dsn := req.Params.DSN

	if id == "" || dsn == "" {
		return dp.MakeError(req.ID, "INVALID_PARAMS", "id and dsn are required", "")
	}

	// Parse DSN to determine the driver scheme
	u, err := dburl.Parse(dsn)
	if err != nil {
		return dp.MakeError(req.ID, "INVALID_PARAMS", fmt.Sprintf("failed to parse DSN: %v", err), "")
	}

	scheme := u.Driver
	if scheme == "" {
		scheme = strings.Split(dsn, ":")[0]
	}

	// Resolve scheme to driver binary
	binaryName, err := mgr.ResolveDriver(scheme)
	if err != nil {
		return dp.MakeError(req.ID, "DRIVER_NOT_FOUND", err.Error(), "")
	}

	// Get or spawn the driver subprocess
	client, err := mgr.GetClient(binaryName)
	if err != nil {
		return dp.MakeError(req.ID, "DRIVER_ERROR", err.Error(), "")
	}

	// Extract raw params from the original request line
	rawParams := extractRawParams(rawLine)

	// Forward the connect request to the driver
	result, err := client.Send("connect", rawParams)
	if err != nil {
		return dp.MakeError(req.ID, "CONNECTION_ERROR", err.Error(), "")
	}

	// Store the route
	routesMu.Lock()
	connectionRoutes[id] = client
	routesMu.Unlock()

	return dp.RPCResponse{
		JSONRPC: "2.0",
		ID:      req.ID,
		Result:  unmarshalRaw(result),
	}
}

func forwardToDriver(req dp.RPCRequest, rawLine []byte) dp.RPCResponse {
	id := req.Params.ID

	routesMu.RLock()
	client, ok := connectionRoutes[id]
	routesMu.RUnlock()

	if !ok {
		return dp.MakeError(req.ID, "CONNECTION_ERROR", fmt.Sprintf("connection '%s' not found", id), "")
	}

	rawParams := extractRawParams(rawLine)

	result, err := client.Send(req.Method, rawParams)
	if err != nil {
		// Map error codes based on method
		code := "QUERY_ERROR"
		switch req.Method {
		case "ping":
			code = "PING_ERROR"
		case "disconnect":
			code = "DISCONNECT_ERROR"
		case "schema":
			code = "SCHEMA_ERROR"
		}
		return dp.MakeError(req.ID, code, err.Error(), "")
	}

	// Clean up route on disconnect
	if req.Method == "disconnect" {
		routesMu.Lock()
		delete(connectionRoutes, id)
		routesMu.Unlock()
	}

	return dp.RPCResponse{
		JSONRPC: "2.0",
		ID:      req.ID,
		Result:  unmarshalRaw(result),
	}
}

// extractRawParams extracts the "params" field from a raw JSON-RPC request.
func extractRawParams(rawLine []byte) json.RawMessage {
	var raw struct {
		Params json.RawMessage `json:"params"`
	}
	json.Unmarshal(rawLine, &raw)
	return raw.Params
}

// unmarshalRaw converts json.RawMessage to interface{} for RPCResponse.Result.
func unmarshalRaw(data json.RawMessage) interface{} {
	var v interface{}
	json.Unmarshal(data, &v)
	return v
}

func resolveDriversBase() string {
	if dir := os.Getenv("OMNIBASE_DRIVERS_PATH"); dir != "" {
		return dir
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return ""
	}
	return filepath.Join(home, ".omnibase", "drivers")
}

func resolveDriversDir(dl *drivermanager.Downloader) string {
	// 1. Downloader's versioned dir (when a downloader is configured)
	if dl != nil {
		dir := dl.DriverDir()
		if _, err := os.Stat(dir); err == nil {
			return dir
		}
	}

	// 2. OMNIBASE_DRIVERS_PATH env var (flat directory, e.g. for dev/testing)
	if dir := os.Getenv("OMNIBASE_DRIVERS_PATH"); dir != "" {
		return dir
	}

	// 3. ~/.omnibase/drivers/<version>/
	home, err := os.UserHomeDir()
	if err == nil {
		version := getVersion()
		dir := filepath.Join(home, ".omnibase", "drivers", version)
		if _, err := os.Stat(dir); err == nil {
			return dir
		}
	}

	// 4. Fallback: current directory
	return "."
}

func getVersion() string {
	exe, err := os.Executable()
	if err != nil {
		return "dev"
	}
	versionFile := filepath.Join(filepath.Dir(exe), ".sidecar-version")
	data, err := os.ReadFile(versionFile)
	if err != nil {
		return "dev"
	}
	return strings.TrimSpace(string(data))
}

func writeResponse(resp dp.RPCResponse) {
	data, err := json.Marshal(resp)
	if err != nil {
		fmt.Fprintf(os.Stderr, "failed to marshal response: %v\n", err)
		return
	}
	fmt.Println(string(data))
}

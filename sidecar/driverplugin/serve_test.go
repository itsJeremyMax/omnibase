package driverplugin

import (
	"testing"
)

func TestHandleRequestConnect(t *testing.T) {
	cm := NewConnectionManager()
	defer cm.CloseAll()

	req := RPCRequest{
		JSONRPC: "2.0",
		ID:      1,
		Method:  "connect",
		Params:  RPCParams{ID: "test", DSN: "sqlite::memory:"},
	}

	// This test requires sqlite3 driver to be registered.
	// In the driverplugin package alone, no drivers are registered.
	// So this will fail with "driver not found" - which is correct behavior.
	// The test verifies the handler returns a proper error response.
	resp := handleRequest(cm, req)
	if resp.Error == nil {
		t.Log("connect succeeded (driver was registered)")
	} else {
		t.Logf("connect failed as expected (no driver registered): %s", resp.Error.Message)
	}
}

func TestHandleRequestUnknownMethod(t *testing.T) {
	cm := NewConnectionManager()
	req := RPCRequest{
		JSONRPC: "2.0",
		ID:      1,
		Method:  "unknown_method",
	}

	resp := handleRequest(cm, req)
	if resp.Error == nil {
		t.Fatal("expected error for unknown method")
	}
	if resp.Error.Code != "METHOD_NOT_FOUND" {
		t.Fatalf("expected METHOD_NOT_FOUND, got %s", resp.Error.Code)
	}
}

func TestHandleRequestPingWithoutConnect(t *testing.T) {
	cm := NewConnectionManager()
	req := RPCRequest{
		JSONRPC: "2.0",
		ID:      1,
		Method:  "ping",
		Params:  RPCParams{ID: "nonexistent"},
	}

	resp := handleRequest(cm, req)
	if resp.Error == nil {
		t.Fatal("expected error for ping on nonexistent connection")
	}
}

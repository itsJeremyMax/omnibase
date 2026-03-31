package driverplugin

import (
	"encoding/json"
	"testing"
)

func TestReadRequest(t *testing.T) {
	input := `{"jsonrpc":"2.0","id":1,"method":"connect","params":{"id":"test","dsn":"sqlite::memory:"}}`
	req, err := ReadRequest([]byte(input))
	if err != nil {
		t.Fatalf("ReadRequest failed: %v", err)
	}
	if req.Method != "connect" {
		t.Fatalf("expected method 'connect', got '%s'", req.Method)
	}
	if req.Params.ID != "test" {
		t.Fatalf("expected params.id 'test', got '%s'", req.Params.ID)
	}
	if req.Params.DSN != "sqlite::memory:" {
		t.Fatalf("expected params.dsn 'sqlite::memory:', got '%s'", req.Params.DSN)
	}
}

func TestMakeSuccess(t *testing.T) {
	resp := MakeSuccess(1, ConnectResult{OK: true, Driver: "sqlite3"})
	if resp.JSONRPC != "2.0" {
		t.Fatal("expected jsonrpc 2.0")
	}
	if resp.ID != 1 {
		t.Fatal("expected id 1")
	}
	if resp.Error != nil {
		t.Fatal("expected no error")
	}

	data, _ := json.Marshal(resp)
	if len(data) == 0 {
		t.Fatal("marshal produced empty output")
	}
}

func TestMakeError(t *testing.T) {
	resp := MakeError(1, "TEST_ERROR", "test message", "detail")
	if resp.Error == nil {
		t.Fatal("expected error")
	}
	if resp.Error.Code != "TEST_ERROR" {
		t.Fatalf("expected code TEST_ERROR, got %s", resp.Error.Code)
	}
}

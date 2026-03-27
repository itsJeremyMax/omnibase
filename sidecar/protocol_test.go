package main

import (
	"encoding/json"
	"testing"
)

func TestParseConnectRequest(t *testing.T) {
	input := `{"jsonrpc":"2.0","id":1,"method":"connect","params":{"id":"local","dsn":"sqlite:./test.db"}}`
	var req RPCRequest
	if err := json.Unmarshal([]byte(input), &req); err != nil {
		t.Fatalf("failed to parse: %v", err)
	}
	if req.Method != "connect" {
		t.Errorf("expected method 'connect', got '%s'", req.Method)
	}
	if req.ID != 1 {
		t.Errorf("expected id 1, got %d", req.ID)
	}
}

func TestParseExecuteRequest(t *testing.T) {
	input := `{"jsonrpc":"2.0","id":2,"method":"execute","params":{"id":"local","query":"SELECT * FROM users WHERE id = ?","params":[42],"max_rows":100,"timeout_ms":5000}}`
	var req RPCRequest
	if err := json.Unmarshal([]byte(input), &req); err != nil {
		t.Fatalf("failed to parse: %v", err)
	}
	if req.Method != "execute" {
		t.Errorf("expected method 'execute', got '%s'", req.Method)
	}
	params := req.Params
	if params.Query != "SELECT * FROM users WHERE id = ?" {
		t.Errorf("unexpected query: %s", params.Query)
	}
	if len(params.QueryParams) != 1 {
		t.Fatalf("expected 1 param, got %d", len(params.QueryParams))
	}
	if params.MaxRows != 100 {
		t.Errorf("expected max_rows 100, got %d", params.MaxRows)
	}
}

func TestSerializeSuccessResponse(t *testing.T) {
	resp := RPCResponse{
		JSONRPC: "2.0",
		ID:      1,
		Result: &ExecuteResult{
			Columns:  []string{"id", "name"},
			Rows:     [][]interface{}{{1, "alice"}},
			RowCount: 1,
			HasMore:  false,
		},
	}
	data, err := json.Marshal(resp)
	if err != nil {
		t.Fatalf("failed to serialize: %v", err)
	}
	// Verify it round-trips
	var parsed RPCResponse
	if err := json.Unmarshal(data, &parsed); err != nil {
		t.Fatalf("failed to re-parse: %v", err)
	}
	if parsed.ID != 1 {
		t.Errorf("expected id 1, got %d", parsed.ID)
	}
}

func TestSerializeErrorResponse(t *testing.T) {
	resp := RPCResponse{
		JSONRPC: "2.0",
		ID:      5,
		Error: &RPCError{
			Code:    "CONNECTION_ERROR",
			Message: "failed to connect",
			Detail:  "dial tcp: connection refused",
		},
	}
	data, err := json.Marshal(resp)
	if err != nil {
		t.Fatalf("failed to serialize: %v", err)
	}
	if len(data) == 0 {
		t.Error("expected non-empty output")
	}
}

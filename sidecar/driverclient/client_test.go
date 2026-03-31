package driverclient

import (
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"testing"
)

func buildSqliteDriver(t *testing.T) string {
	t.Helper()
	binaryPath := t.TempDir() + "/driver-sqlite3"
	cmd := exec.Command("go", "build", "-o", binaryPath, "./drivers/sqlite3/")
	cmd.Stderr = os.Stderr
	// Run from the sidecar module root (parent of this package)
	cmd.Dir = ".."
	if err := cmd.Run(); err != nil {
		t.Skipf("failed to build sqlite3 driver: %v", err)
	}
	return binaryPath
}

func TestDriverClientConnectAndPing(t *testing.T) {
	binaryPath := buildSqliteDriver(t)

	client, err := NewDriverClient(binaryPath)
	if err != nil {
		t.Fatalf("NewDriverClient failed: %v", err)
	}
	defer client.Stop()

	// Connect
	params, _ := json.Marshal(map[string]interface{}{
		"id":  "test",
		"dsn": "sqlite::memory:",
	})
	result, err := client.Send("connect", params)
	if err != nil {
		t.Fatalf("connect failed: %v", err)
	}

	var connectResult map[string]interface{}
	json.Unmarshal(result, &connectResult)
	if connectResult["ok"] != true {
		t.Fatalf("expected ok=true, got %v", connectResult["ok"])
	}
	if connectResult["driver"] != "sqlite3" {
		t.Fatalf("expected driver=sqlite3, got %v", connectResult["driver"])
	}

	// Ping
	pingParams, _ := json.Marshal(map[string]interface{}{"id": "test"})
	_, err = client.Send("ping", pingParams)
	if err != nil {
		t.Fatalf("ping failed: %v", err)
	}

	// Execute a query
	execParams, _ := json.Marshal(map[string]interface{}{
		"id":         "test",
		"query":      "SELECT 1 + 1 AS result",
		"max_rows":   10,
		"timeout_ms": 5000,
	})
	execResult, err := client.Send("execute", execParams)
	if err != nil {
		t.Fatalf("execute failed: %v", err)
	}

	var queryResult map[string]interface{}
	json.Unmarshal(execResult, &queryResult)
	if queryResult["row_count"] == nil {
		t.Fatal("expected row_count in result")
	}

	// Disconnect
	disconnParams, _ := json.Marshal(map[string]interface{}{"id": "test"})
	_, err = client.Send("disconnect", disconnParams)
	if err != nil {
		t.Fatalf("disconnect failed: %v", err)
	}
}

func TestDriverClientNotFound(t *testing.T) {
	_, err := NewDriverClient("/nonexistent/binary")
	if err == nil {
		t.Fatal("expected error for nonexistent binary")
	}
}

func TestDriverClientMultipleConnections(t *testing.T) {
	binaryPath := buildSqliteDriver(t)

	client, err := NewDriverClient(binaryPath)
	if err != nil {
		t.Fatalf("NewDriverClient failed: %v", err)
	}
	defer client.Stop()

	// Open multiple connections on the same driver subprocess
	for i := 0; i < 5; i++ {
		connID := fmt.Sprintf("conn-%d", i)
		params, _ := json.Marshal(map[string]interface{}{
			"id":  connID,
			"dsn": "sqlite::memory:",
		})
		_, err := client.Send("connect", params)
		if err != nil {
			t.Fatalf("connect %s failed: %v", connID, err)
		}
	}

	// Execute on each connection
	for i := 0; i < 5; i++ {
		connID := fmt.Sprintf("conn-%d", i)
		params, _ := json.Marshal(map[string]interface{}{
			"id":         connID,
			"query":      fmt.Sprintf("SELECT %d AS val", i),
			"max_rows":   10,
			"timeout_ms": 5000,
		})
		result, err := client.Send("execute", params)
		if err != nil {
			t.Fatalf("execute on %s failed: %v", connID, err)
		}
		var qr map[string]interface{}
		json.Unmarshal(result, &qr)
		if qr["row_count"] == nil {
			t.Fatalf("expected row_count on %s", connID)
		}
	}

	// Disconnect all
	for i := 0; i < 5; i++ {
		connID := fmt.Sprintf("conn-%d", i)
		params, _ := json.Marshal(map[string]interface{}{"id": connID})
		_, err := client.Send("disconnect", params)
		if err != nil {
			t.Fatalf("disconnect %s failed: %v", connID, err)
		}
	}
}

func TestDriverClientSchemaAndExplain(t *testing.T) {
	binaryPath := buildSqliteDriver(t)

	client, err := NewDriverClient(binaryPath)
	if err != nil {
		t.Fatalf("NewDriverClient failed: %v", err)
	}
	defer client.Stop()

	// Connect and create a table
	connectParams, _ := json.Marshal(map[string]interface{}{"id": "schema-test", "dsn": "sqlite::memory:"})
	client.Send("connect", connectParams)

	createParams, _ := json.Marshal(map[string]interface{}{
		"id": "schema-test", "query": "CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT, price REAL)",
		"max_rows": 10, "timeout_ms": 5000,
	})
	client.Send("execute", createParams)

	// Get schema
	schemaParams, _ := json.Marshal(map[string]interface{}{"id": "schema-test"})
	schemaResult, err := client.Send("schema", schemaParams)
	if err != nil {
		t.Fatalf("schema failed: %v", err)
	}
	var schema map[string]interface{}
	json.Unmarshal(schemaResult, &schema)
	tables, ok := schema["tables"].([]interface{})
	if !ok || len(tables) == 0 {
		t.Fatal("expected at least one table in schema")
	}

	// Explain
	explainParams, _ := json.Marshal(map[string]interface{}{
		"id": "schema-test", "query": "SELECT * FROM items WHERE price > 10",
	})
	explainResult, err := client.Send("explain", explainParams)
	if err != nil {
		t.Fatalf("explain failed: %v", err)
	}
	var plan map[string]interface{}
	json.Unmarshal(explainResult, &plan)
	if plan["columns"] == nil {
		t.Fatal("expected columns in explain result")
	}

	// Validate valid query
	validateParams, _ := json.Marshal(map[string]interface{}{
		"id": "schema-test", "query": "SELECT * FROM items",
	})
	validateResult, err := client.Send("validate", validateParams)
	if err != nil {
		t.Fatalf("validate failed: %v", err)
	}
	var vr map[string]interface{}
	json.Unmarshal(validateResult, &vr)
	if vr["valid"] != true {
		t.Fatalf("expected valid=true, got %v", vr["valid"])
	}

	// Validate invalid query
	invalidParams, _ := json.Marshal(map[string]interface{}{
		"id": "schema-test", "query": "SELCT BAD SYNTAX",
	})
	invalidResult, err := client.Send("validate", invalidParams)
	if err != nil {
		t.Fatalf("validate (invalid) failed: %v", err)
	}
	var ir map[string]interface{}
	json.Unmarshal(invalidResult, &ir)
	if ir["valid"] != false {
		t.Fatalf("expected valid=false for bad SQL, got %v", ir["valid"])
	}
}

func TestDriverClientCrashRecovery(t *testing.T) {
	binaryPath := buildSqliteDriver(t)

	client, err := NewDriverClient(binaryPath)
	if err != nil {
		t.Fatalf("NewDriverClient failed: %v", err)
	}

	// Connect and verify it works
	params, _ := json.Marshal(map[string]interface{}{"id": "test", "dsn": "sqlite::memory:"})
	_, err = client.Send("connect", params)
	if err != nil {
		t.Fatalf("connect failed: %v", err)
	}

	// Kill the subprocess
	client.Stop()

	// Subsequent requests should fail with a clear error
	pingParams, _ := json.Marshal(map[string]interface{}{"id": "test"})
	_, err = client.Send("ping", pingParams)
	if err == nil {
		t.Fatal("expected error after subprocess killed")
	}

	// IsRunning should return false
	if client.IsRunning() {
		t.Fatal("expected IsRunning=false after Stop")
	}
}

package main

import (
	"testing"
)

func setupTestDB(t *testing.T) *ConnectionManager {
	t.Helper()
	cm := NewConnectionManager()
	if err := cm.Connect("test", "sq::memory:"); err != nil {
		t.Fatalf("setup failed: %v", err)
	}

	// Create a test table via Execute (which is what the MCP server uses)
	_, err := Execute(cm, "test", `CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, email TEXT)`, nil, 0, 5000)
	if err != nil {
		t.Fatalf("create table failed: %v", err)
	}
	_, err = Execute(cm, "test", `INSERT INTO users (id, name, email) VALUES (1, 'Alice', 'alice@example.com'), (2, 'Bob', 'bob@example.com'), (3, 'Charlie', 'charlie@example.com')`, nil, 0, 5000)
	if err != nil {
		t.Fatalf("insert failed: %v", err)
	}
	return cm
}

func TestExecuteSelect(t *testing.T) {
	cm := setupTestDB(t)
	defer cm.CloseAll()

	result, err := Execute(cm, "test", "SELECT id, name FROM users ORDER BY id", nil, 100, 5000)
	if err != nil {
		t.Fatalf("execute failed: %v", err)
	}

	if len(result.Columns) != 2 {
		t.Errorf("expected 2 columns, got %d", len(result.Columns))
	}
	if result.Columns[0] != "id" || result.Columns[1] != "name" {
		t.Errorf("unexpected columns: %v", result.Columns)
	}
	if result.RowCount != 3 {
		t.Errorf("expected 3 rows, got %d", result.RowCount)
	}
	if result.HasMore {
		t.Error("should not have more rows")
	}
}

func TestExecuteWithParams(t *testing.T) {
	cm := setupTestDB(t)
	defer cm.CloseAll()

	result, err := Execute(cm, "test", "SELECT name FROM users WHERE id = ?", []interface{}{2}, 100, 5000)
	if err != nil {
		t.Fatalf("execute failed: %v", err)
	}

	if result.RowCount != 1 {
		t.Errorf("expected 1 row, got %d", result.RowCount)
	}
	if result.Rows[0][0] != "Bob" {
		t.Errorf("expected 'Bob', got '%v'", result.Rows[0][0])
	}
}

func TestExecuteWithRowLimit(t *testing.T) {
	cm := setupTestDB(t)
	defer cm.CloseAll()

	result, err := Execute(cm, "test", "SELECT * FROM users ORDER BY id", nil, 2, 5000)
	if err != nil {
		t.Fatalf("execute failed: %v", err)
	}

	if result.RowCount != 2 {
		t.Errorf("expected 2 rows (capped), got %d", result.RowCount)
	}
	if !result.HasMore {
		t.Error("should indicate more rows available")
	}
}

func TestExecuteUnknownConnection(t *testing.T) {
	cm := NewConnectionManager()
	_, err := Execute(cm, "nonexistent", "SELECT 1", nil, 100, 5000)
	if err == nil {
		t.Error("expected error for unknown connection")
	}
}

func TestExecuteSQLError(t *testing.T) {
	cm := setupTestDB(t)
	defer cm.CloseAll()

	_, err := Execute(cm, "test", "SELECT * FROM nonexistent_table", nil, 100, 5000)
	if err == nil {
		t.Error("expected error for bad SQL")
	}
}

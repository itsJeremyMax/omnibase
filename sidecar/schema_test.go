package main

import (
	"testing"
)

func setupSchemaTestDB(t *testing.T) *ConnectionManager {
	t.Helper()
	cm := NewConnectionManager()
	if err := cm.Connect("test", "sq::memory:"); err != nil {
		t.Fatalf("setup failed: %v", err)
	}

	// Use Execute to set up schema (same as MCP server would)
	stmts := []string{
		`CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT NOT NULL, email TEXT UNIQUE)`,
		`CREATE TABLE posts (id INTEGER PRIMARY KEY, user_id INTEGER REFERENCES users(id), title TEXT NOT NULL, body TEXT)`,
		`CREATE INDEX idx_posts_user_id ON posts(user_id)`,
	}
	for _, stmt := range stmts {
		if _, err := Execute(cm, "test", stmt, nil, 0, 5000); err != nil {
			t.Fatalf("schema setup failed: %v", err)
		}
	}
	return cm
}

func TestGetSchemaAllTables(t *testing.T) {
	cm := setupSchemaTestDB(t)
	defer cm.CloseAll()

	result, err := GetSchema(cm, "test", nil, nil, true)
	if err != nil {
		t.Fatalf("get schema failed: %v", err)
	}

	if len(result.Tables) < 2 {
		t.Fatalf("expected at least 2 tables, got %d", len(result.Tables))
	}

	// Find users table
	var usersTable *TableInfo
	for i := range result.Tables {
		if result.Tables[i].Name == "users" {
			usersTable = &result.Tables[i]
			break
		}
	}
	if usersTable == nil {
		t.Fatal("users table not found")
	}

	if len(usersTable.Columns) != 3 {
		t.Errorf("expected 3 columns in users, got %d", len(usersTable.Columns))
	}
}

func TestGetSchemaFilteredTables(t *testing.T) {
	cm := setupSchemaTestDB(t)
	defer cm.CloseAll()

	result, err := GetSchema(cm, "test", nil, []string{"posts"}, true)
	if err != nil {
		t.Fatalf("get schema failed: %v", err)
	}

	if len(result.Tables) != 1 {
		t.Fatalf("expected 1 table, got %d", len(result.Tables))
	}
	if result.Tables[0].Name != "posts" {
		t.Errorf("expected 'posts', got '%s'", result.Tables[0].Name)
	}
}

func TestGetSchemaColumns(t *testing.T) {
	cm := setupSchemaTestDB(t)
	defer cm.CloseAll()

	result, err := GetSchema(cm, "test", nil, []string{"users"}, true)
	if err != nil {
		t.Fatalf("get schema failed: %v", err)
	}

	table := result.Tables[0]
	// Check that id column exists
	var idCol *ColumnInfo
	for i := range table.Columns {
		if table.Columns[i].Name == "id" {
			idCol = &table.Columns[i]
			break
		}
	}
	if idCol == nil {
		t.Fatal("id column not found")
	}
}

func TestGetSchemaExactCounts(t *testing.T) {
	cm := setupSchemaTestDB(t)
	defer cm.CloseAll()

	// Insert some rows
	Execute(cm, "test", `INSERT INTO users (name, email) VALUES ('alice', 'alice@test.com')`, nil, 0, 5000)
	Execute(cm, "test", `INSERT INTO users (name, email) VALUES ('bob', 'bob@test.com')`, nil, 0, 5000)

	// With exact_counts=true, should get accurate COUNT(*)
	result, err := GetSchema(cm, "test", nil, []string{"users"}, true)
	if err != nil {
		t.Fatalf("get schema failed: %v", err)
	}
	table := result.Tables[0]
	if table.RowCountEstimate != 2 {
		t.Errorf("expected exact count of 2, got %d", table.RowCountEstimate)
	}
	if !table.ExactCount {
		t.Error("expected ExactCount to be true")
	}

	// With exact_counts=false, should use catalog estimate and mark as not exact
	result2, err := GetSchema(cm, "test", nil, []string{"users"}, false)
	if err != nil {
		t.Fatalf("get schema failed: %v", err)
	}
	table2 := result2.Tables[0]
	if table2.ExactCount {
		t.Error("expected ExactCount to be false")
	}
}

func TestGetSchemaUnknownConnection(t *testing.T) {
	cm := NewConnectionManager()
	_, err := GetSchema(cm, "nonexistent", nil, nil, true)
	if err == nil {
		t.Error("expected error for unknown connection")
	}
}

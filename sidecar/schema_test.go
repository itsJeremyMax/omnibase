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

	result, err := GetSchema(cm, "test", nil, nil)
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

	result, err := GetSchema(cm, "test", nil, []string{"posts"})
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

	result, err := GetSchema(cm, "test", nil, []string{"users"})
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

func TestGetSchemaUnknownConnection(t *testing.T) {
	cm := NewConnectionManager()
	_, err := GetSchema(cm, "nonexistent", nil, nil)
	if err == nil {
		t.Error("expected error for unknown connection")
	}
}

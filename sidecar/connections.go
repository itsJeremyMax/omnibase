package main

import (
	"context"
	"database/sql"
	"fmt"
	"io"
	"sync"

	"github.com/xo/dburl"
	"github.com/xo/usql/drivers"
	"github.com/xo/usql/drivers/metadata"
)

// Connection holds a database connection and its usql metadata reader.
type Connection struct {
	DB     *sql.DB
	URL    *dburl.URL
	Reader metadata.Reader
}

// ConnectionManager manages named database connections via usql/dburl.
type ConnectionManager struct {
	mu    sync.RWMutex
	conns map[string]*Connection
}

// NewConnectionManager creates a new ConnectionManager.
func NewConnectionManager() *ConnectionManager {
	return &ConnectionManager{
		conns: make(map[string]*Connection),
	}
}

// Connect opens a database connection using dburl (usql's DSN parser).
// Supports all usql-compatible DSN formats.
func (cm *ConnectionManager) Connect(id, dsn string) error {
	cm.mu.Lock()
	defer cm.mu.Unlock()

	// Close existing connection if any
	if existing, ok := cm.conns[id]; ok {
		existing.DB.Close()
		delete(cm.conns, id)
	}

	// Parse the DSN using dburl
	u, err := dburl.Parse(dsn)
	if err != nil {
		return fmt.Errorf("failed to parse DSN: %w", err)
	}

	// Open using usql's driver system (handles ForceParams, etc.)
	noop := func() io.Writer { return io.Discard }
	db, err := drivers.Open(context.Background(), u, noop, noop)
	if err != nil {
		return fmt.Errorf("failed to open: %w", err)
	}

	// Verify the connection works
	if err := db.Ping(); err != nil {
		db.Close()
		return fmt.Errorf("failed to ping: %w", err)
	}

	// Enable foreign key enforcement for SQLite to match the default behavior
	// of Postgres and MySQL. SQLite is the only major database that has FKs
	// disabled by default — this makes behavior consistent across all databases.
	if u.UnaliasedDriver == "sqlite3" || u.Driver == "sqlite3" {
		db.Exec("PRAGMA foreign_keys = ON")
	}

	// Get the usql metadata reader for schema introspection
	var reader metadata.Reader
	reader, _ = drivers.NewMetadataReader(context.Background(), u, db, nil)

	cm.conns[id] = &Connection{
		DB:     db,
		URL:    u,
		Reader: reader,
	}
	return nil
}

// Get returns the connection for the given ID.
func (cm *ConnectionManager) Get(id string) (*Connection, error) {
	cm.mu.RLock()
	defer cm.mu.RUnlock()

	conn, ok := cm.conns[id]
	if !ok {
		return nil, fmt.Errorf("connection '%s' not found", id)
	}
	return conn, nil
}

// Ping checks if a connection is alive.
func (cm *ConnectionManager) Ping(id string) error {
	conn, err := cm.Get(id)
	if err != nil {
		return err
	}
	return conn.DB.Ping()
}

// Disconnect closes and removes a connection.
func (cm *ConnectionManager) Disconnect(id string) error {
	cm.mu.Lock()
	defer cm.mu.Unlock()

	conn, ok := cm.conns[id]
	if !ok {
		return fmt.Errorf("connection '%s' not found", id)
	}
	err := conn.DB.Close()
	delete(cm.conns, id)
	return err
}

// IsConnected checks if a connection exists.
func (cm *ConnectionManager) IsConnected(id string) bool {
	cm.mu.RLock()
	defer cm.mu.RUnlock()
	_, ok := cm.conns[id]
	return ok
}

// CloseAll closes all connections.
func (cm *ConnectionManager) CloseAll() {
	cm.mu.Lock()
	defer cm.mu.Unlock()
	for id, conn := range cm.conns {
		conn.DB.Close()
		delete(cm.conns, id)
	}
}

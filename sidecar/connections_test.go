package main

import (
	"testing"
)

func TestConnectSQLite(t *testing.T) {
	cm := NewConnectionManager()
	defer cm.CloseAll()

	err := cm.Connect("test", "sq::memory:")
	if err != nil {
		t.Fatalf("failed to connect: %v", err)
	}

	if !cm.IsConnected("test") {
		t.Error("expected connection to be tracked")
	}
}

func TestConnectDuplicate(t *testing.T) {
	cm := NewConnectionManager()
	defer cm.CloseAll()

	err := cm.Connect("test", "sq::memory:")
	if err != nil {
		t.Fatalf("first connect failed: %v", err)
	}

	// Second connect with same ID should close old and reconnect
	err = cm.Connect("test", "sq::memory:")
	if err != nil {
		t.Fatalf("reconnect failed: %v", err)
	}
}

func TestPingSQLite(t *testing.T) {
	cm := NewConnectionManager()
	defer cm.CloseAll()

	cm.Connect("test", "sq::memory:")
	err := cm.Ping("test")
	if err != nil {
		t.Fatalf("ping failed: %v", err)
	}
}

func TestPingUnknown(t *testing.T) {
	cm := NewConnectionManager()
	err := cm.Ping("nonexistent")
	if err == nil {
		t.Error("expected error for unknown connection")
	}
}

func TestDisconnect(t *testing.T) {
	cm := NewConnectionManager()

	cm.Connect("test", "sq::memory:")
	err := cm.Disconnect("test")
	if err != nil {
		t.Fatalf("disconnect failed: %v", err)
	}

	if cm.IsConnected("test") {
		t.Error("expected connection to be removed after disconnect")
	}
}

func TestDisconnectUnknown(t *testing.T) {
	cm := NewConnectionManager()
	err := cm.Disconnect("nonexistent")
	if err == nil {
		t.Error("expected error for unknown connection")
	}
}

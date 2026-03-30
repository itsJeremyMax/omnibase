package main

import "encoding/json"

// RPCRequest is a JSON-RPC 2.0 request from the MCP server.
type RPCRequest struct {
	JSONRPC string    `json:"jsonrpc"`
	ID      int       `json:"id"`
	Method  string    `json:"method"`
	Params  RPCParams `json:"params"`
}

// RPCParams holds all possible request parameters.
// Only the fields relevant to the method are populated.
type RPCParams struct {
	// Common
	ID string `json:"id"`

	// Connect
	DSN string `json:"dsn,omitempty"`

	// Execute
	Query       string        `json:"query,omitempty"`
	QueryParams []interface{} `json:"params,omitempty"`
	MaxRows     int           `json:"max_rows,omitempty"`
	TimeoutMs   int           `json:"timeout_ms,omitempty"`

	// Schema
	Schemas     []string `json:"schemas,omitempty"`
	Tables      []string `json:"tables,omitempty"`
	ExactCounts *bool    `json:"exact_counts,omitempty"`
}

// RPCResponse is a JSON-RPC 2.0 response to the MCP server.
type RPCResponse struct {
	JSONRPC string      `json:"jsonrpc"`
	ID      int         `json:"id"`
	Result  interface{} `json:"result,omitempty"`
	Error   *RPCError   `json:"error,omitempty"`
}

// RPCError is a structured error in a JSON-RPC response.
type RPCError struct {
	Code    string `json:"code"`
	Message string `json:"message"`
	Detail  string `json:"detail,omitempty"`
}

// ExecuteResult is the result of an execute request.
type ExecuteResult struct {
	Columns      []string        `json:"columns"`
	Rows         [][]interface{} `json:"rows"`
	RowCount     int             `json:"row_count"`
	HasMore      bool            `json:"has_more"`
	AffectedRows *int64          `json:"affected_rows,omitempty"`
	LastInsertID *int64          `json:"last_insert_id,omitempty"`
}

// SchemaResult is the result of a schema request.
type SchemaResult struct {
	Tables []TableInfo `json:"tables"`
}

type TableInfo struct {
	Name             string       `json:"name"`
	Schema           string       `json:"schema"`
	Columns          []ColumnInfo `json:"columns"`
	PrimaryKey       []string     `json:"primary_key"`
	Indexes          []IndexInfo  `json:"indexes"`
	ForeignKeys      []ForeignKey `json:"foreign_keys"`
	RowCountEstimate int64        `json:"row_count_estimate"`
	ExactCount       bool         `json:"exact_count"`
	Comment          *string      `json:"comment"`
}

type ColumnInfo struct {
	Name         string  `json:"name"`
	Type         string  `json:"type"`
	Nullable     bool    `json:"nullable"`
	DefaultValue *string `json:"default_value"`
	IsPrimaryKey bool    `json:"is_primary_key"`
	Comment      *string `json:"comment"`
}

type IndexInfo struct {
	Name    string   `json:"name"`
	Columns []string `json:"columns"`
	Unique  bool     `json:"unique"`
}

type ForeignKey struct {
	Column           string `json:"column"`
	ReferencesTable  string `json:"references_table"`
	ReferencesColumn string `json:"references_column"`
}

// ConnectResult is the result of a connect request.
type ConnectResult struct {
	OK bool `json:"ok"`
}

// PingResult is the result of a ping request.
type PingResult struct {
	OK bool `json:"ok"`
}

// DisconnectResult is the result of a disconnect request.
type DisconnectResult struct {
	OK bool `json:"ok"`
}

// ValidateResult is the result of a validate request.
type ValidateResult struct {
	Valid bool   `json:"valid"`
	Error string `json:"error,omitempty"`
}

// MakeSuccess creates a success response.
func MakeSuccess(id int, result interface{}) RPCResponse {
	return RPCResponse{JSONRPC: "2.0", ID: id, Result: result}
}

// MakeError creates an error response.
func MakeError(id int, code, message string, detail string) RPCResponse {
	return RPCResponse{
		JSONRPC: "2.0",
		ID:      id,
		Error:   &RPCError{Code: code, Message: message, Detail: detail},
	}
}

// ReadRequest reads a JSON-RPC request from raw bytes.
func ReadRequest(data []byte) (RPCRequest, error) {
	var req RPCRequest
	err := json.Unmarshal(data, &req)
	return req, err
}

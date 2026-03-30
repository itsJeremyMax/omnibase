package main

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"strings"

	// Import usql drivers — each import registers the driver with database/sql
	// and provides metadata readers for schema introspection.
	_ "github.com/xo/usql/drivers/mysql"
	_ "github.com/xo/usql/drivers/postgres"
	_ "github.com/xo/usql/drivers/sqlite3"
	_ "github.com/xo/usql/drivers/sqlserver"
)

func main() {
	fmt.Fprintln(os.Stderr, "omnibase-sidecar starting...")

	cm := NewConnectionManager()
	defer cm.CloseAll()

	scanner := bufio.NewScanner(os.Stdin)
	// Allow large messages (16MB)
	scanner.Buffer(make([]byte, 0, 16*1024*1024), 16*1024*1024)

	for scanner.Scan() {
		line := scanner.Text()
		if strings.TrimSpace(line) == "" {
			continue
		}

		req, err := ReadRequest([]byte(line))
		if err != nil {
			resp := MakeError(0, "PARSE_ERROR", "invalid JSON-RPC request", err.Error())
			writeResponse(resp)
			continue
		}

		resp := handleRequest(cm, req)
		writeResponse(resp)
	}

	if err := scanner.Err(); err != nil {
		fmt.Fprintf(os.Stderr, "stdin read error: %v\n", err)
		os.Exit(1)
	}
}

func handleRequest(cm *ConnectionManager, req RPCRequest) RPCResponse {
	switch req.Method {
	case "connect":
		return handleConnect(cm, req)
	case "execute":
		return handleExecute(cm, req)
	case "schema":
		return handleSchema(cm, req)
	case "explain":
		return handleExplain(cm, req)
	case "validate":
		return handleValidate(cm, req)
	case "ping":
		return handlePing(cm, req)
	case "disconnect":
		return handleDisconnect(cm, req)
	default:
		return MakeError(req.ID, "METHOD_NOT_FOUND", fmt.Sprintf("unknown method: %s", req.Method), "")
	}
}

func handleConnect(cm *ConnectionManager, req RPCRequest) RPCResponse {
	id := req.Params.ID
	dsn := req.Params.DSN

	if id == "" || dsn == "" {
		return MakeError(req.ID, "INVALID_PARAMS", "id and dsn are required", "")
	}

	// ConnectionManager.Connect uses dburl.Parse to handle all DSN formats
	if err := cm.Connect(id, dsn); err != nil {
		return MakeError(req.ID, "CONNECTION_ERROR", fmt.Sprintf("failed to connect '%s'", id), err.Error())
	}

	return MakeSuccess(req.ID, ConnectResult{OK: true})
}

func handleExecute(cm *ConnectionManager, req RPCRequest) RPCResponse {
	maxRows := req.Params.MaxRows
	if maxRows <= 0 {
		maxRows = 500
	}
	timeoutMs := req.Params.TimeoutMs
	if timeoutMs <= 0 {
		timeoutMs = 30000
	}

	result, err := Execute(cm, req.Params.ID, req.Params.Query, req.Params.QueryParams, maxRows, timeoutMs)
	if err != nil {
		return MakeError(req.ID, "QUERY_ERROR", err.Error(), "")
	}

	return MakeSuccess(req.ID, result)
}

func handleSchema(cm *ConnectionManager, req RPCRequest) RPCResponse {
	exactCounts := req.Params.ExactCounts == nil || *req.Params.ExactCounts
	result, err := GetSchema(cm, req.Params.ID, req.Params.Schemas, req.Params.Tables, exactCounts)
	if err != nil {
		return MakeError(req.ID, "SCHEMA_ERROR", err.Error(), "")
	}

	return MakeSuccess(req.ID, result)
}

func handleExplain(cm *ConnectionManager, req RPCRequest) RPCResponse {
	conn, err := cm.Get(req.Params.ID)
	if err != nil {
		return MakeError(req.ID, "CONNECTION_ERROR", err.Error(), "")
	}

	query := req.Params.Query
	if query == "" {
		return MakeError(req.ID, "INVALID_PARAMS", "query is required", "")
	}

	// Auto-translate placeholders
	if conn.URL != nil {
		style := getPlaceholderStyle(conn.URL.Driver)
		query = translatePlaceholders(query, style)
	}

	// SQL Server: use SET SHOWPLAN_TEXT ON, then run the query (which returns
	// the plan instead of executing), then SET SHOWPLAN_TEXT OFF.
	driver := ""
	if conn.URL != nil {
		driver = conn.URL.Driver
	}

	if driver == "sqlserver" || driver == "mssql" || driver == "azuresql" {
		// SQL Server requires SET SHOWPLAN_TEXT ON and the query to run on the
		// SAME connection. database/sql pools connections, so we must grab a
		// single conn and use it for all three statements.
		singleConn, err := conn.DB.Conn(context.Background())
		if err != nil {
			return MakeError(req.ID, "QUERY_ERROR", "failed to get connection: "+err.Error(), "")
		}
		defer singleConn.Close()

		if _, err := singleConn.ExecContext(context.Background(), "SET SHOWPLAN_TEXT ON"); err != nil {
			return MakeError(req.ID, "QUERY_ERROR", "failed to enable SHOWPLAN: "+err.Error(), "")
		}

		// With SHOWPLAN on, the query returns the plan text instead of executing
		rows, err := singleConn.QueryContext(context.Background(), query)
		var planResult *ExecuteResult
		if err != nil {
			singleConn.ExecContext(context.Background(), "SET SHOWPLAN_TEXT OFF")
			return MakeError(req.ID, "QUERY_ERROR", err.Error(), "")
		}

		// SQL Server SHOWPLAN returns multiple result sets:
		// 1st: the query text, 2nd+: the plan operators.
		// Read all result sets to capture the full plan.
		columns, _ := rows.Columns()
		var resultRows [][]interface{}
		for {
			for rows.Next() {
				cols, _ := rows.Columns()
				values := make([]interface{}, len(cols))
				scanDest := make([]interface{}, len(cols))
				for i := range values {
					scanDest[i] = &values[i]
				}
				if err := rows.Scan(scanDest...); err != nil {
					break
				}
				row := make([]interface{}, len(cols))
				for i, v := range values {
					if b, ok := v.([]byte); ok {
						row[i] = string(b)
					} else {
						row[i] = v
					}
				}
				resultRows = append(resultRows, row)
				// Use columns from the first result set that has data
				if len(columns) == 0 {
					columns = cols
				}
			}
			if !rows.NextResultSet() {
				break
			}
		}
		rows.Close()

		singleConn.ExecContext(context.Background(), "SET SHOWPLAN_TEXT OFF")

		planResult = &ExecuteResult{
			Columns:  columns,
			Rows:     resultRows,
			RowCount: len(resultRows),
			HasMore:  false,
		}
		return MakeSuccess(req.ID, planResult)
	}

	// Standard path: try EXPLAIN QUERY PLAN (SQLite), then EXPLAIN (Postgres, MySQL)
	result, err := Execute(cm, req.Params.ID, "EXPLAIN QUERY PLAN "+query, nil, 500, 30000)
	if err != nil {
		result, err = Execute(cm, req.Params.ID, "EXPLAIN "+query, nil, 500, 30000)
		if err != nil {
			return MakeError(req.ID, "QUERY_ERROR", err.Error(), "")
		}
	}
	return MakeSuccess(req.ID, result)
}

func handleValidate(cm *ConnectionManager, req RPCRequest) RPCResponse {
	conn, err := cm.Get(req.Params.ID)
	if err != nil {
		return MakeError(req.ID, "CONNECTION_ERROR", err.Error(), "")
	}

	query := req.Params.Query
	if query == "" {
		return MakeError(req.ID, "INVALID_PARAMS", "query is required", "")
	}

	// Auto-translate ? placeholders for Postgres-family drivers
	if conn.URL != nil {
		style := getPlaceholderStyle(conn.URL.Driver)
		query = translatePlaceholders(query, style)
	}

	// Use Prepare to ask the database to validate the query without executing it
	stmt, err := conn.DB.Prepare(query)
	if err != nil {
		return MakeSuccess(req.ID, ValidateResult{Valid: false, Error: err.Error()})
	}
	stmt.Close()

	return MakeSuccess(req.ID, ValidateResult{Valid: true})
}

func handlePing(cm *ConnectionManager, req RPCRequest) RPCResponse {
	if err := cm.Ping(req.Params.ID); err != nil {
		return MakeError(req.ID, "PING_ERROR", err.Error(), "")
	}
	return MakeSuccess(req.ID, PingResult{OK: true})
}

func handleDisconnect(cm *ConnectionManager, req RPCRequest) RPCResponse {
	if err := cm.Disconnect(req.Params.ID); err != nil {
		return MakeError(req.ID, "DISCONNECT_ERROR", err.Error(), "")
	}
	return MakeSuccess(req.ID, DisconnectResult{OK: true})
}

func writeResponse(resp RPCResponse) {
	data, err := json.Marshal(resp)
	if err != nil {
		fmt.Fprintf(os.Stderr, "failed to marshal response: %v\n", err)
		return
	}
	fmt.Println(string(data))
}

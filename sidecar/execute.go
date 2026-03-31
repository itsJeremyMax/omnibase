package main

import (
	"context"
	"fmt"
	"math"
	"strings"
	"time"
)

// Execute runs a parameterized query and returns structured results.
// For write operations (INSERT/UPDATE/DELETE), uses ExecContext to get affected rows.
func Execute(cm *ConnectionManager, id, query string, params []interface{}, maxRows, timeoutMs int) (*ExecuteResult, error) {
	conn, err := cm.Get(id)
	if err != nil {
		return nil, err
	}

	// Handle transaction control statements (BEGIN/COMMIT/ROLLBACK) directly
	if isTransactionControl(query) {
		ctx, cancel := context.WithTimeout(context.Background(), time.Duration(timeoutMs)*time.Millisecond)
		defer cancel()
		if _, err := conn.DB.ExecContext(ctx, query); err != nil {
			return nil, fmt.Errorf("transaction control failed: %w", err)
		}
		return &ExecuteResult{
			Columns:  []string{},
			Rows:     [][]interface{}{},
			RowCount: 0,
			HasMore:  false,
		}, nil
	}

	// Auto-translate ? placeholders to the driver's native style ($1, :1, @p1).
	// This makes parameterized queries work consistently across all databases —
	// agents can always use ? regardless of the target database.
	if conn.URL != nil {
		style := getPlaceholderStyle(conn.URL.Driver)
		query = translatePlaceholders(query, style)
	}

	ctx, cancel := context.WithTimeout(context.Background(), time.Duration(timeoutMs)*time.Millisecond)
	defer cancel()

	if isWriteQuery(query) && !hasReturningClause(query) {
		return executeWrite(ctx, conn, query, params)
	}

	return executeRead(ctx, conn, query, params, maxRows)
}

// placeholderStyle describes how a database expects parameterized query placeholders.
type placeholderStyle int

const (
	placeholderQuestion   placeholderStyle = iota // ? (MySQL, SQLite, etc.)
	placeholderDollar                             // $1, $2, ... (PostgreSQL)
	placeholderColon                              // :1, :2, ... (Oracle)
	placeholderAtP                                // @p1, @p2, ... (SQL Server)
)

// getPlaceholderStyle returns the placeholder style for a driver.
// Based on the actual Go SQL drivers' requirements.
func getPlaceholderStyle(driver string) placeholderStyle {
	switch driver {
	case "postgres", "pgx", "cockroachdb", "redshift":
		return placeholderDollar
	case "godror", "oracle", "oci8":
		return placeholderColon
	case "sqlserver", "mssql", "azuresql":
		return placeholderAtP
	default:
		return placeholderQuestion
	}
}

// translatePlaceholders converts ? to the target driver's placeholder style,
// preserving ? inside string literals (single-quoted).
func translatePlaceholders(query string, style placeholderStyle) string {
	if style == placeholderQuestion {
		return query
	}
	if !strings.Contains(query, "?") {
		return query
	}

	var result strings.Builder
	result.Grow(len(query) + 20)
	inString := false
	paramIdx := 0

	for i := 0; i < len(query); i++ {
		ch := query[i]
		if ch == '\'' {
			inString = !inString
			result.WriteByte(ch)
		} else if ch == '?' && !inString {
			// Distinguish parameter placeholder ? from jsonb/hstore operator ?
			//
			// Operator forms: ?| ?& ?? (followed by |, &, or ?)
			// Standalone operator: expr ? 'key' (preceded by identifier, ), ', ])
			// Parameter placeholder: = ?, (?, ,? (preceded by =, <, >, (, ,, or start)
			//
			nextCh := byte(0)
			if i+1 < len(query) {
				nextCh = query[i+1]
			}

			isOperator := false
			// ?|, ?&, ?? are always operators
			if nextCh == '|' || nextCh == '&' || nextCh == '?' {
				isOperator = true
			} else {
				// Check preceding non-whitespace character to determine context
				prevCh := prevNonWhitespace(query, i)
				// If preceded by an identifier char, ), ', or ] — it's an operator
				// If preceded by =, <, >, (, ,, or nothing — it's a placeholder
				if isIdentChar(prevCh) || prevCh == ')' || prevCh == '\'' || prevCh == ']' {
					isOperator = true
				}
			}

			if isOperator {
				result.WriteByte(ch)
			} else {
				paramIdx++
				switch style {
				case placeholderDollar:
					result.WriteString(fmt.Sprintf("$%d", paramIdx))
				case placeholderColon:
					result.WriteString(fmt.Sprintf(":%d", paramIdx))
				case placeholderAtP:
					result.WriteString(fmt.Sprintf("@p%d", paramIdx))
				}
			}
		} else {
			result.WriteByte(ch)
		}
	}

	return result.String()
}

// prevNonWhitespace returns the character before index i, skipping whitespace.
// Returns 0 if at the start of the string.
func prevNonWhitespace(s string, i int) byte {
	for j := i - 1; j >= 0; j-- {
		if s[j] != ' ' && s[j] != '\t' && s[j] != '\n' && s[j] != '\r' {
			return s[j]
		}
	}
	return 0
}

// isIdentChar returns true for characters that can appear in SQL identifiers.
func isIdentChar(ch byte) bool {
	return (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') ||
		(ch >= '0' && ch <= '9') || ch == '_'
}

// isWriteQuery checks if a query is a write operation by looking at the first keyword.
func isWriteQuery(query string) bool {
	trimmed := strings.TrimSpace(query)
	for strings.HasPrefix(trimmed, "--") {
		if idx := strings.Index(trimmed, "\n"); idx >= 0 {
			trimmed = strings.TrimSpace(trimmed[idx+1:])
		} else {
			break
		}
	}
	upper := strings.ToUpper(trimmed)
	return strings.HasPrefix(upper, "INSERT") ||
		strings.HasPrefix(upper, "REPLACE") ||
		strings.HasPrefix(upper, "UPDATE") ||
		strings.HasPrefix(upper, "DELETE") ||
		strings.HasPrefix(upper, "CREATE") ||
		strings.HasPrefix(upper, "ALTER") ||
		strings.HasPrefix(upper, "DROP") ||
		strings.HasPrefix(upper, "TRUNCATE")
}

// hasReturningClause checks if a write query includes a RETURNING clause,
// which means it returns rows and should use QueryContext instead of ExecContext.
func hasReturningClause(query string) bool {
	upper := strings.ToUpper(query)
	return strings.Contains(upper, " RETURNING ")
}

func executeWrite(ctx context.Context, conn *Connection, query string, params []interface{}) (*ExecuteResult, error) {
	sqlResult, err := conn.DB.ExecContext(ctx, query, params...)
	if err != nil {
		return nil, fmt.Errorf("query failed: %w", err)
	}

	result := &ExecuteResult{
		Columns:  []string{},
		Rows:     [][]interface{}{},
		RowCount: 0,
		HasMore:  false,
	}

	if affected, err := sqlResult.RowsAffected(); err == nil {
		result.AffectedRows = &affected
	}

	// Only include last_insert_id for INSERT statements — other write ops
	// carry over the stale value from the last INSERT, which is confusing.
	upper := strings.ToUpper(strings.TrimSpace(query))
	if strings.HasPrefix(upper, "INSERT") || strings.HasPrefix(upper, "REPLACE") {
		if lastID, err := sqlResult.LastInsertId(); err == nil && lastID > 0 {
			result.LastInsertID = &lastID
		}
	}

	return result, nil
}

func executeRead(ctx context.Context, conn *Connection, query string, params []interface{}, maxRows int) (*ExecuteResult, error) {
	rows, err := conn.DB.QueryContext(ctx, query, params...)
	if err != nil {
		return nil, fmt.Errorf("query failed: %w", err)
	}
	defer rows.Close()

	columns, err := rows.Columns()
	if err != nil {
		return nil, fmt.Errorf("failed to get columns: %w", err)
	}

	var resultRows [][]interface{}
	hasMore := false

	for rows.Next() {
		if len(resultRows) >= maxRows {
			hasMore = true
			break
		}

		values := make([]interface{}, len(columns))
		scanDest := make([]interface{}, len(columns))
		for i := range values {
			scanDest[i] = &values[i]
		}

		if err := rows.Scan(scanDest...); err != nil {
			return nil, fmt.Errorf("scan failed: %w", err)
		}

		row := make([]interface{}, len(columns))
		for i, v := range values {
			if b, ok := v.([]byte); ok {
				row[i] = string(b)
			} else if f, ok := v.(float64); ok && (math.IsInf(f, 0) || math.IsNaN(f)) {
				// JSON cannot represent Inf or NaN — convert to string
				if math.IsInf(f, 1) {
					row[i] = "Infinity"
				} else if math.IsInf(f, -1) {
					row[i] = "-Infinity"
				} else {
					row[i] = "NaN"
				}
			} else {
				row[i] = v
			}
		}
		resultRows = append(resultRows, row)
	}

	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("row iteration error: %w", err)
	}

	return &ExecuteResult{
		Columns:  columns,
		Rows:     resultRows,
		RowCount: len(resultRows),
		HasMore:  hasMore,
	}, nil
}

// isTransactionControl returns true for BEGIN, COMMIT, and ROLLBACK statements.
func isTransactionControl(query string) bool {
	trimmed := strings.TrimSpace(query)
	upper := strings.ToUpper(trimmed)
	return upper == "BEGIN" || upper == "COMMIT" || upper == "ROLLBACK" ||
		strings.HasPrefix(upper, "BEGIN ") ||
		strings.HasPrefix(upper, "COMMIT ") ||
		strings.HasPrefix(upper, "ROLLBACK ")
}

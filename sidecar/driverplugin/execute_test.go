package driverplugin

import (
	"testing"
)

func TestTranslatePlaceholders_Dollar(t *testing.T) {
	tests := []struct {
		name   string
		query  string
		expect string
	}{
		{"simple parameter", "SELECT * FROM t WHERE id = ?", "SELECT * FROM t WHERE id = $1"},
		{"multiple parameters", "SELECT * FROM t WHERE id = ? AND name = ?", "SELECT * FROM t WHERE id = $1 AND name = $2"},
		{"parameter after comma", "INSERT INTO t VALUES (?, ?)", "INSERT INTO t VALUES ($1, $2)"},
		{"parameter after open paren", "WHERE id IN (?)", "WHERE id IN ($1)"},
		{"parameter after comparison", "WHERE x > ? AND y < ?", "WHERE x > $1 AND y < $2"},
		{"no placeholders", "SELECT 1", "SELECT 1"},
		{"string literal preserved", "SELECT * FROM t WHERE name = '?'", "SELECT * FROM t WHERE name = '?'"},
		{"mixed string and param", "SELECT * FROM t WHERE name = '?' AND id = ?", "SELECT * FROM t WHERE name = '?' AND id = $1"},
		{"parameter at query start", "? ", "$1 "},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := translatePlaceholders(tt.query, placeholderDollar)
			if got != tt.expect {
				t.Errorf("translatePlaceholders(%q, dollar) = %q, want %q", tt.query, got, tt.expect)
			}
		})
	}
}

func TestTranslatePlaceholders_Colon(t *testing.T) {
	got := translatePlaceholders("SELECT * FROM t WHERE id = ? AND name = ?", placeholderColon)
	expect := "SELECT * FROM t WHERE id = :1 AND name = :2"
	if got != expect {
		t.Errorf("got %q, want %q", got, expect)
	}
}

func TestTranslatePlaceholders_AtP(t *testing.T) {
	got := translatePlaceholders("SELECT * FROM t WHERE id = ? AND name = ?", placeholderAtP)
	expect := "SELECT * FROM t WHERE id = @p1 AND name = @p2"
	if got != expect {
		t.Errorf("got %q, want %q", got, expect)
	}
}

func TestTranslatePlaceholders_QuestionNoop(t *testing.T) {
	query := "SELECT * FROM t WHERE id = ?"
	got := translatePlaceholders(query, placeholderQuestion)
	if got != query {
		t.Errorf("question style should be noop, got %q", got)
	}
}

func TestTranslatePlaceholders_JsonbOperators(t *testing.T) {
	tests := []struct {
		name   string
		query  string
		expect string
	}{
		{"?| operator", "SELECT * FROM t WHERE col ?| ARRAY['a']", "SELECT * FROM t WHERE col ?| ARRAY['a']"},
		{"?& operator", "SELECT * FROM t WHERE col ?& ARRAY['a']", "SELECT * FROM t WHERE col ?& ARRAY['a']"},
		{"?? operator", "SELECT * FROM t WHERE col ?? 'key'", "SELECT * FROM t WHERE col ?? 'key'"},
		{"standalone ? after identifier", "SELECT data ? 'key' FROM t", "SELECT data ? 'key' FROM t"},
		{"standalone ? after close paren", "SELECT (data) ? 'key' FROM t", "SELECT (data) ? 'key' FROM t"},
		{"standalone ? after bracket", "SELECT arr[0] ? 'key' FROM t", "SELECT arr[0] ? 'key' FROM t"},
		{
			"mixed jsonb and param",
			"SELECT * FROM t WHERE data ? 'key' AND id = ?",
			"SELECT * FROM t WHERE data ? 'key' AND id = $1",
		},
		{
			"jsonb operator with param after",
			"SELECT * FROM t WHERE col ?| ARRAY['a'] AND id = ?",
			"SELECT * FROM t WHERE col ?| ARRAY['a'] AND id = $1",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := translatePlaceholders(tt.query, placeholderDollar)
			if got != tt.expect {
				t.Errorf("translatePlaceholders(%q, dollar) = %q, want %q", tt.query, got, tt.expect)
			}
		})
	}
}

func TestPrevNonWhitespace(t *testing.T) {
	tests := []struct {
		name   string
		s      string
		i      int
		expect byte
	}{
		{"immediate char", "ab", 1, 'a'},
		{"skip spaces", "a   b", 4, 'a'},
		{"skip tabs", "a\t\tb", 3, 'a'},
		{"at start", "b", 0, 0},
		{"all whitespace", "   b", 3, 0},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := prevNonWhitespace(tt.s, tt.i)
			if got != tt.expect {
				t.Errorf("prevNonWhitespace(%q, %d) = %q, want %q", tt.s, tt.i, got, tt.expect)
			}
		})
	}
}

func TestIsIdentChar(t *testing.T) {
	for _, ch := range []byte("azAZ09_") {
		if !isIdentChar(ch) {
			t.Errorf("isIdentChar(%q) should be true", ch)
		}
	}
	for _, ch := range []byte(" =<>(),;") {
		if isIdentChar(ch) {
			t.Errorf("isIdentChar(%q) should be false", ch)
		}
	}
	if isIdentChar(0) {
		t.Error("isIdentChar(0) should be false")
	}
}

func TestGetPlaceholderStyle(t *testing.T) {
	tests := []struct {
		driver string
		expect placeholderStyle
	}{
		{"postgres", placeholderDollar},
		{"pgx", placeholderDollar},
		{"cockroachdb", placeholderDollar},
		{"redshift", placeholderDollar},
		{"godror", placeholderColon},
		{"oracle", placeholderColon},
		{"oci8", placeholderColon},
		{"sqlserver", placeholderAtP},
		{"mssql", placeholderAtP},
		{"azuresql", placeholderAtP},
		{"mysql", placeholderQuestion},
		{"sqlite3", placeholderQuestion},
		{"unknown", placeholderQuestion},
	}
	for _, tt := range tests {
		t.Run(tt.driver, func(t *testing.T) {
			got := getPlaceholderStyle(tt.driver)
			if got != tt.expect {
				t.Errorf("getPlaceholderStyle(%q) = %d, want %d", tt.driver, got, tt.expect)
			}
		})
	}
}

func TestIsWriteQuery(t *testing.T) {
	tests := []struct {
		query  string
		expect bool
	}{
		{"INSERT INTO t VALUES (1)", true},
		{"insert into t values (1)", true},
		{"  INSERT INTO t VALUES (1)", true},
		{"REPLACE INTO t VALUES (1)", true},
		{"UPDATE t SET x = 1", true},
		{"DELETE FROM t", true},
		{"CREATE TABLE t (id INT)", true},
		{"ALTER TABLE t ADD col INT", true},
		{"DROP TABLE t", true},
		{"TRUNCATE TABLE t", true},
		{"SELECT 1", false},
		{"  SELECT 1", false},
		{"WITH cte AS (SELECT 1) SELECT * FROM cte", false},
		// Comment stripping
		{"-- comment\nINSERT INTO t VALUES (1)", true},
		{"-- comment\nSELECT 1", false},
		{"-- one\n-- two\nDELETE FROM t", true},
		// Comment-only query (no newline, hits else/break)
		{"-- just a comment", false},
	}

	for _, tt := range tests {
		t.Run(tt.query, func(t *testing.T) {
			got := isWriteQuery(tt.query)
			if got != tt.expect {
				t.Errorf("isWriteQuery(%q) = %v, want %v", tt.query, got, tt.expect)
			}
		})
	}
}

func TestHasReturningClause(t *testing.T) {
	tests := []struct {
		query  string
		expect bool
	}{
		{"INSERT INTO t (col) VALUES (1) RETURNING id", true},
		{"UPDATE t SET col = 1 RETURNING id", true},
		{"DELETE FROM t WHERE id = 1 RETURNING id", true},
		{"INSERT INTO t (col) VALUES (1) returning id", true},
		{"INSERT INTO t (col) VALUES (1)", false},
		{"SELECT * FROM t", false},
	}

	for _, tt := range tests {
		t.Run(tt.query, func(t *testing.T) {
			got := hasReturningClause(tt.query)
			if got != tt.expect {
				t.Errorf("hasReturningClause(%q) = %v, want %v", tt.query, got, tt.expect)
			}
		})
	}
}

func TestIsTransactionControl(t *testing.T) {
	tests := []struct {
		query  string
		expect bool
	}{
		{"BEGIN", true},
		{"COMMIT", true},
		{"ROLLBACK", true},
		{"begin", true},
		{"commit", true},
		{"rollback", true},
		{"  BEGIN  ", true},
		{"BEGIN TRANSACTION", true},
		{"COMMIT WORK", true},
		{"ROLLBACK WORK", true},
		{"SELECT 1", false},
		{"INSERT INTO t VALUES (1)", false},
		// Must not match prefixes that aren't transaction control
		{"BEGINNING", false},
		{"COMMITTED", false},
	}

	for _, tt := range tests {
		t.Run(tt.query, func(t *testing.T) {
			got := isTransactionControl(tt.query)
			if got != tt.expect {
				t.Errorf("isTransactionControl(%q) = %v, want %v", tt.query, got, tt.expect)
			}
		})
	}
}

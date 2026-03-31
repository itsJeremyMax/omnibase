package driverplugin

import (
	"fmt"
	"sort"
	"strings"

	"github.com/xo/usql/drivers/metadata"
)

// GetSchema introspects database schema using usql's metadata reader.
// Works across all databases that usql supports. Supplements metadata reader
// output with direct queries for row counts and other data the reader omits.
func GetSchema(cm *ConnectionManager, id string, schemas []string, tables []string, exactCounts bool) (*SchemaResult, error) {
	conn, err := cm.Get(id)
	if err != nil {
		return nil, err
	}

	if conn.Reader == nil {
		return nil, fmt.Errorf("schema introspection not supported for this database driver")
	}

	reader := conn.Reader

	// Check that the reader supports table listing
	tableReader, ok := reader.(metadata.TableReader)
	if !ok {
		return nil, fmt.Errorf("table listing not supported for this database driver")
	}

	// Get tables — include both "TABLE" and "BASE TABLE" for cross-database compatibility.
	tableFilter := metadata.Filter{
		Types: []string{"TABLE", "BASE TABLE"},
	}
	if len(schemas) > 0 {
		tableFilter.Schema = schemas[0]
	}

	tableSet, err := tableReader.Tables(tableFilter)
	if err != nil {
		return nil, fmt.Errorf("failed to list tables: %w", err)
	}

	var result SchemaResult
	for tableSet.Next() {
		t := tableSet.Get()

		// Apply table name filter if provided
		if len(tables) > 0 && !containsStr(tables, t.Name) {
			continue
		}

		schema := t.Schema
		if schema == "" {
			schema = "main"
		}

		info := TableInfo{
			Name:             t.Name,
			Schema:           schema,
			Columns:          []ColumnInfo{},
			PrimaryKey:       []string{},
			Indexes:          []IndexInfo{},
			ForeignKeys:      []ForeignKey{},
			RowCountEstimate: t.Rows,
			ExactCount:       exactCounts,
			Comment:          nilIfEmpty(t.Comment),
		}

		// Get columns — preserve definition order via OrdinalPosition
		if colReader, ok := reader.(metadata.ColumnReader); ok {
			colFilter := metadata.Filter{
				Schema: t.Schema,
				Parent: t.Name,
			}
			colSet, err := colReader.Columns(colFilter)
			if err == nil {
				type orderedCol struct {
					col     ColumnInfo
					ordinal int
				}
				var orderedCols []orderedCol
				for colSet.Next() {
					c := colSet.Get()
					orderedCols = append(orderedCols, orderedCol{
						col: ColumnInfo{
							Name:         c.Name,
							Type:         c.DataType,
							Nullable:     c.IsNullable == metadata.YES,
							DefaultValue: nilIfEmpty(c.Default),
							IsPrimaryKey: false,
							Comment:      nil,
						},
						ordinal: c.OrdinalPosition,
					})
				}
				// Sort by ordinal position to preserve definition order
				sort.Slice(orderedCols, func(i, j int) bool {
					return orderedCols[i].ordinal < orderedCols[j].ordinal
				})
				for _, oc := range orderedCols {
					info.Columns = append(info.Columns, oc.col)
				}
			}
		}

		// Get indexes and detect primary keys
		if indexReader, ok := reader.(metadata.IndexReader); ok {
			idxFilter := metadata.Filter{
				Schema: t.Schema,
				Parent: t.Name,
			}
			idxSet, err := indexReader.Indexes(idxFilter)
			if err == nil {
				for idxSet.Next() {
					idx := idxSet.Get()
					columns := []string{}

					if idx.Columns != "" {
						columns = strings.Split(idx.Columns, ", ")
					}

					// Fall back to IndexColumnReader for drivers that don't populate Columns
					if len(columns) == 0 {
						if icReader, ok := reader.(metadata.IndexColumnReader); ok {
							icFilter := metadata.Filter{
								Schema: t.Schema,
								Parent: t.Name,
								Name:   idx.Name,
							}
							icSet, err := icReader.IndexColumns(icFilter)
							if err == nil {
								for icSet.Next() {
									ic := icSet.Get()
									columns = append(columns, ic.Name)
								}
							}
						}
					}

					info.Indexes = append(info.Indexes, IndexInfo{
						Name:    idx.Name,
						Columns: columns,
						Unique:  idx.IsUnique == metadata.YES,
						Type:    strings.ToLower(idx.Type),
						Filter:  nil,
					})

					// Mark primary key columns
					if idx.IsPrimary == metadata.YES {
						info.PrimaryKey = columns
						for i := range info.Columns {
							for _, pkCol := range columns {
								if info.Columns[i].Name == pkCol {
									info.Columns[i].IsPrimaryKey = true
								}
							}
						}
					}
				}
			}
		}

		// Supplement: detect partial indexes for databases that support it
		supplementPartialIndexes(conn, t.Name, &info)

		// Get foreign keys from constraints
		if constraintReader, ok := reader.(metadata.ConstraintReader); ok {
			conFilter := metadata.Filter{
				Schema: t.Schema,
				Parent: t.Name,
				Types:  []string{"FOREIGN KEY"},
			}
			conSet, err := constraintReader.Constraints(conFilter)
			if err == nil {
				for conSet.Next() {
					c := conSet.Get()
					if c.ForeignTable == "" {
						continue
					}
					if ccReader, ok := reader.(metadata.ConstraintColumnReader); ok {
						ccFilter := metadata.Filter{
							Schema: t.Schema,
							Parent: t.Name,
							Name:   c.Name,
						}
						ccSet, err := ccReader.ConstraintColumns(ccFilter)
						if err == nil {
							for ccSet.Next() {
								cc := ccSet.Get()
								info.ForeignKeys = append(info.ForeignKeys, ForeignKey{
									Column:           cc.Name,
									ReferencesTable:  c.ForeignTable,
									ReferencesColumn: cc.ForeignName,
								})
							}
						}
					}
				}
			}
		}

		// Get exact row count via COUNT(*) when requested, or as a fallback when the estimate is 0
		if exactCounts || info.RowCountEstimate == 0 {
			var count int64
			err := conn.DB.QueryRow(fmt.Sprintf("SELECT COUNT(*) FROM %s", t.Name)).Scan(&count)
			if err == nil {
				info.RowCountEstimate = count
			}
		}

		// Supplement: detect primary keys from column info if the index reader didn't find them.
		// SQLite's INTEGER PRIMARY KEY is a rowid alias with no index entry in pragma_index_list.
		if len(info.PrimaryKey) == 0 {
			supplementPrimaryKeys(conn, t.Name, &info)
		}

		// Supplement: detect foreign keys if the constraint reader didn't find them.
		// Some drivers (e.g., SQLite) don't implement ConstraintReader.
		if len(info.ForeignKeys) == 0 {
			supplementForeignKeys(conn, t.Name, &info)
		}

		result.Tables = append(result.Tables, info)
	}

	if result.Tables == nil {
		result.Tables = []TableInfo{}
	}

	return &result, nil
}

func containsStr(slice []string, s string) bool {
	lower := strings.ToLower(s)
	for _, v := range slice {
		if strings.ToLower(v) == lower {
			return true
		}
	}
	return false
}

// supplementPrimaryKeys detects PKs when the usql metadata reader didn't find them.
// Uses database-native methods — tries each approach and uses whichever succeeds.
func supplementPrimaryKeys(conn *Connection, tableName string, info *TableInfo) {
	// PRAGMA table_info — works on SQLite (pk column > 0 indicates primary key)
	rows, err := conn.DB.Query(fmt.Sprintf("PRAGMA table_info('%s')", tableName))
	if err != nil {
		return // Not SQLite or PRAGMA not supported — skip silently
	}
	defer rows.Close()

	for rows.Next() {
		var cid int
		var name, colType string
		var notNull int
		var dfltValue *string
		var pk int
		if err := rows.Scan(&cid, &name, &colType, &notNull, &dfltValue, &pk); err != nil {
			return
		}
		if pk > 0 {
			info.PrimaryKey = append(info.PrimaryKey, name)
			for i := range info.Columns {
				if info.Columns[i].Name == name {
					info.Columns[i].IsPrimaryKey = true
				}
			}
		}
	}
}

// supplementForeignKeys detects FKs when the usql metadata reader didn't find them.
// Uses database-native methods — tries each approach and uses whichever succeeds.
func supplementForeignKeys(conn *Connection, tableName string, info *TableInfo) {
	// PRAGMA foreign_key_list — works on SQLite
	rows, err := conn.DB.Query(fmt.Sprintf("PRAGMA foreign_key_list('%s')", tableName))
	if err == nil {
		defer rows.Close()
		for rows.Next() {
			var id, seq int
			var table, from, to, onUpdate, onDelete, match string
			if err := rows.Scan(&id, &seq, &table, &from, &to, &onUpdate, &onDelete, &match); err != nil {
				break
			}
			info.ForeignKeys = append(info.ForeignKeys, ForeignKey{
				Column:           from,
				ReferencesTable:  table,
				ReferencesColumn: to,
			})
		}
		if len(info.ForeignKeys) > 0 {
			return
		}
	}

	// information_schema — works on Postgres, MySQL, SQL Server, and most others.
	// Uses REFERENTIAL_CONSTRAINTS + KEY_COLUMN_USAGE for broad compatibility.
	// Note: we use string formatting for the table name since it's already validated
	// against the schema cache, and direct DB.Query bypasses our placeholder translator.
	query := fmt.Sprintf(`
		SELECT
			kcu.COLUMN_NAME,
			kcu2.TABLE_NAME AS REFERENCED_TABLE,
			kcu2.COLUMN_NAME AS REFERENCED_COLUMN
		FROM INFORMATION_SCHEMA.REFERENTIAL_CONSTRAINTS rc
		JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE kcu
			ON rc.CONSTRAINT_NAME = kcu.CONSTRAINT_NAME
			AND rc.CONSTRAINT_SCHEMA = kcu.TABLE_SCHEMA
		JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE kcu2
			ON rc.UNIQUE_CONSTRAINT_NAME = kcu2.CONSTRAINT_NAME
			AND rc.UNIQUE_CONSTRAINT_SCHEMA = kcu2.TABLE_SCHEMA
			AND kcu.ORDINAL_POSITION = kcu2.ORDINAL_POSITION
		WHERE kcu.TABLE_NAME = '%s'`, tableName)
	rows2, err := conn.DB.Query(query)
	if err != nil {
		return
	}
	defer rows2.Close()

	for rows2.Next() {
		var col, refTable, refCol string
		if err := rows2.Scan(&col, &refTable, &refCol); err != nil {
			return
		}
		info.ForeignKeys = append(info.ForeignKeys, ForeignKey{
			Column:           col,
			ReferencesTable:  refTable,
			ReferencesColumn: refCol,
		})
	}
}

// supplementPartialIndexes detects partial index WHERE clauses.
// Uses database-native catalog queries. Currently supports PostgreSQL.
func supplementPartialIndexes(conn *Connection, tableName string, info *TableInfo) {
	// PostgreSQL: query pg_indexes + pg_index to find partial index filter expressions
	query := fmt.Sprintf(`
		SELECT indexname, pg_get_expr(i.indpred, i.indrelid)
		FROM pg_indexes pi
		JOIN pg_class c ON c.relname = pi.indexname
		JOIN pg_index i ON i.indexrelid = c.oid
		WHERE pi.tablename = '%s' AND i.indpred IS NOT NULL`, tableName)
	rows, err := conn.DB.Query(query)
	if err != nil {
		return // Not PostgreSQL or query not supported
	}
	defer rows.Close()

	filters := make(map[string]string)
	for rows.Next() {
		var idxName, filter string
		if err := rows.Scan(&idxName, &filter); err != nil {
			return
		}
		filters[idxName] = filter
	}

	for i := range info.Indexes {
		if filter, ok := filters[info.Indexes[i].Name]; ok {
			info.Indexes[i].Filter = &filter
		}
	}
}

func nilIfEmpty(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}

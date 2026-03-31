package main

import (
	"github.com/itsJeremyMax/omnibase/sidecar/driverplugin"
	_ "github.com/xo/usql/drivers/sqlite3"
)

func main() {
	driverplugin.Serve()
}

package main

import (
	"github.com/itsJeremyMax/omnibase/sidecar/driverplugin"
	_ "github.com/xo/usql/drivers/couchbase"
)

func main() {
	driverplugin.Serve()
}

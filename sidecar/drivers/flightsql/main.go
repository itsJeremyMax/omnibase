package main

import (
	"github.com/itsJeremyMax/omnibase/sidecar/driverplugin"
	_ "github.com/xo/usql/drivers/flightsql"
)

func main() {
	driverplugin.Serve()
}

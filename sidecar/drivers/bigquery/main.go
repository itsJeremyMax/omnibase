package main

import (
	"github.com/itsJeremyMax/omnibase/sidecar/driverplugin"
	_ "github.com/xo/usql/drivers/bigquery"
)

func main() {
	driverplugin.Serve()
}

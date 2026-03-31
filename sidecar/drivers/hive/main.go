package main

import (
	"github.com/itsJeremyMax/omnibase/sidecar/driverplugin"
	_ "github.com/xo/usql/drivers/hive"
)

func main() {
	driverplugin.Serve()
}

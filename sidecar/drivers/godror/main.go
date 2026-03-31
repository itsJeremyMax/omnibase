package main

import (
	"github.com/itsJeremyMax/omnibase/sidecar/driverplugin"
	_ "github.com/xo/usql/drivers/godror"
)

func main() {
	driverplugin.Serve()
}

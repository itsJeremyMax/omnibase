package main

import (
	"github.com/itsJeremyMax/omnibase/sidecar/driverplugin"
	_ "github.com/xo/usql/drivers/netezza"
)

func main() {
	driverplugin.Serve()
}

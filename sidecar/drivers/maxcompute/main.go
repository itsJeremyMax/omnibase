package main

import (
	"github.com/itsJeremyMax/omnibase/sidecar/driverplugin"
	_ "github.com/xo/usql/drivers/maxcompute"
)

func main() {
	driverplugin.Serve()
}

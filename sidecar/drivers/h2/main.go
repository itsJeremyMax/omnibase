package main

import (
	"github.com/itsJeremyMax/omnibase/sidecar/driverplugin"
	_ "github.com/xo/usql/drivers/h2"
)

func main() {
	driverplugin.Serve()
}

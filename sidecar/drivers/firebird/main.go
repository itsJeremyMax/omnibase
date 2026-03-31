package main

import (
	"github.com/itsJeremyMax/omnibase/sidecar/driverplugin"
	_ "github.com/xo/usql/drivers/firebird"
)

func main() {
	driverplugin.Serve()
}

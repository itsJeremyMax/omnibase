package driverplugin

import (
	"bufio"
	"encoding/json"
	"fmt"
	"os"
	"strings"
)

// Serve starts a JSON-RPC server on stdin/stdout.
// Call this from a driver plugin's main() after importing the desired usql driver.
func Serve() {
	fmt.Fprintln(os.Stderr, "omnibase-driver-plugin starting...")

	cm := NewConnectionManager()
	defer cm.CloseAll()

	scanner := bufio.NewScanner(os.Stdin)
	scanner.Buffer(make([]byte, 0, 16*1024*1024), 16*1024*1024)

	for scanner.Scan() {
		line := scanner.Text()
		if strings.TrimSpace(line) == "" {
			continue
		}

		req, err := ReadRequest([]byte(line))
		if err != nil {
			resp := MakeError(0, "PARSE_ERROR", "invalid JSON-RPC request", err.Error())
			writeResponse(resp)
			continue
		}

		resp := handleRequest(cm, req)
		writeResponse(resp)
	}

	if err := scanner.Err(); err != nil {
		fmt.Fprintf(os.Stderr, "stdin read error: %v\n", err)
		os.Exit(1)
	}
}

func handleRequest(cm *ConnectionManager, req RPCRequest) RPCResponse {
	switch req.Method {
	case "connect":
		return handleConnect(cm, req)
	case "execute":
		return handleExecute(cm, req)
	case "schema":
		return handleSchema(cm, req)
	case "explain":
		return handleExplain(cm, req)
	case "validate":
		return handleValidate(cm, req)
	case "ping":
		return handlePing(cm, req)
	case "disconnect":
		return handleDisconnect(cm, req)
	default:
		return MakeError(req.ID, "METHOD_NOT_FOUND", fmt.Sprintf("unknown method: %s", req.Method), "")
	}
}

func writeResponse(resp RPCResponse) {
	data, err := json.Marshal(resp)
	if err != nil {
		fmt.Fprintf(os.Stderr, "failed to marshal response: %v\n", err)
		return
	}
	fmt.Println(string(data))
}

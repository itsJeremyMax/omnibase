package driverclient

import (
	"bufio"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"os/exec"
	"sync"
)

// DriverClient manages a single driver plugin subprocess.
type DriverClient struct {
	cmd       *exec.Cmd
	stdinPipe io.WriteCloser
	scanner   *bufio.Scanner
	mu        sync.Mutex
	requestID int
	pending   map[int]chan rpcResult
}

type rpcResult struct {
	Result json.RawMessage
	Error  *rpcError
}

type rpcError struct {
	Code    string `json:"code"`
	Message string `json:"message"`
	Detail  string `json:"detail,omitempty"`
}

type jsonRPCRequest struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      int             `json:"id"`
	Method  string          `json:"method"`
	Params  json.RawMessage `json:"params"`
}

type jsonRPCResponse struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      int             `json:"id"`
	Result  json.RawMessage `json:"result,omitempty"`
	Error   *rpcError       `json:"error,omitempty"`
}

// NewDriverClient spawns a driver binary subprocess and returns a client for it.
func NewDriverClient(binaryPath string) (*DriverClient, error) {
	if _, err := os.Stat(binaryPath); err != nil {
		return nil, fmt.Errorf("driver binary not found: %s", binaryPath)
	}

	cmd := exec.Command(binaryPath)
	cmd.Stderr = os.Stderr

	stdin, err := cmd.StdinPipe()
	if err != nil {
		return nil, fmt.Errorf("failed to get stdin pipe: %w", err)
	}

	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return nil, fmt.Errorf("failed to get stdout pipe: %w", err)
	}

	if err := cmd.Start(); err != nil {
		return nil, fmt.Errorf("failed to start driver: %w", err)
	}

	client := &DriverClient{
		cmd:       cmd,
		stdinPipe: stdin,
		scanner:   bufio.NewScanner(stdout),
		pending:   make(map[int]chan rpcResult),
	}
	client.scanner.Buffer(make([]byte, 0, 16*1024*1024), 16*1024*1024)

	go client.readResponses()

	return client, nil
}

// Send sends a JSON-RPC request with raw JSON params and returns the raw JSON result.
func (c *DriverClient) Send(method string, params json.RawMessage) (json.RawMessage, error) {
	c.mu.Lock()
	c.requestID++
	id := c.requestID

	ch := make(chan rpcResult, 1)
	c.pending[id] = ch

	req := jsonRPCRequest{
		JSONRPC: "2.0",
		ID:      id,
		Method:  method,
		Params:  params,
	}

	data, err := json.Marshal(req)
	if err != nil {
		delete(c.pending, id)
		c.mu.Unlock()
		return nil, fmt.Errorf("failed to marshal request: %w", err)
	}

	_, err = c.stdinPipe.Write(append(data, '\n'))
	if err != nil {
		delete(c.pending, id)
		c.mu.Unlock()
		return nil, fmt.Errorf("failed to write to driver: %w", err)
	}
	c.mu.Unlock()

	result := <-ch
	if result.Error != nil {
		return nil, fmt.Errorf("%s: %s", result.Error.Code, result.Error.Message)
	}
	return result.Result, nil
}

func (c *DriverClient) readResponses() {
	for c.scanner.Scan() {
		line := c.scanner.Text()
		var resp jsonRPCResponse
		if err := json.Unmarshal([]byte(line), &resp); err != nil {
			continue
		}

		c.mu.Lock()
		ch, ok := c.pending[resp.ID]
		if ok {
			delete(c.pending, resp.ID)
		}
		c.mu.Unlock()

		if ok {
			ch <- rpcResult{Result: resp.Result, Error: resp.Error}
		}
	}

	// Scanner ended (subprocess exited). Fail all pending requests.
	c.mu.Lock()
	for id, ch := range c.pending {
		ch <- rpcResult{Error: &rpcError{Code: "DRIVER_CRASH", Message: "driver subprocess exited"}}
		delete(c.pending, id)
	}
	c.mu.Unlock()
}

// Stop kills the driver subprocess.
func (c *DriverClient) Stop() {
	if c.stdinPipe != nil {
		c.stdinPipe.Close()
	}
	if c.cmd != nil && c.cmd.Process != nil {
		c.cmd.Process.Kill()
		c.cmd.Wait()
	}
}

// IsRunning returns true if the subprocess is still running.
func (c *DriverClient) IsRunning() bool {
	return c.cmd != nil && c.cmd.ProcessState == nil
}

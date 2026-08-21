package model

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestConnectionRemotePortCompatibility(t *testing.T) {
	tests := []struct {
		name    string
		payload string
		want    int
	}{
		{name: "canonical", payload: `{"remote_port":20001}`, want: 20001},
		{name: "legacy", payload: `{"tcp_remote_port":10001}`, want: 10001},
		{name: "canonical wins", payload: `{"tcp_remote_port":10001,"remote_port":20001}`, want: 20001},
		{name: "canonical zero wins", payload: `{"remote_port":0,"tcp_remote_port":10001}`, want: 0},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			var connection Connection
			if err := json.Unmarshal([]byte(test.payload), &connection); err != nil {
				t.Fatal(err)
			}
			if connection.RemotePort != test.want {
				t.Fatalf("RemotePort = %d, want %d", connection.RemotePort, test.want)
			}
		})
	}
}

func TestConnectionPersistsCanonicalRemotePort(t *testing.T) {
	payload, err := json.Marshal(Connection{ProxyType: "udp", RemotePort: 20001})
	if err != nil {
		t.Fatal(err)
	}
	encoded := string(payload)
	if !strings.Contains(encoded, `"remote_port":20001`) || strings.Contains(encoded, "tcp_remote_port") {
		t.Fatalf("connection JSON does not use canonical remote_port: %s", encoded)
	}
}

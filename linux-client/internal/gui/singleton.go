package gui

import (
	"io"
	"net/http"
	"time"
)

const UIAddress = "127.0.0.1:8788"

func ExistingUI() string {
	client := &http.Client{Timeout: 600 * time.Millisecond}
	response, err := client.Get("http://" + UIAddress + "/local/ping")
	if err != nil {
		return ""
	}
	defer response.Body.Close()
	_, _ = io.Copy(io.Discard, io.LimitReader(response.Body, 256))
	if response.StatusCode != http.StatusOK {
		return ""
	}
	return "http://" + UIAddress + "/"
}

func RequestShow() bool {
	if ExistingUI() == "" {
		return false
	}
	client := &http.Client{Timeout: 800 * time.Millisecond}
	response, err := client.Post("http://"+UIAddress+"/local/show", "application/json", nil)
	if err != nil {
		return false
	}
	defer response.Body.Close()
	_, _ = io.Copy(io.Discard, io.LimitReader(response.Body, 256))
	return response.StatusCode == http.StatusOK
}

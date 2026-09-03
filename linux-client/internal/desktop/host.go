package desktop

import "sync"

// Host lets the local HTTP API ask the native window to come to the front.
type Host struct {
	mu   sync.Mutex
	show func()
}

func (host *Host) setShow(show func()) {
	host.mu.Lock()
	host.show = show
	host.mu.Unlock()
}

// Show restores the native window if the desktop host is running.
func (host *Host) Show() {
	host.mu.Lock()
	show := host.show
	host.mu.Unlock()
	if show != nil {
		show()
	}
}

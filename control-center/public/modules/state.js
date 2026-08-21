export const state = {
  csrf: "",
  me: null,
  users: [],
  devices: [],
  connections: [],
  tunnelDomain: "tunnel.example.com",
  transportTunnels: {
    tcp: { enabled: false, port_start: 10000, port_end: 10099 },
    udp: { enabled: false, port_start: 10000, port_end: 10099 },
  },
  currentView: "dashboard",
  socket: null,
  refreshTimer: null,
  renderId: 0,
  socketReconnectTimer: null,
  audit: {
    page: 1,
    pageSize: 25,
    query: "",
    action: "",
    targetType: "",
  },
};

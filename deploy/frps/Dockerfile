FROM golang:1.26.5-bookworm AS build
ARG FRP_VERSION=v0.62.1
ENV CGO_ENABLED=0
RUN go install -trimpath -ldflags="-s -w -buildid=" github.com/fatedier/frp/cmd/frps@${FRP_VERSION}

FROM debian:bookworm-slim
ARG FRP_VERSION=v0.62.1
LABEL org.opencontainers.image.title="Home Tunnel FRPS" \
      org.opencontainers.image.version="${FRP_VERSION}" \
      org.opencontainers.image.source="https://github.com/fatedier/frp"
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates netcat-openbsd \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --gid 10001 home-tunnel \
    && useradd --uid 10001 --gid 10001 --no-create-home --shell /usr/sbin/nologin home-tunnel
COPY --from=build /go/bin/frps /usr/local/bin/frps
COPY frps.toml.template /etc/frp/frps.toml.template
COPY entrypoint.sh /usr/local/bin/home-tunnel-frps-entrypoint
RUN chmod 0555 /usr/local/bin/frps /usr/local/bin/home-tunnel-frps-entrypoint \
    && chmod 0444 /etc/frp/frps.toml.template
USER 10001:10001
EXPOSE 7000 8080
ENTRYPOINT ["/usr/local/bin/home-tunnel-frps-entrypoint"]

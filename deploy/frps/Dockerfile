FROM golang:1.26.5-bookworm AS build
ARG FRP_VERSION=v0.62.1
ARG FRP_COMMIT=b41d8f8e4074c4f633fb67d7d31b97db59472674
ENV CGO_ENABLED=0
RUN git clone --depth 1 --branch "${FRP_VERSION}" https://github.com/fatedier/frp.git /src/frp \
    && test "$(git -C /src/frp rev-parse HEAD)" = "${FRP_COMMIT}" \
    && cd /src/frp \
    && go build -tags noweb -trimpath -buildvcs=false -ldflags="-s -w -buildid=" -o /go/bin/frps ./cmd/frps

FROM alpine:3.22
ARG FRP_VERSION=v0.62.1
LABEL org.opencontainers.image.title="Home Tunnel FRPS" \
      org.opencontainers.image.version="${FRP_VERSION}" \
      org.opencontainers.image.source="https://github.com/fatedier/frp"
RUN apk add --no-cache ca-certificates netcat-openbsd \
    && addgroup -g 10001 -S home-tunnel \
    && adduser -u 10001 -S -D -H -G home-tunnel home-tunnel
COPY --from=build /go/bin/frps /usr/local/bin/frps
COPY frps.toml.template /etc/frp/frps.toml.template
COPY entrypoint.sh /usr/local/bin/home-tunnel-frps-entrypoint
RUN chmod 0555 /usr/local/bin/frps /usr/local/bin/home-tunnel-frps-entrypoint \
    && chmod 0444 /etc/frp/frps.toml.template
USER 10001:10001
EXPOSE 7000 8080
ENTRYPOINT ["/usr/local/bin/home-tunnel-frps-entrypoint"]

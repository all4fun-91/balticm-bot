FROM golang:1.24-alpine AS proxybuild
WORKDIR /src
COPY proxy.go .
RUN CGO_ENABLED=0 go build -o /out/lavalink-test-proxy proxy.go

FROM ghcr.io/lavalink-devs/lavalink:4
COPY --chown=322:322 application.yml /opt/Lavalink/application.yml
COPY --from=proxybuild --chown=322:322 /out/lavalink-test-proxy /opt/Lavalink/lavalink-test-proxy
COPY --chown=322:322 start.sh /opt/Lavalink/start.sh
RUN chmod +x /opt/Lavalink/start.sh /opt/Lavalink/lavalink-test-proxy
ENTRYPOINT ["/opt/Lavalink/start.sh"]

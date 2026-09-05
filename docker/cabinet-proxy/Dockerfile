# cabinet-proxy — tiny HTTP CONNECT tunnel, runs with network_mode:host so its
# egress uses the HOST's network path (reliable to *.sud.uz), letting the
# bridge-networked web/worker containers (unreliable to *.sud.uz) reach cabinet
# APIs through it. See proxy.js.
FROM node:22-alpine
WORKDIR /app
COPY proxy.js .
EXPOSE 3128
CMD ["node", "proxy.js"]

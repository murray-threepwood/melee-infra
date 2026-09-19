FROM node:22-alpine
ENV NODE_OPTIONS=--experimental-sqlite
RUN apk add --no-cache docker-cli docker-cli-compose git
WORKDIR /tmp
CMD ["node", "/opt/agent/server.mjs"]

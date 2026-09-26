FROM node:22-alpine
ENV NODE_OPTIONS=--experimental-sqlite
ENV EDITOR=vim
ENV VISUAL=vim
RUN apk add --no-cache docker-cli docker-cli-compose git vim && \
    mkdir -p /etc/vim && \
    printf "syntax on\nset number\nset background=dark\n" > /etc/vim/vimrc && \
    printf "syntax on\nset number\nset background=dark\n" > /root/.vimrc

WORKDIR /opt
COPY package.json package-lock.json* ./
RUN npm install --omit=dev

WORKDIR /tmp
CMD ["node", "/opt/agent/server.mjs"]

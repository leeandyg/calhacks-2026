FROM node:24-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates ffmpeg tini && rm -rf /var/lib/apt/lists/*
WORKDIR /worker
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
# Bake real toolkits into the image once; generation never waits for installation.
ARG PXL_REV=a012fc78b92e5deff27e56bba563f22895c3916c
ARG CHIRP_REV=e07b880eb92ce54664b3d4537d70ebac99144558
RUN git clone https://github.com/uilianks/pxl.git /opt/pxl && git -C /opt/pxl checkout "$PXL_REV" && node /opt/pxl/scripts/build.js
RUN git clone https://github.com/uilianks/chirp.git /opt/chirp && git -C /opt/chirp checkout "$CHIRP_REV" && cd /opt/chirp && npm ci --omit=dev
COPY server.mjs parallel.mjs ./
RUN mkdir -p /data/sessions /data/claude && chown -R node:node /data
ENV CLAUDE_CONFIG_DIR=/data/claude
USER node
EXPOSE 8787
ENTRYPOINT ["tini", "--"]
CMD ["node", "server.mjs"]

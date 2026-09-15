FROM node:24-bookworm-slim
ENV PLAYWRIGHT_BROWSERS_PATH=/opt/ms-playwright
WORKDIR /opt/amie
RUN npm install --ignore-scripts --omit=dev --no-save --package-lock=false playwright-core@1.62.1 \
    && node node_modules/playwright-core/cli.js install --with-deps --only-shell chromium \
    && npm cache clean --force \
    && rm -rf /var/lib/apt/lists/*
COPY browser.mjs /opt/amie/browser.mjs
USER 1000:1000
WORKDIR /tmp
ENTRYPOINT ["node", "/opt/amie/browser.mjs"]

FROM node:25-bookworm-slim AS build
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@11.9.0 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/browser-worker/package.json apps/browser-worker/package.json
RUN pnpm install --frozen-lockfile
COPY apps/browser-worker apps/browser-worker
RUN pnpm --filter @ipa/browser-worker build \
    && pnpm --filter @ipa/browser-worker deploy --prod --legacy /out
FROM node:26.5.1-alpine3.23 AS runtime-files
RUN mkdir -p \
      /rootfs/etc/ssl/certs \
      /rootfs/lib \
      /rootfs/tmp \
      /rootfs/usr/lib \
      /rootfs/usr/local/bin \
    && cp -L /etc/ssl/certs/ca-certificates.crt /rootfs/etc/ssl/certs/ \
    && cp -L /lib/ld-musl-x86_64.so.1 /rootfs/lib/ \
    && cp -L /usr/lib/libgcc_s.so.1 /rootfs/usr/lib/ \
    && cp -L /usr/lib/libstdc++.so.6 /rootfs/usr/lib/ \
    && cp -L /usr/local/bin/node /rootfs/usr/local/bin/ \
    && chmod 1777 /rootfs/tmp

FROM scratch AS runtime
COPY --from=runtime-files /rootfs /
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build --chown=65532:65532 /out/package.json ./package.json
COPY --from=build --chown=65532:65532 /out/node_modules ./node_modules
COPY --from=build --chown=65532:65532 /app/apps/browser-worker/dist ./dist
USER 65532:65532
EXPOSE 3001
ENTRYPOINT ["/usr/local/bin/node"]
CMD ["dist/index.js"]

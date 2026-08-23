# Jam Buddy — HF Space (Docker)
#
# Builds the Next.js webapp + a lightweight Python env for the SA3 API adapter.
# The Space runs in API mode only (no local torch/SA3 — generation goes to the
# Stability REST API via STABILITY_API_KEY). The route resolves the Python
# interpreter from JAM_BUDDY_PYTHON, which we set to the container python.

# ---- Build stage: Next.js ----
FROM node:20-slim AS web-build
WORKDIR /app
# pnpm workspace: copy manifests first for layer caching
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/package.json
COPY packages/ packages/
RUN corepack enable && pnpm install --frozen-lockfile
# Copy source + build
COPY apps/web apps/web
COPY tsconfig.base.json .
RUN cd apps/web && pnpm build

# ---- Runtime stage ----
FROM node:20-slim
WORKDIR /app

# Python for the SA3 API adapter (lightweight: no torch). Debian's python is
# externally managed (PEP 668), so install into a venv and point JAM_BUDDY_PYTHON
# at it.
RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-pip python3-venv \
    && rm -rf /var/lib/apt/lists/*
RUN python3 -m venv /opt/jambuddy-venv
ENV JAM_BUDDY_PYTHON=/opt/jambuddy-venv/bin/python

# Copy the built web app + the tools the API route shells to.
COPY --from=web-build /app/apps/web/.next apps/web/.next
COPY --from=web-build /app/apps/web/package.json apps/web/package.json
COPY --from=web-build /app/apps/web/node_modules apps/web/node_modules
COPY --from=web-build /app/node_modules node_modules
COPY --from=web-build /app/packages packages
COPY apps/web/next.config.mjs apps/web/next.config.mjs
# No apps/web/public dir in this app — omit it (COPY can't use shell operators).
COPY tools tools
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

# Python deps for tools/jam_buddy_api.py (requests, mido, librosa, scipy, soundfile, numpy).
RUN /opt/jambuddy-venv/bin/pip install --no-cache-dir requests mido librosa scipy soundfile numpy

# HF Spaces expects the app on port 7860.
ENV PORT=7860
WORKDIR /app/apps/web
EXPOSE 7860
CMD ["node", "node_modules/next/dist/bin/next", "start", "-p", "7860"]

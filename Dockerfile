# Rewrite Studio: Next.js app + TeX Live (latexmk) in one image.
# Build:  docker build -t rewrite-studio .
# Run:    docker run -p 3000:3000 -v $(pwd)/data:/data -e PANGRAM_API_KEY=... rewrite-studio

FROM node:22-bookworm-slim AS deps
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

FROM node:22-bookworm-slim AS build
WORKDIR /app
RUN corepack enable
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm build

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    DATA_DIR=/data
# TeX Live with latexmk. texlive-full is huge; this set covers most papers.
# Add packages to this list if your documents need them.
RUN apt-get update && apt-get install -y --no-install-recommends \
      git ca-certificates \
      latexmk texlive-latex-base texlive-latex-recommended texlive-latex-extra \
      texlive-fonts-recommended texlive-fonts-extra texlive-science texlive-bibtex-extra \
      texlive-pictures texlive-publishers biber ghostscript \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /app/public ./public
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
VOLUME ["/data"]
EXPOSE 3000
CMD ["node", "server.js"]

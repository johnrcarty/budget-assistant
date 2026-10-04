FROM node:20-bookworm-slim AS frontend-build
WORKDIR /build/frontend
COPY frontend/package*.json ./
RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi
COPY frontend/ ./
RUN npm run build

FROM python:3.11-slim-bookworm
ARG BUILD_VERSION=0.4.0
ARG BUILD_ARCH=aarch64
LABEL io.hass.version="${BUILD_VERSION}" \
      io.hass.type="app" \
      io.hass.arch="${BUILD_ARCH}"
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    BUDGET_DATA_DIR=/data
WORKDIR /app
COPY backend/requirements.txt ./backend/requirements.txt
RUN pip install --no-cache-dir -r backend/requirements.txt
COPY backend/ ./backend/
COPY scripts/run.sh scripts/launch.py ./scripts/
COPY --from=frontend-build /build/frontend/dist ./frontend/dist
RUN chmod +x scripts/run.sh && mkdir -p /data
EXPOSE 8099
ENTRYPOINT ["/app/scripts/run.sh"]

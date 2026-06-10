# FTA (LogiQ Aduanas) para Railway — UN SOLO servicio:
# Django (backend + API) sirve también el frontend Next.js ya empaquetado.

# ---- Etapa 1: construir el frontend (Next.js -> export estático en /out) ----
FROM node:20-slim AS frontend
WORKDIR /fe
# Dependencias primero (mejor cache de capas).
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
# La app llama a la API en el mismo dominio (sin CORS): /api
ENV NEXT_PUBLIC_API_URL=/api
RUN npm run build   # genera /fe/out (output: "export")

# ---- Etapa 2: backend Django ----
FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

# Dependencias de Python primero (mejor cache de capas).
COPY requirements.txt .
RUN pip install -r requirements.txt

# Código de la aplicación.
COPY . .

# Frontend ya construido: WhiteNoise/Django lo sirve desde aquí (ver settings.py).
COPY --from=frontend /fe/out ./frontend_build

# Recolectar estáticos en build (no requiere base de datos).
RUN SECRET_KEY=build-only DEBUG=False python manage.py collectstatic --noinput

# Railway inyecta $PORT. Migrar, sembrar (idempotente) y arrancar gunicorn.
CMD python manage.py migrate --noinput && \
    python manage.py bootstrap_prod && \
    gunicorn config.wsgi --bind 0.0.0.0:$PORT --workers 3 --timeout 180

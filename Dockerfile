# Backend Django de FTA (LogiQ Aduanas) para Railway.
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

# Recolectar estáticos en build (no requiere base de datos).
RUN SECRET_KEY=build-only DEBUG=False python manage.py collectstatic --noinput

# Railway inyecta $PORT. Migrar y luego arrancar gunicorn.
CMD python manage.py migrate --noinput && \
    gunicorn config.wsgi --bind 0.0.0.0:$PORT --workers 3

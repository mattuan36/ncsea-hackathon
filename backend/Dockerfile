FROM python:3.12-slim

WORKDIR /srv
COPY backend/requirements.txt /srv/requirements.txt
RUN pip install --no-cache-dir -r /srv/requirements.txt
COPY code /srv/code
COPY gravity_ifc /srv/gravity_ifc
COPY backend/app /srv/backend/app
COPY backend/schema.sql /srv/backend/schema.sql

ENV PYTHONUNBUFFERED=1
WORKDIR /srv/backend
EXPOSE 8000
# Render sets PORT; Fly and local Docker use 8000.
# The full API: documents, models (IFC extraction jobs), materials and the site-load routes.
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}"]

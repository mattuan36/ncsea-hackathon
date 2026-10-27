FROM python:3.12-slim

WORKDIR /srv
COPY backend/requirements-site.txt /srv/requirements.txt
RUN pip install --no-cache-dir -r /srv/requirements.txt
COPY code /srv/code
COPY backend/app /srv/backend/app

ENV PYTHONUNBUFFERED=1
WORKDIR /srv/backend
EXPOSE 8000
CMD ["uvicorn", "app.site_api:app", "--host", "0.0.0.0", "--port", "8000"]

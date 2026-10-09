FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY app.py database.py ./
# The database lives on a volume; it is created and seeded on first start.
ENV FITAKTIV_HOST=0.0.0.0 \
    FITAKTIV_DB=/data/fitaktiv.db \
    FITAKTIV_ENV=production \
    PYTHONUNBUFFERED=1
VOLUME /data
EXPOSE 5000
# ponytail: Flask's built-in threaded server is enough for a demo; switch to gunicorn for real traffic.
CMD ["python", "app.py"]

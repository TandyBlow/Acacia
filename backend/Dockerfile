FROM python:3.10-slim
WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

RUN mkdir -p /data
ENV DB_PATH=/data/seewhat.db

EXPOSE 7860

CMD ["sh", "-c", "python -c \"from database import init_db; init_db()\" && uvicorn main:app --host 0.0.0.0 --port 7860"]

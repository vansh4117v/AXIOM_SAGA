FROM python:3.11-slim

WORKDIR /app

# Layer 1: Heavy ML deps (cached unless requirements-heavy.txt changes)
COPY requirements-heavy.txt .
RUN pip install --no-cache-dir --timeout=600 --retries=10 -r requirements-heavy.txt

# Layer 2: Light deps (fast rebuild)
COPY requirements.txt .
RUN pip install --no-cache-dir --timeout=120 --retries=3 -r requirements.txt

COPY . .

EXPOSE 8000

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]

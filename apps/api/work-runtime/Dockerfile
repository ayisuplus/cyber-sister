FROM python:3.13-slim-bookworm
RUN apt-get update && apt-get install -y --no-install-recommends fonts-wqy-zenhei \
    && rm -rf /var/lib/apt/lists/*
COPY requirements.txt /opt/amie/requirements.txt
RUN pip install --no-cache-dir -r /opt/amie/requirements.txt
COPY runner.py /opt/amie/runner.py
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 MPLCONFIGDIR=/tmp/matplotlib OPENBLAS_NUM_THREADS=1 OMP_NUM_THREADS=1
USER 65534:65534
WORKDIR /workspace
ENTRYPOINT ["python", "/opt/amie/runner.py"]

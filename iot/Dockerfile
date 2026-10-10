FROM python:3.12-slim
WORKDIR /app
COPY simulador.py .
RUN useradd --no-create-home sensor
USER sensor
CMD ["python", "-u", "simulador.py"]

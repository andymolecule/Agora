FROM python:3.12-slim

# Non-root user for security (matches Hermes scorer sandbox)
RUN useradd -u 65532 -m scorer
USER scorer

WORKDIR /app
COPY score.py .

ENTRYPOINT ["python", "score.py"]

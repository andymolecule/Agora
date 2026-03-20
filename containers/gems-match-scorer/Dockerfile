FROM --platform=linux/amd64 python:3.11.9-slim

LABEL org.opencontainers.image.source="https://github.com/andymolecule/Agora" \
      org.opencontainers.image.url="https://github.com/andymolecule/Agora/tree/main/containers/gems-match-scorer" \
      org.opencontainers.image.title="Agora GEMS Match Scorer" \
      org.opencontainers.image.description="Deterministic artifact comparison scorer for CSV, JSON, and binary matching workloads."

WORKDIR /app
COPY score.py /app/score.py
CMD ["python", "/app/score.py"]

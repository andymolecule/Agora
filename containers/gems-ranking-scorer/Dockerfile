FROM python:3.11-slim

LABEL org.opencontainers.image.source="https://github.com/andymolecule/Agora" \
      org.opencontainers.image.url="https://github.com/andymolecule/Agora/tree/main/containers/gems-ranking-scorer" \
      org.opencontainers.image.title="Agora GEMS Ranking Scorer" \
      org.opencontainers.image.description="Deterministic ranking metrics scorer for ranking and docking-style workloads."

WORKDIR /app
COPY score.py /app/score.py
CMD ["python", "/app/score.py"]

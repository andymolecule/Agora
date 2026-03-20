FROM python:3.11-slim

LABEL org.opencontainers.image.source="https://github.com/andymolecule/Agora" \
      org.opencontainers.image.url="https://github.com/andymolecule/Agora/tree/main/containers/gems-generated-scorer" \
      org.opencontainers.image.title="Agora GEMS Generated Scorer" \
      org.opencontainers.image.description="Deterministic generated scorer host for Agora-compiled scoring programs."

WORKDIR /app
RUN useradd -m scorer

COPY score.py /app/score.py
COPY agora_generated_runtime.py /app/agora_generated_runtime.py

USER scorer
CMD ["python", "/app/score.py"]

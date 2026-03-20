FROM python:3.11-slim

LABEL org.opencontainers.image.source="https://github.com/andymolecule/Agora" \
      org.opencontainers.image.url="https://github.com/andymolecule/Agora/tree/main/containers/gems-generated-scorer" \
      org.opencontainers.image.description="Agora generated scorer runner"

WORKDIR /app
COPY score.py /app/score.py

USER nobody

ENTRYPOINT ["python", "/app/score.py"]

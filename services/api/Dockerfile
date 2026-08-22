ARG PYTHON_BASE_IMAGE=python:3.13-slim
FROM ${PYTHON_BASE_IMAGE}

ARG INSTALL_DEPENDENCIES=1

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PYTHONPATH=/opt/navigator-api/src

WORKDIR /opt/navigator-api

COPY pyproject.toml ./
COPY src ./src
COPY alembic.ini ./
COPY alembic ./alembic
COPY docker-entrypoint.sh /usr/local/bin/navigator-api-entrypoint

RUN if [ "$INSTALL_DEPENDENCIES" = "1" ]; then \
      pip install --no-cache-dir .; \
    else \
      python -c "import alembic, fastapi, psycopg, sqlalchemy, uvicorn"; \
    fi \
    && adduser --disabled-password --gecos "" --uid 10001 navigator \
    && chmod 0755 /usr/local/bin/navigator-api-entrypoint \
    && chown -R navigator:navigator /opt/navigator-api

USER navigator
EXPOSE 8000

HEALTHCHECK --interval=10s --timeout=3s --start-period=20s --retries=5 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=2)"

ENTRYPOINT ["navigator-api-entrypoint"]

#!/bin/sh
set -eu

alembic upgrade head
python -m navigator_api.seed --if-empty

exec uvicorn navigator_api.main:create_app --factory --host 0.0.0.0 --port 8000

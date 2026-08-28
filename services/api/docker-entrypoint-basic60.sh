#!/bin/sh
set -eu

alembic -c alembic-basic60.ini upgrade head
python -m navigator_api.basic60_importer

exec uvicorn navigator_api.basic60_main:create_app --factory --host 0.0.0.0 --port 8000

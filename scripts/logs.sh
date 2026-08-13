#!/usr/bin/env bash
# Tail logs. `./scripts/logs.sh` follows everything; `./scripts/logs.sh web` follows one service.
source "$(dirname "${BASH_SOURCE[0]}")/_lib.sh"
require_docker
dc logs -f --tail=200 "$@"

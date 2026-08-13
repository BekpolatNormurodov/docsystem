# Convenience wrapper around the ops scripts + docker compose. Run `make help`.
# (Recipes use the `target: ; cmd` form so no literal tabs are required.)
ENV_FILE ?= .env.production
DC = docker compose --env-file $(ENV_FILE)
S ?=

.PHONY: help deploy update build up down restart ps logs backup seed ssl config

help: ; @printf 'docsystem — make targets:\n  deploy   first-time deploy (build + DB + migrate + SSL)\n  update   redeploy latest code\n  build    rebuild images\n  up       start the stack\n  down     stop the stack\n  restart  restart services\n  ps       service status\n  logs     follow logs (make logs S=web for one service)\n  backup   dump DB + uploaded files\n  seed     re-run schema push + seed\n  ssl      (re)issue TLS certificates\n  config   validate the compose file\n'

deploy:  ; ./scripts/deploy.sh
update:  ; ./scripts/update.sh
build:   ; $(DC) build
up:      ; $(DC) up -d
down:    ; $(DC) down
restart: ; $(DC) restart
ps:      ; $(DC) ps
logs:    ; ./scripts/logs.sh $(S)
backup:  ; ./scripts/backup.sh
seed:    ; ./scripts/seed.sh
ssl:     ; ./scripts/init-ssl.sh
config:  ; $(DC) config

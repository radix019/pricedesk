.DEFAULT_GOAL := help

PNPM ?= pnpm

.PHONY: help install dev dev-server start format lint typecheck typecheck-node typecheck-web check build build-unpack build-win build-mac build-linux

help:
	@printf '%s\n' \
		'make install         Install dependencies' \
		'make dev             Start Electron in development mode' \
		'make dev-server      Start the Express server in development mode' \
		'make start           Preview the built application' \
		'make format          Format project files' \
		'make lint            Run ESLint' \
		'make typecheck       Check all TypeScript code' \
		'make typecheck-node  Check main and preload TypeScript code' \
		'make typecheck-web   Check renderer TypeScript code' \
		'make check           Run lint and TypeScript checks' \
		'make build           Type-check and build the application' \
		'make build-unpack    Build an unpacked application' \
		'make build-win       Build the Windows package' \
		'make build-mac       Build the macOS package' \
		'make build-linux     Build the Linux package'

install:
	$(PNPM) install

dev start format lint typecheck build:
	$(PNPM) run $@

dev-server:
	cd server && $(PNPM) dev

typecheck-node:
	$(PNPM) run typecheck:node

typecheck-web:
	$(PNPM) run typecheck:web

check: lint typecheck

build-unpack:
	$(PNPM) run build:unpack

build-win:
	$(PNPM) run build:win

build-mac:
	$(PNPM) run build:mac

build-linux:
	$(PNPM) run build:linux

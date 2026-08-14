.PHONY: web build test test-go test-web clean

# Vite writes straight into the embed directory.
web:
	cd web && npm ci && npm run build

build: web
	go build -o td-gui ./cmd/td-gui

test: test-go test-web

test-go:
	go test ./...

test-web:
	cd web && npm test -- --run

clean:
	rm -f td-gui
	find internal/web/dist -mindepth 1 ! -name .gitkeep -delete

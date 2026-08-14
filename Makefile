.PHONY: web build test test-go test-web lint lint-go lint-web clean

# Vite writes straight into the embed directory. Its emptyOutDir wipes the
# committed .gitkeep, which go:embed needs in order to compile before any web
# build has run, so put it back afterwards.
web:
	cd web && npm ci && npm run build
	touch internal/web/dist/.gitkeep

build: web
	go build -o td-gui ./cmd/td-gui

# Lint runs first so a style failure surfaces before the slower suites.
test: lint test-go test-web

lint: lint-go lint-web

lint-go:
	golangci-lint run ./...

lint-web:
	cd web && npm run lint

test-go:
	go test ./...

test-web:
	cd web && npm test -- --run

clean:
	rm -f td-gui
	find internal/web/dist -mindepth 1 ! -name .gitkeep -delete

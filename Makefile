.PHONY: web build test test-go test-web lint lint-go lint-web clean

# Vite writes straight into the embed directory. Its emptyOutDir wipes the
# committed .gitkeep, which go:embed needs in order to compile before any web
# build has run, so put it back afterwards.
web:
	cd web && npm ci && npm run build
	touch internal/web/dist/.gitkeep

# The release job stamps the tag it is about to publish into the binary:
#   make build GO_LDFLAGS="-X main.buildVersion=v1.2.3"
# Left empty, main.buildVersion keeps its "dev" default. Not named LDFLAGS:
# that is a C-toolchain variable (Arch's makepkg.conf exports it), and make's
# ?= would let those linker flags through to go build, which rejects them.
GO_LDFLAGS ?=

build: web
	go build -ldflags "$(GO_LDFLAGS)" -o td-gui ./cmd/td-gui

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

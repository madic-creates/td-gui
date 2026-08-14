// Package web serves the embedded single-page application.
package web

import (
	"embed"
	"errors"
	"io/fs"
	"net/http"
	"strings"
)

// dist holds the Vite build output. The all: prefix is required so the
// committed .gitkeep placeholder matches and the package compiles before any
// web build has run.
//
//go:embed all:dist
var dist embed.FS

// ErrNoBuild reports that no web build is embedded in this binary.
var ErrNoBuild = errors.New("no web build embedded (run `make web`)")

// Handler serves the SPA, falling back to index.html for client-side routes.
func Handler() (http.Handler, error) {
	sub, err := fs.Sub(dist, "dist")
	if err != nil {
		return nil, err
	}
	index, err := fs.ReadFile(sub, "index.html")
	if err != nil {
		return nil, ErrNoBuild
	}

	files := http.FileServerFS(sub)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		path := strings.TrimPrefix(r.URL.Path, "/")
		if path == "" {
			serveIndex(w, index)
			return
		}
		if _, err := fs.Stat(sub, path); err == nil {
			files.ServeHTTP(w, r)
			return
		}
		// Real assets must 404 rather than silently return HTML; only
		// extensionless paths are client-side routes.
		if strings.Contains(pathBase(path), ".") {
			http.NotFound(w, r)
			return
		}
		serveIndex(w, index)
	}), nil
}

func serveIndex(w http.ResponseWriter, index []byte) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	_, _ = w.Write(index)
}

func pathBase(p string) string {
	if i := strings.LastIndex(p, "/"); i >= 0 {
		return p[i+1:]
	}
	return p
}

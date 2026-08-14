# td-gui — Design

Datum: 2026-08-14
Status: freigegeben, bereit für die Planung

## Zweck

`td-gui` ist eine lokale Web-Oberfläche für [td](https://github.com/marcus/td).
Sie deckt den Teil des td-Workflows ab, der im Terminal umständlich ist:
Backlog- und Board-Verwaltung sowie das Sichten und Freigeben von Reviews durch
einen Menschen.

Das ist das Ziel des Produkts, nicht der Umfang der ersten Version. v1 baut das
Fundament — Liste, Detail, Bearbeiten, Live-Updates — auf dem Board und
Review-Cockpit danach aufsetzen. Siehe [Umfang v1](#umfang-v1).

td-gui lebt in einem eigenen Repository. Am td-Repository wird nichts geändert;
es dient ausschließlich als Referenz.

## Grundentscheidung: td serve als Datenzugang

td bringt seit v0.39.0 `td serve` mit — einen lokalen HTTP-Server mit
vollständiger REST-API über Issues, Transitions, Kommentare, Dependencies,
Focus, Boards, Sessions, Stats und Labels, dazu einen SSE-Kanal unter
`GET /v1/events`. Der Contract ist in `docs/td-serve-spec.md` im td-Repository
festgeschrieben.

td-gui nutzt diesen Server und fasst `.todos/issues.db` **nie** selbst an.

Das ist keine Bequemlichkeit, sondern der Kern des Entwurfs. Ein direkter
Datenbankzugriff müsste Schema-Version 37, die Migrationskette, das Action-Log
und vor allem die Review-Policy nachbauen. Jede Abweichung wäre ein stiller
Integritätsbruch in den Daten des Nutzers. Über `td serve` läuft jeder
Schreibvorgang durch dieselbe Logik wie ein CLI-Aufruf.

Eine harte Randbedingung folgt daraus: td's Server-Code liegt unter
`internal/serve/`, und Go verbietet den Import von `internal/`-Paketen über
Modulgrenzen hinweg. td-gui kann den Server **nicht** als Bibliothek einbinden
und startet stattdessen das `td`-Binary als Kindprozess. Das hält die Kopplung
lose — td-gui hängt am HTTP-Contract, nicht an td's Interna.

## Architektur

Ein einzelnes Go-Binary `td-gui`, aufgerufen im td-Projektverzeichnis. Es
liefert die eingebettete Web-App aus und proxied die API.

```
Browser  ──►  td-gui (127.0.0.1:PORT)  ──►  td serve (127.0.0.1:AUTO)  ──►  .todos/issues.db
              │  /            SPA            │  /v1/*   REST
              │  /v1/*        Proxy          │  /v1/events  SSE
              └─ Origin-Guard, Bearer-Token  └─ Auth, Review-Policy, Action-Log
```

### Startsequenz

1. Basisverzeichnis auflösen und per `--work-dir` an `td` durchreichen.
   `.td-root`- und Git-Worktree-Auflösung übernimmt td selbst.
2. `td`-Binary im PATH finden, überschreibbar per `--td`. Version prüfen.
   Mindestversion ist **v0.57.0**: `td serve` selbst gibt es zwar seit
   v0.39.0, aber td-gui baut auf `available_transitions` und `active_review`,
   die später dazukamen. v0.57.0 ist die Version, gegen die dieser Entwurf
   verifiziert wurde; eine genauere Untergrenze wäre nur durch Testen älterer
   Releases zu ermitteln und ist den Aufwand nicht wert.
3. `.todos/serve-port` lesen und `GET /health` prüfen — der in
   `docs/td-serve-spec.md` festgelegte Consumer-Discovery-Flow.
4. Eine gesunde, nutzbare Instanz wiederverwenden. Sonst
   `td serve --addr localhost --port 0 --token <zufällig>` als Kindprozess
   starten und auf ein gesundes Portfile warten.
5. Eigenen Listener auf `127.0.0.1` binden und den Browser öffnen
   (unterdrückbar per `--no-open`).

### Auth-Probe beim Wiederverwenden

`/health` ist in td bewusst von der Auth ausgenommen. Eine fremde, mit
`--token` gestartete Instanz sieht deshalb gesund aus, liefert dem Proxy aber
401. Nach dem Health-Check folgt daher eine zweite, authentifizierte Probe
(`GET /v1/labels`). Antwortet die mit 401, gilt die Instanz als unbrauchbar und
td-gui startet eine eigene.

### Lebenszyklus des Kindprozesses

Beim Beenden fährt td-gui **nur** einen selbst gestarteten `td serve` mit
herunter. Eine vorgefundene Instanz bleibt unangetastet — dahinter kann ein
`td monitor` oder ein arbeitender Agent hängen.

### Proxy

`httputil.ReverseProxy` mit `FlushInterval: -1`, damit SSE nicht gepuffert
wird. Der Proxy setzt den `Authorization: Bearer`-Header; das Token bleibt im
Go-Prozess und erreicht den Browser nie.

### Sicherheitsgrenze

Localhost-Binding allein genügt nicht: Eine beliebige Website im Browser des
Nutzers könnte `POST http://localhost:<port>/v1/issues` absetzen. Eine
Origin-Guard-Middleware lehnt daher jede Anfrage ab, deren `Origin`- bzw.
`Referer`-Header nicht auf den eigenen Listener zeigt.

Gegenüber lokalen *Prozessen* schützt das nicht — die können ohnehin `td`
direkt aufrufen. Das ist dieselbe Vertrauensstufe wie die CLI und damit
angemessen.

## Komponenten

### Go

| Paket | Aufgabe |
|---|---|
| `cmd/td-gui` | Flag-Parsing, Verdrahtung, Signal-Handling |
| `internal/tdbin` | `td`-Binary finden, Version prüfen |
| `internal/backend` | Portfile lesen, Health- und Auth-Probe, `td serve` starten, Lebenszyklus |
| `internal/proxy` | Reverse-Proxy, Origin-Guard |
| `internal/web` | `go:embed` des Vite-Builds, SPA-Fallback auf `index.html` |

td's `internal/serve/portfile.go` ist nicht importierbar. Das Portfile besteht
aus vier JSON-Feldern (`port`, `pid`, `started_at`, `instance_id`); die
Nachbildung samt Stale-Erkennung (PID tot **oder** `/health` antwortet nicht)
ist trivial.

### Frontend

React 19 mit TypeScript, gebaut mit Vite. TanStack Query für den Server-State,
React Router für die zwei Routen (`/`, `/issues/:id`), Tailwind fürs Styling.
Node wird nur zur Build-Zeit gebraucht, nicht beim Nutzer.

```
web/
  src/api/        Client, Typen, Query-Definitionen
  src/features/issues/
  src/components/
```

## Datenfluss

Alle Reads laufen über TanStack Query.

Der SSE-Kanal ist bewusst grobkörnig: td sendet nur `refresh` mit einem
globalen `change_token`, keine Deltas. Ein `refresh` invalidiert deshalb den
gesamten Query-Cache, und die sichtbaren Queries laden nach. Bei einer lokalen
API ist das billig und spart jede Delta-Logik.

Reconnect nach dem Spec-Contract: `Last-Event-ID` mitschicken, exponentielles
Backoff von 1s bis maximal 10s. Der Ping alle 30 Sekunden dient als
Verbindungs-Lebenszeichen — bleibt er aus, zeigt die Oberfläche einen
„getrennt"-Zustand, statt stillschweigend veraltete Daten anzuzeigen.

Schreibvorgänge gehen ohne Optimistic Updates direkt raus und invalidieren
danach. Bei Latenzen im einstelligen Millisekundenbereich wäre optimistisches
Rendern nur eine zusätzliche Fehlerquelle.

## Umfang v1

### Enthalten

**Issue-Liste.** Filter über die API-Parameter (`status`, `type`, `priority`,
`labels`, `search`) mit `limit`/`offset`-Pagination, nicht clientseitig. Die
Antwort liefert `pagination.total` mit.

**Issue-Detail.** `GET /v1/issues/{id}` liefert in einem Aufruf Beschreibung,
Logs, Kommentare, den letzten Handoff, Dependencies und `blocked_by`,
`active_review` sowie `available_transitions`.

**Anlegen und Bearbeiten.** `POST /v1/issues`, `PATCH /v1/issues/{id}`,
Kommentare über `POST /v1/issues/{id}/comments`.

**Transition-Buttons.** td sagt über `available_transitions` selbst, welche
Übergänge *diese* Session auf *diesem* Issue gerade ausführen darf —
Review-Policy inklusive. Die Oberfläche rendert genau diese Buttons und rät nie
anhand des Status.

**Live-Updates per SSE** wie oben beschrieben.

### Bewusst auf später verschoben

- **Review-Cockpit** (Review-Queue, Handoff-Gegenüberstellung, geänderte
  Dateien) — v2. Die Transition-Buttons aus v1 decken den Freigabe-Vorgang
  bereits ab; das Cockpit ergänzt den Überblick darüber.
- **Kanban-Board mit Drag & Drop** — v2.
- **Multi-Projekt-Ansicht.** td serve läuft laut Contract ein Prozess pro
  Projekt; eine Mehrprojekt-Oberfläche müsste mehrere Backends verwalten.
- **Playwright-E2E.** Bei zwei Ansichten zahlt sich der Unterhalt nicht aus.

## Fehlerbehandlung

### API-Fehler

td antwortet einheitlich mit `{ok:false, error:{code, message, details}}`. Ein
zentraler `apiFetch` packt die Hülle aus und wirft einen typisierten
`ApiError`.

| Code | HTTP | Behandlung |
|---|---|---|
| `validation_error` | 400 | `details.fields[]` (`field`, `rule`, `expected`) inline am Formularfeld anzeigen, nicht als Sammelmeldung |
| `unauthorized` | 401 | Sollte nie auftreten, da das Token im Proxy sitzt. Als Backend-Problem melden, nicht als Nutzerfehler |
| `forbidden` | 403 | Review-Policy-Ablehnung. Meldung **wörtlich** durchreichen |
| `not_found` | 404 | Issue wurde zwischenzeitlich gelöscht — zurück zur Liste mit Hinweis |
| `conflict` | 409 | Jemand anders war schneller. Neu laden und aktuellen Stand zeigen, nicht stur wiederholen |
| `internal` | 500 | Meldung anzeigen, Details ins Browser-Log |

Zum 403-Fall: td formuliert Policy-Ablehnungen sehr präzise („du hast das
implementiert, du kannst es nicht freigeben"). Diese Meldung durch ein
generisches „Nicht erlaubt" zu ersetzen wäre der eine Fehler, der die GUI
gegenüber der CLI schlechter machen würde.

### Start- und Laufzeitfehler

Fehlendes `td`-Binary, zu alte Version ohne `serve`, kein `.todos`-Verzeichnis:
jeweils eine klare Meldung mit dem nächsten Schritt und ein Exit ungleich null.
td-gui führt **kein** `td init` von sich aus aus.

Stirbt `td serve` im Betrieb, versucht td-gui genau einen Neustart. Scheitert
der, zeigt die Oberfläche ein dauerhaftes „Backend getrennt"-Banner statt eines
ewigen Spinners. Der SSE-Reconnect deckt die Erholung danach ab.

Ist der GUI-Port belegt: bei explizitem `--port` laut scheitern, sonst den
nächsten freien nehmen.

## Tests

**Go-Unit:** Portfile-Parsing und Stale-Erkennung; Origin-Guard als
Tabellentest über erlaubte und abgelehnte Origins; Streaming-Verhalten des
Proxys (SSE darf nicht gepuffert werden).

**Contract-Test — der wichtigste.** Ein Go-Test legt ein Temp-Verzeichnis an,
fährt ein echtes `td init`, startet `td serve` und prüft, dass die JSON-Felder,
auf die das Frontend baut, tatsächlich existieren.

Begründung: Die TypeScript-Typen sind von Hand abgeschrieben, weil td's DTOs
über die Modulgrenze nicht importierbar sind. Ohne diesen Test würde eine
Umbenennung in td dazu führen, dass die Oberfläche stillschweigend `undefined`
rendert, statt dass etwas rot wird. Der Test überspringt sich selbst, wenn kein
`td` im PATH liegt, damit die Suite überall lauffähig bleibt.

**Frontend:** Vitest mit Testing Library für die Fehlerabbildung und die
SSE-Invalidierung, API gemockt per MSW.

## CLI

```
td-gui [flags]

  -p, --port int       Port für die Oberfläche (0 = frei wählen)
      --no-open        Browser nicht automatisch öffnen
      --td string      Pfad zum td-Binary (Standard: aus PATH)
  -w, --work-dir string  Projektverzeichnis
```

## Offene Punkte

- Der Go-Modulpfad ist als `github.com/madic-creates/td-gui` angenommen,
  abgeleitet aus dem Git-Nutzernamen. Vor dem ersten Commit von `go.mod`
  bestätigen.

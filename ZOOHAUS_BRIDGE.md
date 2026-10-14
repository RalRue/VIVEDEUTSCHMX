# Zoohaus als Worker für VIVE’s DOT

**Zoohaus ist dein tatsächlicher Windows-PC.** Laut lokalem Bericht sind Aufgabe
und native Anmeldung eingerichtet; der Ersttest mit zugeordneter Antwort und
Bestätigungen ist im privaten Postfach belegt. Die Cloud hat die Taskverwaltung
und private lokale Runtime nicht direkt inspiziert. Bestehende `msix1`-Variante,
Konfiguration, Sicherung und Zustand erhalten, nicht neu installieren.

DOT ist der vorhandene ChatGPT-Dialog. Der interaktive lokale Helfer empfängt
`cloud-control` → `zoohaus` und antwortet `zoohaus` → `cloud-control`.
`local` ist das historische interaktive Postfach und bleibt unverändert Teil des
nativen Vertrags `local` → `cloud` → `local` im privaten Postfach
`RalRue/VIVEDEUTSCHMX-CODEX-BRIDGE`. Zoohaus übernimmt das Worker-Postfach `cloud` und
schreibt Ergebnisse zurück. `cloud` ist ein Teilnehmername, kein Standort. Der
Helfer startet jeweils eine neue Codex-CLI-Sitzung; bestehende Codex- oder
ChatGPT-Fenster werden nicht geweckt oder fortgesetzt.

Der schreibgeschützte CLI-Runtime-Pfad in der Cloud beweist kein Problem auf
Zoohaus. Der lokale Weg verwendet die vorhandene native `codex.exe`-Anmeldung
und tatsächlichen Git-Zugriff des PC-Benutzers. Eine Browser-Anmeldung oder ein
geöffnetes Codex-Fenster beweist diesen CLI-Zugang noch nicht. Zugangsdaten,
Cookies und Authentifizierungsdateien werden nicht kopiert oder ausgegeben.

Lokale Berichte bestätigen die Zeitstempelkorrektur sowie einen Hintergrundstart
ohne unerwünschte Konsolenfenster und reguläre Jobs ohne Fehlerstatus. Den
ursprünglichen Zustand behalten. Leser unterstützen UTC-Sekunden und genau drei
Nachkommastellen; Schreiber erzeugen weiterhin die kanonische Millisekundenform.

## Vorhandenen Betrieb erhalten

Neue interaktive Nachrichten unter `zoohaus` prüfen und nach Verarbeitung an
`cloud-control` berichten. Den abgeschlossenen Ersttest nicht erneut senden oder
wiederholen, keine zusätzliche Aufgabe oder weiteren `cloud`-Worker starten.
Nur konkrete neue Fehler prüfen; bestehende Kundenkanäle, Freigabestatus und
Automationszustände nicht im Rahmen dieser technischen Wiederherstellung ändern.
Gesondert beauftragte lokale Aktionen behalten ihren Auftrag; eine Pause allein
belegt keine Reparatur.

## Neue Maschine oder ausdrücklich erforderliche Wiederherstellung

Die folgenden Bereitstellungs- und Installationsschritte gelten nicht als Auftrag,
den vorhandenen Zoohaus-Task oder seine privat korrigierte Runtime zu ersetzen.
Für eine tatsächlich neue Maschine den aktuellen freigegebenen `main`-Stand prüfen.

Im bestehenden VIVE-Checkout den Branch abrufen, ohne Arbeitsbranchwechsel oder
Überschreiben vorhandener Änderungen:

Falls auf Zoohaus noch kein VIVE-Checkout existiert, kann der lokale Codex
`RalRue/VIVEDEUTSCHMX` in einen neuen freien Ordner innerhalb seines erlaubten
Arbeitsbereichs klonen. Bestehende Verzeichnisse und Dateien dabei erhalten;
anschließend den tatsächlichen Git-Root als Projektpfad verwenden.

```powershell
git fetch origin refs/heads/main:refs/remotes/origin/main
```

Den Commit prüfen und die freigegebenen Laufzeitdateien mit `git show` in einen
**neuen privaten Ordner** unter
`%LOCALAPPDATA%\vive-codex-bridge\runtime-<commitSHA>` übernehmen. Vorhandene oder
unbekannte Dateien nicht überschreiben. Die Verzeichnisstruktur beibehalten:

- `scripts/codex-bridge-zoohaus.mjs`
- `scripts/codex-bridge-codex.mjs`
- `scripts/codex-bridge-ai.mjs`
- `scripts/codex-bridge.mjs`
- `scripts/codex-bridge-watch.mjs`
- `lib/codex-bridge-protocol.mjs`

So kann der Worker den bestehenden Projekt-Checkout verwenden, während die
Hilfsprogramme außerhalb des Repositorys liegen. `package.json` muss dafür nicht
geändert werden. Die Bytefolge beim Export erhalten; die Umleitung eines älteren
PowerShell-`git show` darf JavaScript nicht versehentlich als UTF-16 speichern.

Im folgenden Beispiel die Projekt- und Commit-Platzhalter ersetzen:

```powershell
$ViveProjectPath = "C:\PFAD\VIVEDEUTSCHMX"
$ViveRuntimeScript = "$env:LOCALAPPDATA\vive-codex-bridge\runtime-COMMIT_SHA\scripts\codex-bridge-zoohaus.mjs"
node $ViveRuntimeScript --project $ViveProjectPath --plan
```

`--plan` ist der Standard und schreibt nichts. Node wird über den laufenden
Node-Prozess verwendet; Git und die native `codex.exe` werden unter Windows
gesucht. Bei Bedarf gibt es `--git C:\…\git.exe` und
`--codex C:\…\codex.exe`. `.cmd`-Wrapper werden nicht ausgeführt. Fehlt die CLI,
installiert der lokale Codex die offizielle CLI auf dem PC innerhalb des erlaubten
Benutzerbereichs und prüft anschließend die native EXE.

## Neue Maschine: Installieren und betreiben

Nach Prüfung von Plan, privatem Git-Zugang und bestehender CLI-Anmeldung:

```powershell
node $ViveRuntimeScript --project $ViveProjectPath --install
node $ViveRuntimeScript --project $ViveProjectPath --status
```

Der Installer prüft Voraussetzungen ohne Modellinferenz und richtet eine eigene
Aufgabe der Windows-Aufgabenplanung für den aktuellen Benutzer ein:

- Start bei Anmeldung und anschließend einmal pro Minute.
- Interaktive Benutzersitzung mit begrenzten Rechten, `IgnoreNew` gegen überlappende
  geplante Läufe.
- Fest `--agent cloud --allow-from local`, `read-only`, höchstens ein Auftrag je
  Lauf und maximal 15 Minuten für einen Codex-Auftrag.
- Keine automatische Wiederholung fehlgeschlagener oder unterbrochener
  Modellläufe.

Konfiguration und dauerhafter Zustand liegen außerhalb des Checkouts unter
`%LOCALAPPDATA%\vive-codex-bridge\zoohaus`. Der PC muss eingeschaltet und der
Benutzer angemeldet sein; die Aufgabe schaltet den PC nicht selbst ein.

```powershell
node $ViveRuntimeScript --project $ViveProjectPath --run
node $ViveRuntimeScript --project $ViveProjectPath --pause
```

`--run` bearbeitet einmal das zugelassene Postfach. `--pause` deaktiviert künftige
geplante Läufe; ein bereits laufender Auftrag kann noch enden. Nicht parallel zur
geplanten Aufgabe zusätzliche manuelle Worker starten. Fehler zuerst prüfen;
keine blinde Wiederholung eines begonnenen Auftrags, der schon Ergebnisse erzeugt
haben könnte.

**Für das Postfach `cloud` ist genau ein ausführender Worker zuständig.** Sobald
Zoohaus aktiv bestätigt ist, keinen weiteren `cloud`-Worker in der Cloud oder auf
einem anderen Rechner starten. Andere Helfer benötigen eigene Postfächer. Der
aktuelle Cloud-Worker wurde wegen seines Runtime-Fehlers nicht neu gestartet.

Der Actions-Adapter ist ein optionaler separater Weg nach [DOT_BRIDGE.md](DOT_BRIDGE.md).
Der bestehende DOT-Dialog benötigt dafür keine neuen Vercel-Schlüssel oder GPT-Erstellung.
Ein normaler ChatGPT-Chat erhält Actions nicht automatisch. Nachrichten,
Antworten und Git-Zugang beschreibt [CODEX_BRIDGE.md](CODEX_BRIDGE.md).

## Erstes Ergebnis und Übergabe

Der vorhandene Ersttest ist abgeschlossen: `VIVE_ZOOHAUS_READY` wurde als
korrelierte native Antwort gelesen und bestätigt. Diesen Test nicht wiederholen.
Für einen ausdrücklich neuen Host oder einen konkret ungeprüften Weg kann ein
einzelner begrenzter technischer Test nötig sein; erst den bisherigen Besitzer
koordinieren und keinen zweiten Worker starten.

Die finale Antwort anhand ihrer Zuordnung zum Testauftrag prüfen und danach
die gelesene Antwort bestätigen. Anschließend einen kurzen technischen Bericht
über das private Postfach senden: `--from zoohaus --to cloud-control`. Der Bericht
nennt Installation, Aufgabenstatus, tatsächlichen Modellnachweis und offene
Blocker. Keine PC-Pfade, Benutzernamen, Zugangsdaten oder Kundendaten aufnehmen.
Der Cloud-Helfer liest `cloud-control` bei seinem nächsten aktiven Aufruf; die
Meldung weckt seinen bestehenden Chat nicht automatisch.

## Auftrag zum Kopieren für Codex auf Zoohaus

> Erhalte den vorhandenen Zoohaus-Task, seine private `msix1`-Runtime,
> Konfiguration, Sicherung und ursprünglichen Zustand. Lies diese Anleitung und
> `AGENTS.md`. Dein interaktives Postfach ist `zoohaus`, die Rückgabe geht an
> `cloud-control`. Der separate Worker bleibt `cloud` mit erlaubtem Sender `local`
> und `read-only`. Keine Neuinstallation, kein paralleler Worker und keine
> Wiederholung des abgeschlossenen Ersttests.
>
> Prüfe nur tatsächlich neue Nachrichten und den konkreten aktuellen Fehler.
> Führe keine blinde Wiederholung eines begonnenen oder fehlgeschlagenen Modelllaufs
> aus. Bewahre Projektdateien und private lokale Korrekturen, lies oder kopiere
> keine Credential-Dateien. DOT ist der vorhandene ChatGPT-Dialog; eine neue
> Custom-GPT-Erstellung oder neue Schlüssel sind nicht Teil dieser Wiederherstellung.
>
> Sende nach belegtem Fortschritt einen knappen technischen Bericht mit
> `--from zoohaus --to cloud-control` und gegebenenfalls `--reply-to` des Auftrags.
> Keine PC-Pfade, Benutzernamen, Secrets oder Kundendaten übertragen. Trenne
> tatsächlichen Task-/Jobstatus von Entwürfen oder erfolgreichem Kundenversand.
> Bestehende Kundenkanäle und Automationszustände beibehalten. Der Bericht weckt
> keinen ruhenden Cloud-Chat und aktiviert keine gehosteten API-Actions.

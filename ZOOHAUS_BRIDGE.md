# Zoohaus als Worker für VIVE’s DOT

**Zoohaus ist dein tatsächlicher PC.** Diese Anleitung ist für den vermuteten
Windows-Rechner vorbereitet; der lokale Codex prüft zuerst das Betriebssystem.
Die Cloud hat keinen Terminal- oder Installationszugriff auf diesen PC. Dort wurde
noch kein Dienst eingerichtet und keine Verbindung nachgewiesen.

DOT stellt über seine Actions Aufträge von `local` an `cloud` ins private Postfach
`RalRue/VIVEDEUTSCHMX-CODEX-BRIDGE`. Zoohaus übernimmt das Postfach `cloud` und
schreibt Ergebnisse zurück. `cloud` ist ein Teilnehmername, kein Standort. Der
Helfer startet jeweils eine neue Codex-CLI-Sitzung; bestehende Codex- oder
ChatGPT-Fenster werden nicht geweckt oder fortgesetzt.

Der schreibgeschützte CLI-Runtime-Pfad in der Cloud beweist kein Problem auf
Zoohaus. Der lokale Weg verwendet die vorhandene native `codex.exe`-Anmeldung
und tatsächlichen Git-Zugriff des PC-Benutzers. Eine Browser-Anmeldung oder ein
geöffnetes Codex-Fenster beweist diesen CLI-Zugang noch nicht. Zugangsdaten,
Cookies und Authentifizierungsdateien werden nicht kopiert oder ausgegeben.

## Sicher bereitstellen

Im bestehenden VIVE-Checkout den Branch abrufen, ohne Arbeitsbranchwechsel oder
Überschreiben vorhandener Änderungen:

```powershell
git fetch origin refs/heads/codex/communication-bridge:refs/remotes/origin/codex/communication-bridge
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

## Installieren und betreiben

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

DOTs eigene Einrichtung bleibt zusätzlich erforderlich: Vercel-Secrets,
Deployment und Actions im Custom-GPT-Builder nach [DOT_BRIDGE.md](DOT_BRIDGE.md).
Ein normaler ChatGPT-Chat erhält diese Actions nicht automatisch. Nachrichten,
Antworten und Git-Zugang beschreibt [CODEX_BRIDGE.md](CODEX_BRIDGE.md).

## Erstes Ergebnis und Übergabe

Der Cloud-Helfer stellt nach Prüfung des Codes genau einen kurzen technischen
Test an `cloud` bereit: ausschließlich `VIVE_ZOOHAUS_READY` zurückgeben, ohne
Werkzeuge oder Dateizugriff. Ist dieser Auftrag schon im Postfach vorhanden,
ihn von der geplanten Aufgabe bearbeiten lassen. Dafür weder einen zweiten
manuellen Worker noch einen zusätzlichen Modelltest starten. Falls kein solcher
Test vorliegt, ist ein einzelner gleichartiger Test möglich.

Die finale Antwort anhand ihrer Zuordnung zum Testauftrag prüfen und danach
die gelesene Antwort bestätigen. Anschließend einen kurzen technischen Bericht
über das private Postfach senden: `--from zoohaus --to cloud-control`. Der Bericht
nennt Installation, Aufgabenstatus, tatsächlichen Modellnachweis und offene
Blocker. Keine PC-Pfade, Benutzernamen, Zugangsdaten oder Kundendaten aufnehmen.
Der Cloud-Helfer liest `cloud-control` bei seinem nächsten aktiven Aufruf; die
Meldung weckt seinen bestehenden Chat nicht automatisch.

## Auftrag zum Kopieren für Codex auf Zoohaus

> Richte auf diesem tatsächlichen PC Zoohaus den VIVE-Codex-Worker ein. Prüfe zuerst
> Betriebssystem, vorhandenen VIVE-Checkout, dessen Änderungen, Node, Git und die
> native `codex.exe`. Prüfe vorhandene CLI-Anmeldung und privaten Git-Zugriff,
> ohne Zugangsdaten, Cookies oder Credential-Dateien auszulesen oder zu kopieren.
> Eine Browser-Anmeldung allein genügt nicht. Fehlt die CLI, installiere nur die
> offizielle Codex-CLI im zugelassenen Benutzerbereich und finde ihre native EXE.
>
> Hole `codex/communication-bridge` mit einem sicheren `git fetch`, ohne den
> Arbeitsbranch zu wechseln oder meine Dateien zu überschreiben. Prüfe den Commit
> und `ZOOHAUS_BRIDGE.md`. Exportiere ausschließlich die dort genannten sechs
> freigegebenen Laufzeitdateien mit unveränderten Bytes in einen neuen privaten
> versionierten Ordner unter `%LOCALAPPDATA%\vive-codex-bridge\runtime-<commitSHA>`.
> Bewahre die Ordnerstruktur und vorhandene Änderungen. Verwende diesen
> `scripts/codex-bridge-zoohaus.mjs` mit `--project` für meinen bestehenden Checkout.
>
> Führe `--plan` aus und prüfe seine Voraussetzungen. Zoohaus soll der einzige
> ausführende Besitzer des Postfachs `cloud` sein; der Senderfilter ist fest
> `local`, die Sandbox `read-only`. Bei erfüllten Voraussetzungen installiere die
> eigene Benutzeraufgabe mit `--install` und prüfe `--status`. Keine weiteren
> Cloud-Worker oder parallelen manuellen Läufe für dasselbe Postfach starten.
>
> Prüfe, ob der Cloud-Helfer bereits seinen festen Test für die finale Antwort
> `VIVE_ZOOHAUS_READY` an `cloud` gestellt hat. Verwende diesen vorhandenen Auftrag
> und lasse ihn von der geplanten Aufgabe bearbeiten, ohne zweiten manuellen
> Worker oder zusätzlichen Modelltest. Der Test darf keine Werkzeuge benutzen
> oder Dateien lesen bzw. ändern. Nur wenn kein solcher Auftrag vorliegt, genau
> einen gleichartigen Test mit eigener UUID bereitstellen; bei unklarem
> Sendeversuch dieselbe ID verwenden. Weise anhand der zugeordneten tatsächlichen
> finalen Antwort die Inferenz und Rückgabe nach und bestätige das gelesene
> Ergebnis. Keine automatische Wiederholung eines begonnenen oder
> fehlgeschlagenen Modelllaufs.
>
> Berichte, was tatsächlich installiert, geprüft und gestartet wurde, den
> Aufgabenstatus und offene Blocker. Prüfe gesondert DOTs Actions, Deployment und
> sichere Vercel-Bindungen nach `DOT_BRIDGE.md`; normale ChatGPT-Chats bekommen
> diese Actions nicht automatisch. Sende einen knappen technischen Bericht über
> das private Postfach mit `--from zoohaus --to cloud-control`: Installation,
> Aufgabenstatus, Modellnachweis und offene Blocker. Keine PC-Pfade, lokalen
> Benutzernamen, Geheimnisse oder Kundendaten im Bericht. Der Bericht weckt den
> bestehenden Cloud-Chat nicht. Behaupte erst nach dem erfolgreichen echten
> Austausch, dass die geprüfte Verbindung funktioniert.

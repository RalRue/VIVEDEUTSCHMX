# VIVE Prüfungen

Die Website und APIs benötigen nur Node.js-Bordmittel. `npm run build` führt die
öffentlichen Website-, Datenschutz-, Anfrage-, Trainer- und Einstufungsprüfungen
aus. Für Änderungen an den Kommunikationswerkzeugen zusätzlich
`npm run test:bridge` ausführen. Die Bridgeprüfungen verwenden lokale Git-Repos,
Provider-Stubs und simulierte Betriebssystemaufrufe; sie starten keine echten
Modelle und installieren keine Dienste.

`npm run test:inquiry:browser` prüft zusätzlich den echten Chromium-Ablauf über
einen lokalen Testserver: Eingabekorrektur, native neue Tabs, mehrere Anfragen,
HttpOnly-Zugang, Zugriffssperre für Messskripte und den isolierten Fensterwechsel.
Er öffnet außerdem einen persönlichen Einstufungslink über eine simulierte
fremde App in einem separaten Browserkontext ohne Cookies und prüft die echte
Testoberfläche bis zur synthetisch bestätigten, zugeordneten Abgabe. Die
allgemeine Vorschau darf nicht senden; der Cookiezugang funktioniert im fremden
Kontext nicht. Persönliche Links werden nur mit einem lokalen Testschlüssel
erzeugt und nie ausgegeben. Ein rein lesender Serveraufruf prüft Signatur und
Restdauer vor dem Start; er kontaktiert den privaten Empfänger nicht. Die
UI-Prüfungen decken den Ablauf vor Testbeginn, während der Bearbeitung und nach
einem unbestätigten Sendeversuch ab, außerdem falsche Geräteuhren und die
Wiederholung einer fehlgeschlagenen Zugangsprüfung ohne Antwortversand.
Hierfür ist lokal Chromium nötig; mit `VIVE_CHROMIUM_BINARY` lässt sich dessen
Pfad angeben. Der Test benutzt synthetische Speicherung, fängt die optionalen
Messskripte ab und blockiert externe Hostauflösung. Er erzeugt keine echten
Anfragen oder Providerereignisse. Der öffentliche Build benötigt keinen Browser.

Die private Apps-Script-Quelle gehört nicht ins öffentliche Repository. Ihre
Integrationsprüfungen werden gesondert ausgeführt:

```bash
VIVE_PRIVATE_RECEIVER_PATH=/ABS/PRIVATE/Code.gs npm run test:inquiry:private
VIVE_PRIVATE_RECEIVER_PATH=/ABS/PRIVATE/Code.gs npm run test:placement:private
```

Der Pfad muss absolut sein und auf die tatsächlich zu prüfende aktuelle Quelle
zeigen. Vorher deren Prüfsumme und Zuordnung zur aktiven Scriptversion abgleichen.
Ein explizit gesetzter fehlender Pfad lässt die Prüfung fehlschlagen. Ohne
Override bleibt der historische relative Standardpfad erhalten; der öffentliche
Build überspringt die private Inquiryintegration bei fehlender Quelle, die
expliziten privaten Prüfbefehle verlangen sie dagegen immer.

Grüne öffentliche Tests bestätigen keine private Speicherung oder Providerzustellung.
Historische Receiverdateien nicht als Ersatz für den heutigen Stand unter den
erwarteten Pfad kopieren. Die privaten Tests führen den Quelltext ausschließlich
mit synthetischen Tabellen, Properties und Mailfunktionen aus.

Die gemeinsamen Utilities-Fixtures in `scripts/synthetic-utilities.cjs` erhalten
das von Apps Script gelieferte Base64-Padding und bilden signierte HMAC-Bytes ab.
Der öffentliche Build prüft sie gegen die Beispiele der Utilities-Referenz und
einen RFC-4231-Vektor. Die private Placementprüfung verlangt zusätzlich für alle
vier bestehenden Ausgabewege (Website TEST/INQUIRY und WhatsApp TEST/live) einen
Token ohne Padding, der zur Browserfragmentprüfung passt und exakt die angefragte
Anfrage-ID, TEST/live-Identität sowie Version bindet. Zusätzliche Kontakt- oder
private Quellfelder sind in den Tokenclaims unzulässig. Ein vom Server lesbarer
Token allein belegt diesen Linkvertrag nicht. Bei einem getrennten öffentlichen
Testpaket muss auch `scripts/synthetic-utilities.cjs` aus demselben Release
enthalten sein. Ein Fehlschlag mit der aktuellen privaten Quelle wird konkret
untersucht; der Mock entfernt das Padding nicht stellvertretend für den Receiver.

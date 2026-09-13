# VIVE Reply Assistant - sicherer Betrieb

## Aktueller Stand

`/api/reply-assistant` erzeugt ausschliesslich Entwuerfe. Es gibt keinen Versand an Facebook, Instagram oder WhatsApp. Jede Antwort bleibt in `review_only`; `can_send_automatically_now` ist immer `false`.

## Private Vercel-Variablen

- `OPENAI_API_KEY`: nur serverseitig
- `VIVE_REPLY_ADMIN_TOKEN`: langer zufaelliger interner Zugangsschluessel
- `VIVE_REPLY_AI_ENABLED`: `true` aktiviert Entwuerfe, alles andere schaltet sie aus
- `VIVE_REPLY_MODEL`: optional, Standard `gpt-5.4-mini`
- `VIVE_REPLY_AUTO_SEND_ENABLED`: reservierter globaler Ausschalter; Auto-Senden ist noch nicht implementiert

Keine dieser Variablen darf mit `NEXT_PUBLIC_`, `VITE_` oder aehnlichen Browser-Praefixen angelegt werden.

## Sicherheitsprinzipien

- Kein Kundentext wird von dieser Funktion protokolliert oder an GA4 gesendet.
- OpenAI-Aufrufe verwenden `store: false`.
- Nachrichten sind auf 2.000 Zeichen begrenzt.
- Die API benoetigt `Authorization: Bearer <VIVE_REPLY_ADMIN_TOKEN>`.
- Feste Regeln heben Preise, Termine, Gruppen, Minderjaehrige, Beschwerden sowie Rechts- und Dokumentenfragen mindestens auf menschliche Pruefung.
- Unklare Faelle erhalten nur einen neutralen Entwurf.

## Naechste Ausbaustufe

1. Dauerhafte, zugriffsgeschuetzte Freigabeschlange einrichten.
2. Interne Bedienoberflaeche mit Bearbeiten, Freigeben und Ablehnen verbinden.
3. Meta-Webhooks und WhatsApp Business Platform nur als Eingang anbinden.
4. Versand erst nach echten Testfaellen und ausdruecklicher Freigabe implementieren.

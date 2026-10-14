
        const vocabulary = [
            { es: "a partir de", de: "ab", category: "Vida diaria", level: "A1" },
            { es: "pero", de: "aber", category: "Vida diaria", level: "A1" },
            { es: "la dirección", de: "die Adresse", category: "Vida diaria", level: "A1" },
            { es: "solo", de: "allein", category: "Vida diaria", level: "A1" },
            { es: "viejo", de: "alt", category: "Vida diaria", level: "A1" },
            { es: "ofrecer", de: "anbieten", category: "Verbos", level: "A1" },
            { es: "empezar", de: "anfangen / beginnen", category: "Verbos", level: "A1" },
            { es: "llegar", de: "ankommen", category: "Verbos", level: "A1" },
            { es: "llamar por teléfono", de: "anrufen", category: "Verbos", level: "A1" },
            { es: "la llamada", de: "der Anruf", category: "Vida diaria", level: "A1" },
            { es: "la respuesta", de: "die Antwort", category: "Aprendizaje", level: "A1" },
            { es: "trabajar", de: "arbeiten", category: "Verbos", level: "A1" },
            { es: "la farmacia", de: "die Apotheke", category: "Vida diaria", level: "A1" },
            { es: "la manzana", de: "der Apfel", category: "Vida diaria", level: "A1" },
            { es: "la estación", de: "der Bahnhof", category: "Viajes", level: "A1" },
            { es: "el formulario", de: "das Formular", category: "Alemania", level: "A1" },
            { es: "el dinero", de: "das Geld", category: "Vida diaria", level: "A1" },
            { es: "la casa", de: "das Haus", category: "Vida diaria", level: "A1" },
            { es: "comprar", de: "kaufen", category: "Verbos", level: "A1" },
            { es: "leer", de: "lesen", category: "Verbos", level: "A1" },
            { es: "aprender", de: "lernen", category: "Aprendizaje", level: "A1" },
            { es: "la ciudad", de: "die Stadt", category: "Vida diaria", level: "A1" },
            { es: "la clase", de: "der Unterricht", category: "Aprendizaje", level: "A1" },
            { es: "vivir", de: "wohnen", category: "Verbos", level: "A1" },

            { es: "entregar", de: "abgeben", category: "Verbos", level: "A2" },
            { es: "recoger", de: "abholen", category: "Verbos", level: "A2" },
            { es: "cerrar con llave", de: "abschließen", category: "Verbos", level: "A2" },
            { es: "cambiar", de: "ändern", category: "Verbos", level: "A2" },
            { es: "el miedo", de: "die Angst", category: "Emociones", level: "A2" },
            { es: "registrarse", de: "sich anmelden", category: "Alemania", level: "A2" },
            { es: "la conexión", de: "der Anschluss", category: "Viajes", level: "A2" },
            { es: "mirar", de: "ansehen", category: "Verbos", level: "A2" },
            { es: "responder", de: "antworten", category: "Verbos", level: "A2" },
            { es: "el traje", de: "der Anzug", category: "Vida diaria", level: "A2" },
            { es: "la formación profesional", de: "die Ausbildung", category: "Alemania", level: "A2" },
            { es: "el extranjero", de: "das Ausland", category: "Alemania", level: "A2" },
            { es: "la autoridad", de: "die Behörde", category: "Alemania", level: "A2" },
            { es: "solicitar", de: "beantragen", category: "Alemania", level: "A2" },
            { es: "pagar", de: "bezahlen", category: "Vida diaria", level: "A2" },
            { es: "el billete / el boleto", de: "die Fahrkarte", category: "Viajes", level: "A2" },
            { es: "el equipaje", de: "das Gepäck", category: "Viajes", level: "A2" },
            { es: "la salud", de: "die Gesundheit", category: "Vida diaria", level: "A2" },
            { es: "casado", de: "verheiratet", category: "Vida diaria", level: "A2" },
            { es: "la vivienda", de: "die Wohnung", category: "Vida diaria", level: "A2" },
            { es: "la moneda", de: "die Währung", category: "Alemania", level: "A2" },
            { es: "importante", de: "wichtig", category: "Vida diaria", level: "A2" },
            { es: "la revista", de: "die Zeitschrift", category: "Vida diaria", level: "A2" },
            { es: "satisfecho", de: "zufrieden", category: "Emociones", level: "A2" },

            { es: "girar", de: "abbiegen", category: "Viajes", level: "B1" },
            { es: "la imagen", de: "die Abbildung", category: "Aprendizaje", level: "B1" },
            { es: "la aventura", de: "das Abenteuer", category: "Vida diaria", level: "B1" },
            { es: "depender", de: "abhängen", category: "Verbos", level: "B1" },
            { es: "dependiente", de: "abhängig", category: "Vida diaria", level: "B1" },
            { es: "rechazar", de: "ablehnen", category: "Verbos", level: "B1" },
            { es: "cancelar", de: "absagen", category: "Verbos", level: "B1" },
            { es: "la finalización", de: "der Abschluss", category: "Alemania", level: "B1" },
            { es: "el remitente", de: "der Absender", category: "Alemania", level: "B1" },
            { es: "la intención", de: "die Absicht", category: "Vida diaria", level: "B1" },
            { es: "votar", de: "abstimmen", category: "Verbos", level: "B1" },
            { es: "el departamento", de: "die Abteilung", category: "Trabajo", level: "B1" },
            { es: "ausente", de: "abwesend", category: "Vida diaria", level: "B1" },
            { es: "prestar atención", de: "achten auf", category: "Verbos", level: "B1" },
            { es: "el cubo de basura / el bote de basura", de: "der Abfalleimer", category: "Vida diaria", level: "B1" },
            { es: "sacar dinero", de: "abheben", category: "Vida diaria", level: "B1" },
            { es: "la suscripción", de: "das Abonnement", category: "Vida diaria", level: "B1" },
            { es: "la basura", de: "der Abfall", category: "Medio ambiente", level: "B1" },
            { es: "los gases de escape", de: "die Abgase", category: "Medio ambiente", level: "B1" },
            { es: "la confianza", de: "das Vertrauen", category: "Emociones", level: "B1" },
            { es: "la reunión", de: "das Treffen", category: "Vida diaria", level: "B1" },
            { es: "el punto", de: "der Punkt", category: "Aprendizaje", level: "B1" },
            { es: "el camino", de: "der Weg", category: "Viajes", level: "B1" },
            { es: "cerrar", de: "schließen", category: "Verbos", level: "B1" },
            { es: "subir", de: "einsteigen", category: "Viajes", level: "A1" },
            { es: "la entrada", de: "der Eintritt", category: "Vida diaria", level: "A1" },
            { es: "los padres", de: "die Eltern", category: "Vida diaria", level: "A1" },
            { es: "recomendar", de: "empfehlen", category: "Verbos", level: "A1" },
            { es: "terminar", de: "enden", category: "Verbos", level: "A1" },
            { es: "disculpar", de: "entschuldigen", category: "Verbos", level: "A1" },
            { es: "el resultado", de: "das Ergebnis", category: "Aprendizaje", level: "A1" },
            { es: "explicar", de: "erklären", category: "Verbos", level: "A1" },
            { es: "permitir", de: "erlauben", category: "Verbos", level: "A1" },
            { es: "el adulto", de: "der Erwachsene", category: "Vida diaria", level: "A1" },
            { es: "contar", de: "erzählen", category: "Verbos", level: "A1" },
            { es: "conducir / ir en vehículo", de: "fahren", category: "Viajes", level: "A1" },
            { es: "la bicicleta", de: "das Fahrrad", category: "Viajes", level: "A1" },
            { es: "falso", de: "falsch", category: "Aprendizaje", level: "A1" },
            { es: "el apellido", de: "der Familienname / der Nachname", category: "Alemania", level: "A1" },
            { es: "el color", de: "die Farbe", category: "Vida diaria", level: "A1" },
            { es: "celebrar", de: "feiern", category: "Vida diaria", level: "A1" },
            { es: "faltar", de: "fehlen", category: "Verbos", level: "A1" },
            { es: "el error", de: "der Fehler", category: "Aprendizaje", level: "A1" },
            { es: "ver televisión", de: "fernsehen", category: "Vida diaria", level: "A1" },
            { es: "listo / terminado", de: "fertig", category: "Vida diaria", level: "A1" },
            { es: "la fiebre", de: "das Fieber", category: "Vida diaria", level: "A1" },
            { es: "la empresa", de: "die Firma", category: "Trabajo", level: "A1" },
            { es: "poner de pie / colocar", de: "stellen", category: "Verbos", level: "A2" },
            { es: "la calle", de: "die Straße", category: "Vida diaria", level: "A1" },
            { es: "el tranvía", de: "die Straßenbahn", category: "Viajes", level: "A1" },
            { es: "estudiar en la universidad", de: "studieren", category: "Alemania", level: "A1" },
            { es: "la bolsa", de: "die Tasche", category: "Vida diaria", level: "A1" },
            { es: "el tema", de: "das Thema", category: "Aprendizaje", level: "A1" },
            { es: "encontrarse", de: "sich treffen", category: "Verbos", level: "A1" },
            { es: "la escalera", de: "die Treppe", category: "Vida diaria", level: "A1" },
            { es: "pasar la noche", de: "übernachten", category: "Viajes", level: "A2" },
            { es: "transferir dinero", de: "überweisen", category: "Alemania", level: "A2" },
            { es: "mudarse", de: "umziehen", category: "Vida diaria", level: "A2" }
        ];

        const directionSelect = document.getElementById("direction");
        const categorySelect = document.getElementById("category");
        const levelSelect = document.getElementById("level");
        const modeSelect = document.getElementById("mode");
        const promptLabel = document.getElementById("promptLabel");
        const promptWord = document.getElementById("promptWord");
        const categoryBadge = document.getElementById("categoryBadge");
        const answerInput = document.getElementById("answer");
        const checkBtn = document.getElementById("checkBtn");
        const nextBtn = document.getElementById("nextBtn");
        const feedback = document.getElementById("feedback");
        const doneEl = document.getElementById("done");
        const rightEl = document.getElementById("right");
        const wrongEl = document.getElementById("wrong");
        const accuracyEl = document.getElementById("accuracy");

        let current = null;
        let currentDirection = "es-de";
        let answered = false;
        let stats = { done: 0, right: 0, wrong: 0 };

        function normalize(value) {
            return value
                .toLowerCase()
                .trim()
                .replace(/ä/g, "ae")
                .replace(/ö/g, "oe")
                .replace(/ü/g, "ue")
                .replace(/ß/g, "ss")
                .normalize("NFD")
                .replace(/[\u0300-\u036f]/g, "")
                .replace(/[.,;:!?¿¡]/g, "")
                .replace(/\s+/g, " ");
        }

        function fillCategories() {
            const categories = [...new Set(vocabulary.map(item => item.category))].sort();
            categories.forEach(category => {
                const option = document.createElement("option");
                option.value = category;
                option.textContent = category;
                categorySelect.appendChild(option);
            });
        }

        function filteredVocabulary() {
            const selected = categorySelect.value;
            const level = levelSelect.value;
            return vocabulary.filter(item => {
                const categoryMatch = selected === "all" || item.category === selected;
                const levelMatch = level === "all" || item.level === level;
                return categoryMatch && levelMatch;
            });
        }

        function pickDirection() {
            if (directionSelect.value !== "mixed") return directionSelect.value;
            return Math.random() > 0.5 ? "es-de" : "de-es";
        }

        function nextCard() {
            const pool = filteredVocabulary();
            if (!pool.length) {
                current = null;
                checkBtn.disabled = true;
                promptLabel.textContent = "Selección";
                promptWord.textContent = "-";
                categoryBadge.textContent = "vacío";
                feedback.className = "feedback";
                feedback.textContent = "Todavía no hay vocabulario para esta combinación.";
                return;
            }
            current = pool[Math.floor(Math.random() * pool.length)];
            answered = false;
            checkBtn.disabled = false;
            currentDirection = pickDirection();
            const from = currentDirection === "es-de" ? "es" : "de";
            promptLabel.textContent = currentDirection === "es-de" ? "Español" : "Alemán";
            promptWord.textContent = current[from];
            categoryBadge.textContent = current.category;
            answerInput.value = "";
            feedback.className = "feedback";
            feedback.textContent = modeSelect.value === "flashcard"
                ? "Piensa un momento y luego pulsa Revisar para ver la solución."
                : "Escribe la traducción adecuada.";
            answerInput.disabled = modeSelect.value === "flashcard";
            answerInput.placeholder = modeSelect.value === "flashcard" ? "Modo tarjeta" : "Escribe tu respuesta";
            if (!answerInput.disabled) answerInput.focus();
        }

        function checkAnswer() {
            if (!current || answered) return;
            const target = currentDirection === "es-de" ? current.de : current.es;

            if (modeSelect.value === "flashcard") {
                answered = true;
                checkBtn.disabled = true;
                stats.done += 1;
                feedback.className = "feedback";
                feedback.textContent = `Solución: ${target}`;
                updateStats();
                return;
            }

            const typed = normalize(answerInput.value);
            if (!typed) {
                feedback.className = "feedback bad";
                feedback.textContent = "Escribe una respuesta antes de revisar.";
                return;
            }
            const expected = [target, ...target.split(/\s*\/\s*/)].map(normalize);
            answered = true;
            checkBtn.disabled = true;
            stats.done += 1;

            if (expected.includes(typed)) {
                stats.right += 1;
                feedback.className = "feedback good";
                feedback.textContent = `Correcto: ${target}`;
            } else {
                stats.wrong += 1;
                feedback.className = "feedback bad";
                feedback.textContent = `Repasa una vez más. La respuesta correcta es: ${target}`;
            }
            updateStats();
        }

        function updateStats() {
            doneEl.textContent = stats.done;
            rightEl.textContent = stats.right;
            wrongEl.textContent = stats.wrong;
            const assessed = stats.right + stats.wrong;
            accuracyEl.textContent = assessed ? `${Math.round((stats.right / assessed) * 100)}%` : "0%";
        }

        checkBtn.addEventListener("click", checkAnswer);
        nextBtn.addEventListener("click", nextCard);
        answerInput.addEventListener("keydown", event => {
            if (event.key === "Enter") checkAnswer();
        });
        directionSelect.addEventListener("change", nextCard);
        categorySelect.addEventListener("change", nextCard);
        levelSelect.addEventListener("change", nextCard);
        modeSelect.addEventListener("change", nextCard);

        document.getElementById("course-inquiry").addEventListener("click", () => {
            if (window.viveConsent?.allows("analytics") && typeof window.gtag === "function") window.gtag("event", "learning_group_inquiry_clicked", {trainer: "vocabulary"});
        });

        fillCategories();
        updateStats();
        nextCard();
    
# Dokumentacja Architektury Wieloagentowej (Pi Multi-Agent Orchestrator)

System wieloagentowy **Pi Antigravity Orchestrator** to zaawansowana warstwa koordynacji agentów AI przeznaczona do zadań programistycznych (General Software Engineering).

---

## 1. Architektura i Koncepcja

System składa się z trzech kluczowych ról:

```
                  ┌─────────────────────────────────────┐
                  │          MASTER AGENT               │
                  │   (np. antigravity / Claude / GPT)  │
                  │   - Architektura i planowanie       │
                  │   - Podział zadań i integracja      │
                  │   - Przegląd diffów i akceptacja    │
                  └──────────────────┬──────────────────┘
                                     │
                 ┌───────────────────┴───────────────────┐
                 │                                       │
                 ▼                                       ▼
  ┌──────────────────────────────┐       ┌──────────────────────────────┐
  │         WORKER AGENT         │       │      SECURITY AUDITOR        │
  │ (google-antigravity-2 / 3)   │       │       (xAI Grok / inne)      │
  │ - Izolowane Git worktree     │       │ - Skan wycieków sekretów     │
  │ - Badanie błędów / logów     │       │ - Skan komend powłoki        │
  │ - Pisanie testów jednostk.   │       │ - Sprawdzanie reguł OWASP    │
  │ - Generowanie patchy/diffów  │       │ - Weryfikacja bezpieczeństwa │
  └──────────────┬───────────────┘       └───────────────┬──────────────┘
                 │                                       │
                 └───────────────────┬───────────────────┘
                                     │
                                     ▼
                  ┌─────────────────────────────────────┐
                  │    REAL-TIME QUOTA & RATE LIMITS    │
                  │   - Limity 5h dla każdego konta %   │
                  │   - Limity tygodniowe %             │
                  │   - Czasy do resetu (odliczanie)    │
                  └─────────────────────────────────────┘
```

---

## 2. Podział Ról

### Master Agent (`master`)
* Odpowiedzialny za całościowy cel programistyczny użytkownika.
* Ocenia **ekonomię delegacji**: zleca zadania workerom tylko wtedy, gdy wartość podzadania przewyższa narzut koordynacyjny (`estimated_worker_value > delegation_overhead`).
* Posiada wyłączne prawo do włączania kodu do głównego repozytorium (`approve`).

### Worker Agent (`worker`)
* Otrzymuje ściśle zdefiniowane, odizolowane zadania (np. badanie logów błędów, pisanie testów jednostkowych, tworzenie pomocniczego modułu).
* Działa w dedykowanym **Git worktree** (`.pi/worktrees/<task_id>`), dzięki czemu nie koliduje z pracą Mastera ani z plikami projektu.
* Po zakończeniu generuje strukturalny raport, wyniki testów oraz czysty git diff.

### Security Auditor (`security_auditor`)
* Dedykowany agent (domyślnie **xAI Grok** lub wybrane konto Antigravity), który niezależnie audytuje wygenerowane zmiany pod kątem bezpieczeństwa:
  * Skanuje w poszukiwaniu kluczy API, tokenów OAuth, kluczy SSH.
  * Sprawdza niebezpieczne komendy powłoki (`rm -rf`, potoki sieciowe `curl | sh`, wstrzykiwanie zmiennych).
  * Blokuje próby modyfikacji plików wrażliwych (`.env`, `auth.json`, `credentials.json`).
  * Jeśli zostaną wykryte krytyczne problemy, oznacza zadanie jako `SECURITY_FAILED` – Master ma zablokowaną możliwość scalenia takiego kodu bez usunięcia zagrożeń.

---

## 3. Zarządzanie Limitami i Kontami (Quota Tracker)

System stale monitoruje zużycie zapytań dla wszystkich skonfigurowanych kont:
* **Konto 1**: `antigravity` (Google Antigravity #1)
* **Konto 2**: `google-antigravity-2` (Google Antigravity #2, "liam")
* **Konto 3**: `google-antigravity-3` (Google Antigravity #3, "3")
* **Konto 4**: `xai` (xAI Grok Platform)

Dla każdego konta Antigravity w czasie rzeczywistym pobierane są:
* **Limit 5-godzinny**: Pozostały procent zapytań oraz dokładny czas do resetu (np. `90% w 2h 35m`).
* **Limit tygodniowy**: Pozostały procent oraz czas resetu (np. `97% w 6d 21h`).

---

## 4. Szybki Start

### Uruchomienie Dashboardu na żywo:
```bash
pi-orchestrator
```
Klawisze w Dashboardzie:
* `[M]` – zmiana konta Master
* `[W]` – przełączanie workerów
* `[S]` – konfiguracja audytora bezpieczeństwa
* `[R]` – odświeżenie limitów z API
* `[T]` – nowe zadanie główne
* `[D]` – delegacja podzadania
* `[Q]` – wyjście

### Podgląd limitów z wiersza poleceń:
```bash
pi-orchestrator quotas
```

### Praca w sesji Pi:
```text
/task "Refaktoryzacja warstwy dostępu do bazy danych PostgreSQL"
/delegate "Napisz testy jednostkowe mockujące połączenie z bazą"
/diff worker-001
/approve worker-001
```

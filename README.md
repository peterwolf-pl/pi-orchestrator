# Pi Antigravity Multi-Agent Coding Orchestrator

Zaawansowane rozszerzenie wieloagentowe (Multi-Agent Extension) dla **Pi Coding Agent** wspierające pracę z wieloma kontami AI (**3x Google Antigravity + xAI Grok**), monitorowaniem limitów (5h i tygodniowych) w czasie rzeczywistym, dedykowanym **Audytorem Bezpieczeństwa** oraz interaktywnym **Dashboardem TUI** w terminalu.

---

## 🚀 Główne Możliwości (Features)

1. **Obsługa Wielu Kont (Multi-Account Pool)**:
   - Dynamiczne wykrywanie wszystkich kont z `~/.pi/agent/auth.json` i `~/.pi/agent/multi-pass.json` (np. `antigravity`, `google-antigravity-2`, `google-antigravity-3`, `xai`).
   - Elastyczny podział ról: **MASTER** (koordynator architektury), **WORKER** (wykonawca podzadań w izolacji), **AUDITOR** (strażnik bezpieczeństwa kodu).

2. **Monitor Limitów 5-Godzinnych i Tygodniowych (Real-Time Quota Tracking)**:
   - Odczyt na żywo bezpośrednio z Google Cloud Code Assist i xAI.
   - Wyświetlanie zużycia limitu **5-godzinnego (5h)** oraz **tygodniowego (Weekly)** w procentach.
   - Dokładny czas pozostały do resetu limitów (np. `reset in 2h 35m`, `reset in 6d 21h`).
   - Kolorowe wskaźniki stanu i paski postępu (`[████████--] 89%`).

3. **Dedykowany Agent Bezpieczeństwa (Security Auditor)**:
   - Automatyczny skan wygenerowanego kodu/diffu przed zatwierdzeniem przez Mastera.
   - Wykrywanie wycieków kluczy i sekretów (AWS Access Keys, API Keys, tokeny GitHub/JWT, klucze SSH).
   - Wykrywanie niebezpiecznych poleceń powłoki (`rm -rf /`, `curl | bash`, wstrzykiwanie komend, `eval`).
   - Ochrona plików poufnych (`.env`, `credentials.json`, `auth.json`, klucze prywatne).
   - Klasyfikacja podatności wg OWASP i blokowanie niebezpiecznych zmian (`SECURITY_FAILED`).

4. **Izolacja w Git Worktrees (Zero-Conflict Workspaces)**:
   - Każde podzadanie workera wykonuje się w odrębnym drzewie roboczym (`.pi/worktrees/<task_id>`).
   - Worker nigdy nie nadpisuje bezpośrednio plików Mastera.
   - Master wymaga jawnego przeglądu diffu (`/diff` lub `get_worker_diff`) oraz zatwierdzenia (`/approve`).

5. **Interaktywny Dashboard TUI w Terminalu**:
   - Odświeżanie na żywo w jednym oknie terminala.
   - Skróty klawiszowe do natychmiastowej zmiany konfiguracji w locie (`[M]`, `[W]`, `[S]`, `[R]`, `[T]`, `[D]`, `[Q]`).

---

## 📦 Instalacja

Rozszerzenie instaluje się w Pi jednym poleceniem:
```bash
pi install /sciezka/do/packages/pi-orchestrator
```

Globalna binarka CLI (`pi-orchestrator`) instaluje się poprzez:
```bash
npm install -g ./packages/pi-orchestrator
```

---

## 🖥️ Interaktywny Dashboard TUI

Uruchomienie interaktywnego panelu w terminalu:
```bash
pi-orchestrator
# lub
pi-orchestrator dashboard
```

```text
┌────────────────────────────────────────────────────────────────────────────┐
│ PI MULTI-AGENT CODING ORCHESTRATOR │ Antigravity & xAI & Security        │
├────────────────────────────────────────────────────────────────────────────┤
│ ACCOUNTS & REAL-TIME QUOTAS (5H / WEEKLY LIMITS)                           │
│                                                                            │
│   AUDITOR          xai                                                     │
│      └─ OAuth Token: Active (Reset: in 5h 24m)                             │
│   MASTER           antigravity (liamprssn@gmail.com)                       │
│      └─ 5H [███████-]  90% (5h: in 2h 35m) │ WK [████████]  97% (wk: in 6d)│
│   WORKER           google-antigravity-2 (liam)                             │
│      └─ 5H [████████] 100% (5h: in 5h 0m)  │ WK [████████] 100% (wk: ready)│
│   WORKER           google-antigravity-3 (3)                                │
│      └─ 5H [███████-]  90% (5h: in 2h 35m) │ WK [████████]  97% (wk: in 6d)│
├────────────────────────────────────────────────────────────────────────────┤
│ SECURITY AUDITOR INSPECTION                                                │
│                                                                            │
│   Status  : ACTIVE (Assigned account: xai)                                 │
│   Checks  : Secrets / Keys Leakage │ Shell Injection │ OWASP & Permissions │
│   Latest  : Task worker-002 -> PASSED [CLEAN]: All security checks passed  │
├────────────────────────────────────────────────────────────────────────────┤
│ MAIN CODING OBJECTIVE                                                      │
│                                                                            │
│   ▶ Fullstack TypeScript authentication service with Redis rate limiting   │
│     Master (antigravity): Analyzing codebase / delegating work             │
├────────────────────────────────────────────────────────────────────────────┤
│ DELEGATED SUBTASKS & WORKTREE ISOLATION                                    │
│                                                                            │
│   worker-001  antigravity2     Investigate module deps   COMPLETED         │
│   worker-002  google-antigravi Write unit tests for JWT  COMPLETED         │
│      └─ Worker completed task: Write unit tests for JWT token expiry vali  │
├────────────────────────────────────────────────────────────────────────────┤
│ [M] Master  [W] Worker  [S] Auditor  [R] Quotas  [D] Delegate  [Q] Exit    │
└────────────────────────────────────────────────────────────────────────────┘
```

### Skróty klawiszowe w Dashboardzie:
* **`[M]`** – Przełączenie konta Master (cykliczna rotacja).
* **`[W]`** – Włączanie i wyłączanie kont w puli workerów.
* **`[S]`** – Włączanie / wyłączanie i zmiana konta Agenta Bezpieczeństwa.
* **`[R]`** – Wymuszenie natychmiastowego odświeżenia limitów z Google i xAI.
* **`[T]`** – Ustawienie nowego głównego celu programowania (prompt w konsoli).
* **`[D]`** – Wydelegowanie podzadania do puli workerów (prompt w konsoli).
* **`[Q]`** / `Ctrl+C` – Bezpieczne wyjście z dashboardu.

---

## ⌨️ Polecenia CLI (`pi-orchestrator`)

Możesz sterować orchestratorem skryptowo lub z wiersza poleceń:

| Polecenie | Opis |
|---|---|
| `pi-orchestrator` | Uruchamia interaktywny dashboard TUI |
| `pi-orchestrator quotas` | Wyświetla szczegółowe limity 5h i tygodniowe dla wszystkich kont |
| `pi-orchestrator status` | Drukuje bieżący stan panelu bez wchodzenia w tryb interaktywny |
| `pi-orchestrator task "<cel>"` | Ustawia główne zadanie programistyczne |
| `pi-orchestrator delegate "<opis>"` | Zleca podzadanie do wykonania w izolowanym worktree |
| `pi-orchestrator workers` | Wyświetla listę podzadań i werdykty bezpieczeństwa |
| `pi-orchestrator diff <task_id>` | Wyświetla git diff wygenerowany przez workera |
| `pi-orchestrator approve <task_id>` | Master zatwierdza i scala zmiany do głównego kodu |
| `pi-orchestrator reject <task_id> [powód]` | Master odrzuca zmiany i usuwa worktree |
| `pi-orchestrator security on\|off\|<konto>` | Włącza/wyłącza audytora lub przypisuje konto |
| `pi-orchestrator master <konto>` | Zmienia konto pełniące rolę Mastera |

---

## 💬 Użycie wewnątrz sesji `pi` (TUI / Czat)

Gdy pracujesz w `pi`, rozszerzenie rejestruje komendy slash oraz narzędzia LLM dla agentów.

### Dostępne komendy slash:
* `/status` – Renderuje pełny dashboard w oknie czatu.
* `/quotas` – Wyświetla aktualne limity 5h/tygodniowe kont.
* `/security <on|off|konto>` – Konfiguruje audytora bezpieczeństwa.
* `/master <konto>` – Przełącza konto Mastera.
* `/task <tytuł>` – Ustawia nadrzędny cel programistyczny.
* `/delegate <opis>` – Przekazuje zadanie badawcze lub implementacyjne do puli workerów.
* `/workers` – Lista wszystkich zadań.
* `/diff <task_id>` – Podgląd proponowanego patcha.
* `/approve <task_id>` – Bezpieczne scalenie do projektu.
* `/reject <task_id>` – Usunięcie zmian i zamknięcie worktree.

### Narzędzia LLM dla Agenta (Function Calling):
Model AI sam potrafi autonomicznie korzystać z poniższych narzędzi:
* `delegate_task` – Zleca wyizolowane zadanie do wybranego workera lub automatycznie dobiera wolnego agenta.
* `check_worker_task` – Odpytuje o status wykonania i raport workera.
* `get_worker_diff` – Pobiera wygenerowane zmiany w kodzie z worktree.
* `run_security_audit` – Wywołuje audytora bezpieczeństwa na diffie.
* `get_accounts_status` – Pobiera stan limitów kont, aby wybrać agenta z największym zapasem zapytań.
* `approve_worker_task` – Zatwierdza zmiany (blokowane automatycznie w przypadku krytycznych błędów bezpieczeństwa).
* `reject_worker_task` – Odrzuca zmiany workera.

---

## ⚙️ Plik Konfiguracyjny (`.pi/orchestrator.yaml`)

Konfiguracja projektu jest zapisywana automatycznie w `.pi/orchestrator.yaml`:

```yaml
masterAccount: antigravity
securityAuditorAccount: xai
securityAuditorEnabled: true
activeWorkers:
  - google-antigravity-2
  - google-antigravity-3
  - xai
accounts:
  antigravity:
    id: antigravity
    provider: antigravity
    label: liamprssn@gmail.com
    enabled: true
    role: master
  google-antigravity-2:
    id: google-antigravity-2
    provider: antigravity
    label: liam
    enabled: true
    role: worker
  google-antigravity-3:
    id: google-antigravity-3
    provider: antigravity
    label: "3"
    enabled: true
    role: worker
  xai:
    id: xai
    provider: xai
    enabled: true
    role: security_auditor
delegation:
  enabled: true
  automatic: true
  max_workers: 4
  default_timeout_ms: 300000
workspace:
  isolated_workers: true
review:
  automatic_merge: false
  require_security_approval: true
```

---

## 🧪 Testy Automatyczne

Pakiet posiada dedykowany zestaw 14 testów jednostkowych i integracyjnych (`vitest`):
```bash
npx vitest run packages/pi-orchestrator/test/orchestrator.test.ts
```
Co weryfikują testy:
1. Inicjalizację tożsamości Mastera i ról w puli kont.
2. Aktywację workerów w puli.
3. Tworzenie zadań z regułami ekonomii delegacji.
4. Budowanie odizolowanego kontekstu promptu.
5. Wykonanie zadania w worktree i agregację wyników.
6. Odporność na błędy workera (błąd workera nie blokuje Mastera).
7. Precyzyjne odliczanie timeoutów workera.
8. Ochronę praw własności plików (File Ownership Manager).
9. Inspekcję wygenerowanego diffu.
10. Wymóg jawnego zatwierdzenia zmian przez Mastera przed scaleniem.
11. Wykrywanie wycieków kluczy AWS / sekretów przez Audytora Bezpieczeństwa.
12. Wykrywanie destrukcyjnych komend powłoki (`rm -rf /`).
13. Czyste zatwierdzanie bezpiecznego kodu przez Audytora.
14. Poprawne formatowanie liczników resetu limitów (np. `in 2h 15m`, `in 5d 8h`).

---

## 🔒 Bezpieczeństwo i Zasady
* **Nigdy nie ma automatycznego scalania** do głównego drzewa plików bez akceptacji Mastera.
* **Brak destrukcyjnych poleceń git** (`git reset --hard`, `git clean -fd` nigdy nie są uruchamiane w głównym repozytorium).
* **Audytor Bezpieczeństwa** chroni przed przypadkowym commitowaniem sekretów lub wstrzyknięciem złośliwego kodu przez podagenta.

# Gymello: dokumentacja techniczna platformy coach-client

## 1. Cel i zakres

Gymello łączy aplikację Flutter dla klienta, panel webowy dla coacha i master_admina oraz Supabase jako backend. System obsługuje zaproszenia, onboarding, planowanie żywienia i treningów, rzeczywiste logi, check-in, chat, płatności i dashboard coacha.

Architektura:

- Gymello_mobile: Flutter, Riverpod, GoRouter, Supabase Flutter
- Gymello_coachPanel: React, TypeScript, Vite, Supabase JS
- Supabase: Auth, Postgres, Row Level Security, Realtime, Edge Functions i pg_cron
- Google Cloud: Cloud Run dla panelu webowego

## 2. Role i autoryzacja

| Rola | Zakres |
|---|---|
| MASTER_ADMIN | Zaprasza coachów, ma wgląd administracyjny do relacji i danych platformy. |
| COACH | Zaprasza wyłącznie klientów, tworzy ich plany, zarządza płatnościami, widzi dashboard i prowadzi chat. |
| CLIENT | Uzupełnia onboarding, dostępność, harmonogram posiłków i check-in. Widzi wyłącznie opublikowany własny plan, loguje wykonanie i pisze z przypisanym coachem. |

Role są w tabeli appUserRoles. Rola nigdy nie jest zaufanym parametrem z aplikacji. Każda decyzja jest weryfikowana przez Row Level Security i funkcje bazy.

Pierwszego master_admina trzeba nadać jednorazowo jako administrator projektu:

    insert into public."appUserRoles" (
      "appUserRoles__userUid",
      "appUserRoles__role"
    ) values (
      '<uuid_z_auth.users>',
      'MASTER_ADMIN'
    );

## 3. Zaproszenia

1. Master_admin w panelu podaje e-mail coacha. Coach w panelu podaje e-mail klienta.
2. Panel wywołuje Edge Function gymello-invite-user.
3. Funkcja sprawdza sesję wywołującego i rolę.
4. Tworzy zaproszenie Supabase Auth, rekord roli, profil i relację coach-client.
5. Supabase wysyła e-mail ustawienia hasła i wejścia do aplikacji.
6. Klient po zalogowaniu przechodzi obowiązkowy onboarding. Ekran mobilny nie pozwala na samodzielne tworzenie konta.

Tabela appInvitations zachowuje audyt: e-mail, rolę, nadawcę, docelowego coacha, status i znaczniki czasu.

Przed produkcją należy wyłączyć publiczny sign-up w Supabase Auth oraz skonfigurować redirect URLs dla maili zaproszeń i resetu hasła.

## 4. Onboarding klienta

Status onboardingStatus ma wartości NOT_STARTED, IN_PROGRESS i COMPLETE. Dla roli CLIENT aplikacja blokuje dostęp do funkcji do czasu COMPLETE.

| Wymagane pole | Zastosowanie |
|---|---|
| displayName | identyfikacja w panelu coacha |
| data urodzenia | obliczenie BMR i TDEE |
| płeć biologiczna | obliczenie BMR Mifflin-St Jeor |
| wzrost w cm | obliczenie BMR |
| poziom aktywności | mnożnik TDEE |
| główny cel | kontekst dla coacha |
| preferowane treningi tygodniowo | planowanie tygodniowe |
| strefa czasowa | harmonogram i alerty |

Klient dodatkowo zapisuje dostępność treningową i rytm posiłków. Dane mogą być później zmieniane.

## 5. Dostępność i harmonogram posiłków

clientTrainingAvailability ma jeden rekord na klienta i dzień tygodnia:

- dayOfWeek: 0 do 6, poniedziałek do niedzieli
- isAvailable
- minutesAvailable
- preferredStartTime, opcjonalnie

clientMealSchedules ma rekord na klienta, dzień tygodnia i typ posiłku. Obsługiwane typy: BREAKFAST, LUNCH, DINNER, SNACK, PRE_WORKOUT, POST_WORKOUT i OTHER. Coach odczytuje te dane przy układaniu planu.

## 6. TDEE i cele żywieniowe

BMR liczy się metodą Mifflin-St Jeor:

- mężczyzna: 10 razy masa_kg plus 6.25 razy wzrost_cm minus 5 razy wiek plus 5
- kobieta: 10 razy masa_kg plus 6.25 razy wzrost_cm minus 5 razy wiek minus 161
- TDEE: BMR razy mnożnik aktywności

Funkcja calculate_coach_tdee(clientUid) zwraca BMR, TDEE i mnożnik dla coacha przypisanego do klienta. Wymaga kompletnego onboardingu i najnowszej masy ciała.

Każdy dzień planu posiada wersje celów w coachNutritionTargetRevisions:

- wartości sugerowane przez system: TDEE, białko, węglowodany i tłuszcz
- wartości zatwierdzone lub skorygowane przez coacha
- numer wersji, autor, czas i powód zmiany

Wersje nie są nadpisywane. Można zawsze odtworzyć różnicę między sugestią systemu a decyzją coacha.

### Skalowanie przepisu

Funkcja scale_recipe_to_plan_meal(planMealId, recipeId):

1. sprawdza właściciela planu i prawo coacha do przepisu
2. liczy kcal przepisu z recipeIngredients i foodItems
3. wylicza współczynnik targetKcal podzielone przez recipeKcal
4. kopiuje składniki do coachPlanMealItems i skaluje gramy oraz makro
5. zachowuje snapshoty, więc późniejsza zmiana katalogu nie zmienia planu historycznego

## 7. Plan coacha

coachPlanDays jest unikalnym rekordem coacha, klienta i daty. Statusy:

- DRAFT: widoczny wyłącznie dla coacha
- PUBLISHED: widoczny dla klienta
- ARCHIVED: historia

Coach dodaje do dnia komentarz, zalecenia, wersje celów, posiłki, składniki, treningi, ćwiczenia i serie. Kluczowe tabele:

| Tabela | Znaczenie |
|---|---|
| coachPlanMeals | nazwa, typ, godzina, kcal i makro posiłku |
| coachPlanMealItems | snapshot składników i przeliczonych wartości |
| coachPlanWorkouts | nazwa, godzina, czas trwania, status |
| coachPlanWorkoutExercises | ćwiczenie, kolejność, notatki |
| coachPlanWorkoutSets | serie, powtórzenia, ciężar, przerwa i czas |

Katalog exercises jest hostowany w Supabase. Coach ręcznie wybiera ćwiczenia, określa ich kolejność oraz serie, powtórzenia i ciężar.

Coach może zapisać kompletny trening jako prywatny workoutTemplate przez save_coach_plan_workout_as_template. Zapisana sesja nadaje się do ponownego użycia.

## 8. Faktyczne logi klienta

### Posiłki

Klient może logować składniki lub posiłek ręcznie w dzienniku, albo oznaczyć wykonanie posiłku coacha.

log_coach_plan_meal tworzy faktyczny mealLog i kopiuje snapshot składników do mealLogItems. mealLogs__loggedAt to moment wykonania, a nie moment stworzenia planu.

### Trening i serie

start_coach_plan_workout kopiuje przepisany trening, ćwiczenia i serie do workoutLogs. Każda zapisana seria ma workoutLogSets__loggedAt z domyślnym now.

Po zakończeniu workoutLogs trigger sync_coach_plan_workout_completion ustawia powiązany coachPlanWorkout na COMPLETED.

## 9. Daily check-in i dashboard

Check-in klienta zapisuje:

- kroki
- wodę w ml
- stres od 1 do 5
- sen w godzinach
- energię od 1 do 5
- notatkę

upsert_client_check_in liczy z faktycznych mealLogs danego dnia kcal, białko, węglowodany i tłuszcz. Wynik jest snapshotem w clientCheckIns.

get_coach_client_dashboard(clientUid, days) zwraca dla coacha:

- logowane kcal względem celu
- ukończone treningi
- liczbę serii i objętość
- kroki i stres z check-inów

Panel ma domyślny okres 28 dni.

## 10. Płatności i alerty

coachClientPaidDays przechowuje dni oznaczone jako opłacone. paymentAlertsEnabled w coachClientRelationships pozwala wyłączyć powiadomienia dla konkretnego klienta.

Zadanie pg_cron gymello-payment-alerts uruchamia się co 15 minut. Tworzy userNotifications, gdy:

- jest 09:00 czasu lokalnego klienta, dzień ma opublikowany trening i nie jest opłacony
- do zaplanowanego treningu pozostało około 2 godzin, a dzień nie jest opłacony

Unikalny klucz deduplikacji ogranicza każdy alert do jednego powiadomienia. Panel subskrybuje userNotifications przez Realtime.

## 11. Chat i bezpieczeństwo

Chat to coachChats oraz coachChatMessages. ensure_coach_chat tworzy lub zwraca prawidłowy wątek wyłącznie dla istniejącej relacji coach-client. Realtime dostarcza nowe wiadomości obu stronom.

Obecnie komunikacja używa:

- TLS w transmisji
- szyfrowania infrastruktury Supabase w spoczynku
- restrykcyjnego RLS, który blokuje dostęp poza parą coach-client
- braku service_role key w panelu i aplikacji mobilnej

To nie jest pełne szyfrowanie end-to-end. Jeżeli E2EE jest obowiązkowe, trzeba dodać szyfrowanie treści na urządzeniu, zarządzanie kluczami i odzyskiwanie kluczy jako osobny etap produktu.

## 12. RLS

Wszystkie nowe tabele publiczne mają włączone RLS.

| Obszar | Reguła |
|---|---|
| profil i logi | klient widzi swoje dane, przypisany coach odczytuje, master_admin ma dostęp administracyjny |
| plany | coach zapisuje tylko plany swoich klientów, klient odczytuje tylko PUBLISHED |
| wersje TDEE | coach tworzy, klient odczytuje opublikowane dane |
| chat | tylko przypisany coach, klient i master_admin |
| płatności | coach relacji, klient nie zmienia statusu opłacenia |
| dostępność i rytm | klient zapisuje własne dane, coach je odczytuje |

Funkcje SECURITY DEFINER mają stały search_path, sprawdzają auth.uid i mają ograniczone granty. Funkcje pomocnicze używane wyłącznie przez RLS nie są publicznymi endpointami RPC.

## 13. Kontrakty backendu

| Funkcja | Wywołujący | Cel |
|---|---|---|
| gymello-invite-user | master_admin, coach | zaproszenie i przypisanie roli |
| calculate_coach_tdee | coach, master_admin | sugestia BMR/TDEE |
| scale_recipe_to_plan_meal | coach | skalowanie przepisu |
| save_coach_plan_workout_as_template | coach | zapis reusable session |
| log_coach_plan_meal | klient | potwierdzenie posiłku z timestampem |
| start_coach_plan_workout | klient | kopia planu do treningu |
| upsert_client_check_in | klient | check-in i obliczenie makro |
| get_coach_client_dashboard | coach, master_admin | metryki klienta |
| ensure_coach_chat | coach, klient | odczyt lub utworzenie wątku |

## 14. Aplikacja mobilna

Nowe ekrany są w lib/features/coaching/presentation/client_coaching_screens.dart:

- obowiązkowy onboarding
- dzisiejszy opublikowany plan
- potwierdzanie posiłku coacha
- start treningu coacha
- check-in z wyliczonym makro
- dostępność treningowa i pory posiłków
- chat z coachem

main.dart blokuje klienta onboardingiem, dopóki status nie będzie COMPLETE. sign_in_screen.dart obsługuje wyłącznie logowanie z zaproszonego konta.

## 15. Panel coacha

Panel React i TypeScript obsługuje:

- logowanie i rozpoznanie roli
- listę klientów i status onboardingu
- zapraszanie coachów przez master_admina
- zapraszanie klientów przez coacha
- dashboard klienta
- edytor dnia planu i wersje TDEE
- ręczny kreator treningu oraz zapis sesji
- dostępność i harmonogram klienta
- płatności oraz przełącznik alertów
- Realtime notifications i chat

Zmienne środowiskowe panelu:

    VITE_SUPABASE_URL=https://<project-ref>.supabase.co
    VITE_SUPABASE_PUBLISHABLE_KEY=<publishable-key>

Service role key nie może trafić do panelu ani aplikacji mobilnej.

## 16. Google Cloud

Panel to aplikacja webowa. Właściwym hostingiem jest Cloud Run z kontenerem Nginx albo Firebase Hosting. Vertex AI jest usługą modeli i agentów AI, a nie hostingu SPA.

Zalecana procedura:

1. zapisać zmienne Supabase w Secret Manager
2. zbudować obraz Docker z repo coachPanel
3. wdrożyć go do Cloud Run
4. podpiąć domenę i HTTPS
5. dodać URL panelu do Supabase Auth Redirect URLs i CORS
6. wykonać smoke test logowania, zaproszenia i Realtime

Repo panelu zawiera Dockerfile, cloudbuild.yaml i DEPLOYMENT.md.

## 17. Migracje

Migracje są wersjonowane w Gymello_mobile w katalogu supabase/migrations. Wdrożone zmiany obejmują model coach-client, planów, chatów, płatności, powiadomień, funkcje planowania, pg_cron, template library, skalowanie przepisów, timestampy serii oraz trigger zakończenia treningu.

Na produkcji zmiany wprowadza się sekwencyjnymi migracjami. Nie edytować historii migracji.

## 18. Testy akceptacyjne

1. Master_admin zaprasza coacha, coach ustawia hasło i widzi panel.
2. Coach zaprasza klienta, klient nie widzi panelu coacha.
3. Klient kończy onboarding i zapisuje dostępność oraz godziny posiłków.
4. Coach tworzy TDEE, posiłek z przepisem i trening z seriami.
5. Coach publikuje dzień, klient widzi go w aplikacji.
6. Klient potwierdza posiłek, sprawdzić mealLogs__loggedAt.
7. Klient zapisuje serię, sprawdzić workoutLogSets__loggedAt.
8. Klient kończy trening, sprawdzić status coachPlanWorkout.
9. Klient zapisuje check-in, sprawdzić snapshot makro.
10. Coach i klient wymieniają wiadomości, sprawdzić RLS po zalogowaniu innym kontem.
11. Oznaczyć dzień jako opłacony i nieopłacony, sprawdzić alert.
12. Uruchomić Security Advisor i przejrzeć lintery spoza intencjonalnie wykonywanych RPC.

## 19. Otwarte działania przed premierą

- Nadać pierwszego master_admina.
- Wyłączyć publiczny sign-up w Supabase Auth.
- Ustawić APP_ORIGIN dla Edge Functions.
- Skonfigurować Android App Links i iOS Universal Links.
- Przetestować alerty na kontach testowych w dwóch strefach czasowych.
- Potwierdzić, czy wymagane jest E2EE dla chatu.

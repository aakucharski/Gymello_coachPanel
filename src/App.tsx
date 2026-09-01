import { FormEvent, useEffect, useMemo, useState } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { isConfigured, supabase } from "./lib/supabase";
import { WorkoutComposer } from "./components/WorkoutComposer";
import type { AppRole, Client, Notification, PlanDay } from "./types";

type Tab = "clients" | "invites" | "notifications";
type PlanMeal = { id: string; name: string; mealType: string; kcal: number; status: string };
type PlanWorkout = { id: string; name: string; startAt: string | null; minutes: number | null; status: string };
type Availability = { day: number; available: boolean; minutes: number; start: string | null };
type DashboardData = { nutrition: Array<{ date: string; targetKcal: number; kcal: number }>; workouts: Array<{ date: string; completedSessions: number; volumeKg: number }>; checkins: Array<{ clientCheckIns__date: string; clientCheckIns__steps: number | null; clientCheckIns__stressLevel: number | null }> };

export function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [role, setRole] = useState<AppRole | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!supabase) return;
    void supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const listener = supabase.auth.onAuthStateChange((_event, nextSession) => setSession(nextSession));
    return () => listener.data.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!supabase || !session) {
      setRole(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    void supabase
      .from("appUserRoles")
      .select("appUserRoles__role")
      .eq("appUserRoles__userUid", session.user.id)
      .maybeSingle()
      .then(({ data, error }) => {
        if (error) console.error(error);
        setRole((data?.appUserRoles__role as AppRole | undefined) ?? null);
        setLoading(false);
      });
  }, [session]);

  if (!isConfigured || !supabase) return <ConfigurationScreen />;
  if (loading) return <Loading label="Restoring your secure session…" />;
  if (!session) return <SignIn />;
  if (role === "CLIENT") return <ClientOnlyNotice />;
  if (role !== "COACH" && role !== "MASTER_ADMIN") return <RolePending />;
  return <CoachConsole session={session} role={role} />;
}

function ConfigurationScreen() {
  return <main className="auth-shell"><section className="auth-card"><p className="eyebrow">Gymello Coach</p><h1>Backend configuration is required</h1><p>Add the Supabase URL and publishable key as Vite environment variables. Never use a service role key in this browser application.</p></section></main>;
}

function SignIn() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!supabase) return;
    setBusy(true); setMessage(null);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setMessage(error ? error.message : null);
    setBusy(false);
  }
  return <main className="auth-shell"><form className="auth-card" onSubmit={submit}>
    <p className="eyebrow">Gymello Coach</p><h1>Secure coach workspace</h1>
    <p>Access is invitation-only. Use the account created from your Gymello email invitation.</p>
    <label>Email<input value={email} onChange={(event) => setEmail(event.target.value)} type="email" autoComplete="email" required /></label>
    <label>Password<input value={password} onChange={(event) => setPassword(event.target.value)} type="password" autoComplete="current-password" required /></label>
    {message && <p className="form-error">{message}</p>}
    <button className="button primary" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
  </form></main>;
}

function ClientOnlyNotice() {
  return <main className="auth-shell"><section className="auth-card"><p className="eyebrow">Gymello</p><h1>This account is a client account</h1><p>Your plans, check-ins and training log are available in the Gymello mobile app.</p><button className="button secondary" onClick={() => void supabase?.auth.signOut()}>Sign out</button></section></main>;
}
function RolePending() {
  return <main className="auth-shell"><section className="auth-card"><p className="eyebrow">Gymello Coach</p><h1>Access is being prepared</h1><p>Your account exists but does not yet have a coach or administrator role. Ask a master administrator to resend or complete your invitation.</p><button className="button secondary" onClick={() => void supabase?.auth.signOut()}>Sign out</button></section></main>;
}
function Loading({ label }: { label: string }) { return <main className="auth-shell"><p className="loading">{label}</p></main>; }

function CoachConsole({ session, role }: { session: Session; role: AppRole }) {
  const [tab, setTab] = useState<Tab>("clients");
  const [clients, setClients] = useState<Client[]>([]);
  const [selected, setSelected] = useState<Client | null>(null);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [error, setError] = useState<string | null>(null);

  async function loadClients() {
    if (!supabase) return;
    setError(null);
    const base = supabase.from("coachClientRelationships").select("coachClientRelationships__id,coachClientRelationships__clientUid,coachClientRelationships__status,coachClientRelationships__paymentAlertsEnabled");
    const { data: relations, error: relationError } = role === "COACH"
      ? await base.eq("coachClientRelationships__coachUid", session.user.id)
      : await base;
    if (relationError) { setError(relationError.message); return; }
    const ids = (relations ?? []).map((row) => row.coachClientRelationships__clientUid);
    if (!ids.length) { setClients([]); setSelected(null); return; }
    const { data: profiles, error: profileError } = await supabase
      .from("userProfile")
      .select("userProfile__userUid,userProfile__displayName,userProfile__onboardingStatus,userProfile__timezone")
      .in("userProfile__userUid", ids);
    if (profileError) { setError(profileError.message); return; }
    const profileById = new Map((profiles ?? []).map((profile) => [profile.userProfile__userUid, profile]));
    const next = (relations ?? []).map((relation) => {
      const profile = profileById.get(relation.coachClientRelationships__clientUid);
      return {
        uid: relation.coachClientRelationships__clientUid,
        relationshipId: relation.coachClientRelationships__id,
        status: relation.coachClientRelationships__status,
        paymentAlertsEnabled: relation.coachClientRelationships__paymentAlertsEnabled,
        name: profile?.userProfile__displayName ?? "Invited client",
        onboardingStatus: profile?.userProfile__onboardingStatus,
        timezone: profile?.userProfile__timezone ?? "UTC",
      };
    });
    setClients(next);
    setSelected((current) => next.find((client) => client.uid === current?.uid) ?? next[0] ?? null);
  }

  async function loadNotifications() {
    if (!supabase) return;
    const { data, error: notificationError } = await supabase
      .from("userNotifications")
      .select("userNotifications__id,userNotifications__title,userNotifications__body,userNotifications__createdAt,userNotifications__readAt")
      .order("userNotifications__createdAt", { ascending: false }).limit(20);
    if (notificationError) { setError(notificationError.message); return; }
    setNotifications((data ?? []).map((row) => ({
      id: row.userNotifications__id, title: row.userNotifications__title, body: row.userNotifications__body,
      createdAt: row.userNotifications__createdAt, readAt: row.userNotifications__readAt,
    })));
  }

  useEffect(() => { void loadClients(); void loadNotifications(); }, [role, session.user.id]);
  useEffect(() => {
    if (!supabase) return;
    const channel = supabase.channel("coach-notifications")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "userNotifications", filter: "userNotifications__userUid=eq." + session.user.id }, () => void loadNotifications())
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [session.user.id]);

  return <main className="app-shell">
    <aside className="sidebar">
      <div className="brand"><span className="brand-mark">G</span><span>Gymello <small>Coach</small></span></div>
      <nav>
        <button className={tab === "clients" ? "nav-active" : ""} onClick={() => setTab("clients")}>Clients</button>
        <button className={tab === "invites" ? "nav-active" : ""} onClick={() => setTab("invites")}>Invite people</button>
        <button className={tab === "notifications" ? "nav-active" : ""} onClick={() => setTab("notifications")}>Notifications {notifications.filter((item) => !item.readAt).length > 0 && <b>{notifications.filter((item) => !item.readAt).length}</b>}</button>
      </nav>
      <div className="sidebar-foot"><span>{role === "MASTER_ADMIN" ? "Master admin" : "Coach"}</span><button onClick={() => void supabase?.auth.signOut()}>Sign out</button></div>
    </aside>
    <section className="workspace">
      {error && <div className="banner error">{error}<button onClick={() => setError(null)}>Dismiss</button></div>}
      {tab === "clients" && <div className="client-layout">
        <ClientList clients={clients} selected={selected} onSelect={setSelected} onRefresh={() => void loadClients()} />
        {selected ? <ClientWorkspace coach={session.user} client={selected} onRefresh={() => void loadClients()} /> : <Empty title="No clients yet" body="Send a client invitation to start planning." />}
      </div>}
      {tab === "invites" && <InvitePanel actor={session.user} role={role} clients={clients} />}
      {tab === "notifications" && <NotificationPanel notifications={notifications} onRefresh={() => void loadNotifications()} />}
    </section>
  </main>;
}

function ClientList({ clients, selected, onSelect, onRefresh }: { clients: Client[]; selected: Client | null; onSelect: (client: Client) => void; onRefresh: () => void }) {
  return <aside className="client-list"><div className="panel-head"><div><p className="eyebrow">Workspace</p><h2>Clients</h2></div><button className="icon-button" onClick={onRefresh}>↻</button></div>
    {clients.map((client) => <button className={"client-row " + (client.uid === selected?.uid ? "selected" : "")} key={client.uid} onClick={() => onSelect(client)}>
      <span className="avatar">{client.name.slice(0, 1).toUpperCase()}</span><span><strong>{client.name}</strong><small>{client.status.toLowerCase()} · {client.onboardingStatus?.toLowerCase().replace("_", " ") ?? "profile pending"}</small></span>
    </button>)}
    {!clients.length && <p className="muted">No active clients.</p>}
  </aside>;
}

function InvitePanel({ actor, role, clients }: { actor: User; role: AppRole; clients: Client[] }) {
  const inviteRole: "COACH" | "CLIENT" = role === "MASTER_ADMIN" ? "COACH" : "CLIENT";
  const [email, setEmail] = useState("");
  const [coachUid, setCoachUid] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault(); if (!supabase) return;
    setBusy(true); setMessage(null);
    const body: Record<string, string> = { email, role: inviteRole };
    if (inviteRole === "CLIENT" && role === "MASTER_ADMIN") body.coachUid = coachUid;
    const { data, error } = await supabase.functions.invoke("gymello-invite-user", { body });
    setMessage(error ? error.message : data?.error ? data.error : "Invitation email sent.");
    setBusy(false);
  }
  return <section className="content-page"><p className="eyebrow">Access control</p><h1>Invite a person</h1><p className="lead">Roles are assigned by the server. A coach can invite client accounts only. Clients cannot access this dashboard.</p>
    <form className="form-card" onSubmit={submit}>
      {role === "MASTER_ADMIN" && <p className="muted">Master administrators invite coach accounts. Each coach invites only their own clients.</p>}
      <label>Email<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required placeholder="person@example.com" /></label>
      {message && <p className={message === "Invitation email sent." ? "form-success" : "form-error"}>{message}</p>}
      <button className="button primary" disabled={busy}>{busy ? "Sending…" : "Send invitation"}</button>
    </form>
  </section>;
}

function NotificationPanel({ notifications, onRefresh }: { notifications: Notification[]; onRefresh: () => void }) {
  async function markRead(notification: Notification) {
    if (!supabase || notification.readAt) return;
    await supabase.from("userNotifications").update({ userNotifications__readAt: new Date().toISOString() }).eq("userNotifications__id", notification.id);
    onRefresh();
  }
  return <section className="content-page"><div className="panel-head"><div><p className="eyebrow">Alerts</p><h1>Notifications</h1></div><button className="button secondary" onClick={onRefresh}>Refresh</button></div>
    <div className="stack">{notifications.map((notification) => <button className={"notification " + (!notification.readAt ? "unread" : "")} key={notification.id} onClick={() => void markRead(notification)}><strong>{notification.title}</strong><span>{notification.body}</span><small>{new Date(notification.createdAt).toLocaleString()}</small></button>)}</div>
    {!notifications.length && <Empty title="No notifications" body="Payment alerts and other coach notifications will appear here." />}
  </section>;
}

function ClientWorkspace({ coach, client, onRefresh }: { coach: User; client: Client; onRefresh: () => void }) {
  const [section, setSection] = useState<"overview" | "plan" | "availability" | "payments" | "chat">("overview");
  return <section className="client-workspace"><header className="client-header"><div><p className="eyebrow">Client workspace</p><h1>{client.name}</h1><p>{client.timezone ?? "UTC"} · {client.onboardingStatus?.toLowerCase().replace("_", " ") ?? "onboarding pending"}</p></div><button className="button secondary" onClick={onRefresh}>Refresh profile</button></header>
    <nav className="subnav">{(["overview", "plan", "availability", "payments", "chat"] as const).map((item) => <button key={item} onClick={() => setSection(item)} className={section === item ? "active" : ""}>{item}</button>)}</nav>
    {section === "overview" && <Performance client={client} />}
    {section === "plan" && <PlanEditor coach={coach} client={client} />}
    {section === "availability" && <AvailabilityPanel client={client} />}
    {section === "payments" && <PaymentPanel coach={coach} client={client} />}
    {section === "chat" && <ChatPanel coach={coach} client={client} />}
  </section>;
}

function Performance({ client }: { client: Client }) {
  const [data, setData] = useState<DashboardData | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => { void (async () => {
    if (!supabase) return;
    const { data: response, error } = await supabase.rpc("get_coach_client_dashboard", { p_client_uid: client.uid, p_days: 28 });
    if (error) setMessage(error.message); else setData(response as DashboardData);
  })(); }, [client.uid]);
  const totals = useMemo(() => ({
    kcal: data?.nutrition.reduce((sum, item) => sum + Number(item.kcal ?? 0), 0) ?? 0,
    workouts: data?.workouts.reduce((sum, item) => sum + Number(item.completedSessions ?? 0), 0) ?? 0,
    steps: data?.checkins.reduce((sum, item) => sum + Number(item.clientCheckIns__steps ?? 0), 0) ?? 0,
  }), [data]);
  return <div><div className="metric-grid"><Metric label="28-day kcal logged" value={Math.round(totals.kcal).toLocaleString()} /><Metric label="Completed workouts" value={String(totals.workouts)} /><Metric label="Check-in steps" value={totals.steps.toLocaleString()} /></div>
    <section className="surface"><h2>Nutrition adherence</h2>{message ? <p className="form-error">{message}</p> : <SimpleBars rows={(data?.nutrition ?? []).map((item) => ({ label: item.date, value: Number(item.kcal ?? 0), target: Number(item.targetKcal ?? 0) }))} />}</section>
  </div>;
}
function Metric({ label, value }: { label: string; value: string }) { return <div className="metric"><span>{label}</span><strong>{value}</strong></div>; }
function SimpleBars({ rows }: { rows: Array<{ label: string; value: number; target: number }> }) {
  if (!rows.length) return <p className="muted">No completed log data in this period.</p>;
  return <div className="bars">{rows.slice(-14).map((row) => <div className="bar-row" key={row.label}><span>{row.label.slice(5)}</span><div><i style={{ width: Math.min(100, row.target ? row.value / row.target * 100 : 0) + "%" }} /></div><strong>{Math.round(row.value)} / {Math.round(row.target)}</strong></div>)}</div>;
}

function PlanEditor({ coach, client }: { coach: User; client: Client }) {
  const [date, setDate] = useState(localDate());
  const [plan, setPlan] = useState<PlanDay | null>(null);
  const [meals, setMeals] = useState<PlanMeal[]>([]);
  const [workouts, setWorkouts] = useState<PlanWorkout[]>([]);
  const [suggestion, setSuggestion] = useState<number | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [mealName, setMealName] = useState("");
  const [mealKcal, setMealKcal] = useState("500");
  const [workoutName, setWorkoutName] = useState("");
  const [workoutMinutes, setWorkoutMinutes] = useState("45");

  async function loadPlan() {
    if (!supabase) return;
    setMessage(null);
    const { data, error } = await supabase.from("coachPlanDays").select("coachPlanDays__id,coachPlanDays__date,coachPlanDays__status,coachPlanDays__coachComment,coachPlanDays__recommendations").eq("coachPlanDays__clientUid", client.uid).eq("coachPlanDays__date", date).maybeSingle();
    if (error) { setMessage(error.message); return; }
    if (!data) { setPlan(null); setMeals([]); setWorkouts([]); return; }
    const current = { id: data.coachPlanDays__id, date: data.coachPlanDays__date, status: data.coachPlanDays__status, comment: data.coachPlanDays__coachComment, recommendations: data.coachPlanDays__recommendations } as PlanDay;
    setPlan(current);
    const [mealResponse, workoutResponse] = await Promise.all([
      supabase.from("coachPlanMeals").select("coachPlanMeals__id,coachPlanMeals__name,coachPlanMeals__mealType,coachPlanMeals__targetKcal,coachPlanMeals__completionStatus").eq("coachPlanMeals__planDayId", current.id).order("coachPlanMeals__position"),
      supabase.from("coachPlanWorkouts").select("coachPlanWorkouts__id,coachPlanWorkouts__name,coachPlanWorkouts__scheduledStartAt,coachPlanWorkouts__targetMinutes,coachPlanWorkouts__completionStatus").eq("coachPlanWorkouts__planDayId", current.id).order("coachPlanWorkouts__position"),
    ]);
    if (mealResponse.error || workoutResponse.error) { setMessage(mealResponse.error?.message ?? workoutResponse.error?.message ?? "Could not load plan items"); return; }
    setMeals((mealResponse.data ?? []).map((row) => ({ id: row.coachPlanMeals__id, name: row.coachPlanMeals__name, mealType: row.coachPlanMeals__mealType, kcal: Number(row.coachPlanMeals__targetKcal), status: row.coachPlanMeals__completionStatus })));
    setWorkouts((workoutResponse.data ?? []).map((row) => ({ id: row.coachPlanWorkouts__id, name: row.coachPlanWorkouts__name, startAt: row.coachPlanWorkouts__scheduledStartAt, minutes: row.coachPlanWorkouts__targetMinutes, status: row.coachPlanWorkouts__completionStatus })));
  }
  useEffect(() => { void loadPlan(); }, [client.uid, date]);

  async function ensurePlan() {
    if (!supabase) return null;
    if (plan) return plan;
    const { data, error } = await supabase.from("coachPlanDays").insert({
      coachPlanDays__coachUid: coach.id, coachPlanDays__clientUid: client.uid, coachPlanDays__date: date, coachPlanDays__status: "DRAFT",
    }).select("coachPlanDays__id,coachPlanDays__date,coachPlanDays__status,coachPlanDays__coachComment,coachPlanDays__recommendations").single();
    if (error) { setMessage(error.message); return null; }
    const current = { id: data.coachPlanDays__id, date: data.coachPlanDays__date, status: data.coachPlanDays__status, comment: data.coachPlanDays__coachComment, recommendations: data.coachPlanDays__recommendations } as PlanDay;
    setPlan(current); return current;
  }

  async function suggestTdee() {
    if (!supabase) return;
    const { data, error } = await supabase.rpc("calculate_coach_tdee", { p_client_uid: client.uid });
    if (error) { setMessage(error.message); return; }
    setSuggestion(Number((data as { tdeeKcal: number }).tdeeKcal));
  }
  async function saveTarget() {
    if (!supabase || suggestion === null) return;
    const current = await ensurePlan(); if (!current) return;
    const { data: revisions } = await supabase.from("coachNutritionTargetRevisions").select("coachNutritionTargetRevisions__version").eq("coachNutritionTargetRevisions__planDayId", current.id).order("coachNutritionTargetRevisions__version", { ascending: false }).limit(1);
    const kcal = suggestion; const protein = Math.round(kcal * 0.3 / 4); const fats = Math.round(kcal * 0.25 / 9); const carbs = Math.round((kcal - protein * 4 - fats * 9) / 4);
    const { error } = await supabase.from("coachNutritionTargetRevisions").insert({
      coachNutritionTargetRevisions__planDayId: current.id, coachNutritionTargetRevisions__version: Number(revisions?.[0]?.coachNutritionTargetRevisions__version ?? 0) + 1,
      coachNutritionTargetRevisions__suggestedTdeeKcal: kcal, coachNutritionTargetRevisions__suggestedProteinG: protein, coachNutritionTargetRevisions__suggestedCarbsG: carbs, coachNutritionTargetRevisions__suggestedFatsG: fats,
      coachNutritionTargetRevisions__approvedTdeeKcal: kcal, coachNutritionTargetRevisions__approvedProteinG: protein, coachNutritionTargetRevisions__approvedCarbsG: carbs, coachNutritionTargetRevisions__approvedFatsG: fats,
      coachNutritionTargetRevisions__createdByUid: coach.id, coachNutritionTargetRevisions__reason: "Coach plan target",
    });
    setMessage(error ? error.message : "TDEE target version saved. You can add a later revision without losing this one.");
  }
  async function addMeal(event: FormEvent) {
    event.preventDefault(); if (!supabase || !mealName.trim()) return;
    const current = await ensurePlan(); if (!current) return;
    const { data: last } = await supabase.from("coachPlanMeals").select("coachPlanMeals__position").eq("coachPlanMeals__planDayId", current.id).order("coachPlanMeals__position", { ascending: false }).limit(1);
    const { error } = await supabase.from("coachPlanMeals").insert({
      coachPlanMeals__planDayId: current.id, coachPlanMeals__mealType: "LUNCH", coachPlanMeals__name: mealName.trim(),
      coachPlanMeals__targetKcal: Number(mealKcal), coachPlanMeals__targetProteinG: 0, coachPlanMeals__targetCarbsG: 0, coachPlanMeals__targetFatsG: 0,
      coachPlanMeals__position: Number(last?.[0]?.coachPlanMeals__position ?? 0) + 1,
    });
    if (error) setMessage(error.message); else { setMealName(""); await loadPlan(); }
  }
  async function addWorkout(event: FormEvent) {
    event.preventDefault(); if (!supabase || !workoutName.trim()) return;
    const current = await ensurePlan(); if (!current) return;
    const { data: last } = await supabase.from("coachPlanWorkouts").select("coachPlanWorkouts__position").eq("coachPlanWorkouts__planDayId", current.id).order("coachPlanWorkouts__position", { ascending: false }).limit(1);
    const { error } = await supabase.from("coachPlanWorkouts").insert({
      coachPlanWorkouts__planDayId: current.id, coachPlanWorkouts__name: workoutName.trim(), coachPlanWorkouts__targetMinutes: Number(workoutMinutes),
      coachPlanWorkouts__position: Number(last?.[0]?.coachPlanWorkouts__position ?? 0) + 1,
    });
    if (error) setMessage(error.message); else { setWorkoutName(""); await loadPlan(); }
  }
  async function publish() {
    const current = await ensurePlan(); if (!supabase || !current) return;
    const { error } = await supabase.from("coachPlanDays").update({ coachPlanDays__status: "PUBLISHED", coachPlanDays__publishedAt: new Date().toISOString() }).eq("coachPlanDays__id", current.id);
    if (error) setMessage(error.message); else await loadPlan();
  }
  return <div className="stack"><section className="surface plan-head"><div><h2>Daily plan</h2><p>The draft is only visible to you. Publishing makes it available to the client app.</p></div><label>Date<input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label><button className="button primary" onClick={() => void publish()}>{plan?.status === "PUBLISHED" ? "Published" : "Publish plan"}</button></section>
    {message && <div className={message.includes("saved") ? "banner success" : "banner error"}>{message}</div>}
    <section className="surface"><div className="panel-head"><div><h2>Nutrition target</h2><p>Gymello suggests TDEE from the client's profile and latest weight. Every coach revision is retained.</p></div><button className="button secondary" onClick={() => void suggestTdee()}>Calculate TDEE</button></div>
      {suggestion !== null && <div className="inline-action"><strong>{suggestion} kcal/day suggested</strong><button className="button primary" onClick={() => void saveTarget()}>Save as coach version</button></div>}
    </section>
    <div className="two-column"><section className="surface"><h2>Meals</h2><form className="inline-form" onSubmit={addMeal}><input value={mealName} onChange={(event) => setMealName(event.target.value)} placeholder="Meal name" required /><input value={mealKcal} onChange={(event) => setMealKcal(event.target.value)} inputMode="numeric" aria-label="Target calories" /><button className="button secondary">Add meal</button></form><ul className="plain-list">{meals.map((meal) => <li key={meal.id}><strong>{meal.name}</strong><span>{meal.mealType.toLowerCase()} · {meal.kcal} kcal · {meal.status.toLowerCase()}</span></li>)}</ul></section>
      <section className="surface"><h2>Workouts</h2><form className="inline-form" onSubmit={addWorkout}><input value={workoutName} onChange={(event) => setWorkoutName(event.target.value)} placeholder="Workout name" required /><input value={workoutMinutes} onChange={(event) => setWorkoutMinutes(event.target.value)} inputMode="numeric" aria-label="Target minutes" /><button className="button secondary">Add workout</button></form><ul className="plain-list">{workouts.map((workout) => <li key={workout.id}><strong>{workout.name}</strong><span>{workout.minutes ?? "—"} min · {workout.status.toLowerCase()}</span></li>)}</ul>{workouts[0] && <WorkoutComposer planWorkoutId={workouts[0].id} />}</section></div>
  </div>;
}

function AvailabilityPanel({ client }: { client: Client }) {
  const [availability, setAvailability] = useState<Availability[]>([]);
  const [schedules, setSchedules] = useState<Array<{ day: number; type: string; time: string }>>([]);
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => { void (async () => {
    if (!supabase) return;
    const [training, meals] = await Promise.all([
      supabase.from("clientTrainingAvailability").select("clientTrainingAvailability__dayOfWeek,clientTrainingAvailability__isAvailable,clientTrainingAvailability__minutesAvailable,clientTrainingAvailability__preferredStartTime").eq("clientTrainingAvailability__clientUid", client.uid).order("clientTrainingAvailability__dayOfWeek"),
      supabase.from("clientMealSchedules").select("clientMealSchedules__dayOfWeek,clientMealSchedules__mealType,clientMealSchedules__scheduledTime").eq("clientMealSchedules__clientUid", client.uid).order("clientMealSchedules__dayOfWeek"),
    ]);
    if (training.error || meals.error) setMessage(training.error?.message ?? meals.error?.message ?? "Could not load availability");
    setAvailability((training.data ?? []).map((row) => ({ day: row.clientTrainingAvailability__dayOfWeek, available: row.clientTrainingAvailability__isAvailable, minutes: row.clientTrainingAvailability__minutesAvailable, start: row.clientTrainingAvailability__preferredStartTime })));
    setSchedules((meals.data ?? []).map((row) => ({ day: row.clientMealSchedules__dayOfWeek, type: row.clientMealSchedules__mealType, time: row.clientMealSchedules__scheduledTime })));
  })(); }, [client.uid]);
  return <div className="two-column"><section className="surface"><h2>Training availability</h2>{message && <p className="form-error">{message}</p>}<ul className="plain-list">{availability.map((row) => <li key={row.day}><strong>{weekday(row.day)}</strong><span>{row.available ? row.minutes + " min" : "Unavailable"} {row.start ? "· " + row.start.slice(0, 5) : ""}</span></li>)}</ul>{!availability.length && <p className="muted">Client has not entered availability yet.</p>}</section>
    <section className="surface"><h2>Meal rhythm</h2><ul className="plain-list">{schedules.map((row, index) => <li key={index}><strong>{weekday(row.day)}</strong><span>{row.type.toLowerCase()} · {row.time.slice(0, 5)}</span></li>)}</ul>{!schedules.length && <p className="muted">Client has not set meal times yet.</p>}</section></div>;
}

function PaymentPanel({ coach, client }: { coach: User; client: Client }) {
  const [date, setDate] = useState(localDate());
  const [paid, setPaid] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  async function check() {
    if (!supabase) return;
    const { data, error } = await supabase.from("coachClientPaidDays").select("coachClientPaidDays__id").eq("coachClientPaidDays__coachUid", coach.id).eq("coachClientPaidDays__clientUid", client.uid).eq("coachClientPaidDays__date", date).maybeSingle();
    if (error) setMessage(error.message); else setPaid(Boolean(data));
  }
  useEffect(() => { void check(); }, [client.uid, date]);
  async function toggle() {
    if (!supabase) return;
    if (paid) {
      const { error } = await supabase.from("coachClientPaidDays").delete().eq("coachClientPaidDays__coachUid", coach.id).eq("coachClientPaidDays__clientUid", client.uid).eq("coachClientPaidDays__date", date);
      if (error) setMessage(error.message); else { setPaid(false); setMessage("Payment mark removed. Alerts apply again if training is pending."); }
    } else {
      const { error } = await supabase.from("coachClientPaidDays").insert({ coachClientPaidDays__coachUid: coach.id, coachClientPaidDays__clientUid: client.uid, coachClientPaidDays__date: date });
      if (error) setMessage(error.message); else { setPaid(true); setMessage("Day marked as paid."); }
    }
  }
  async function toggleAlerts() {
    if (!supabase) return;
    const { error } = await supabase.from("coachClientRelationships").update({ coachClientRelationships__paymentAlertsEnabled: !client.paymentAlertsEnabled }).eq("coachClientRelationships__id", client.relationshipId);
    setMessage(error ? error.message : "Payment alert preference saved. Refresh the client profile to see its new state.");
  }
  return <section className="surface"><h2>Payment coverage</h2><p>Mark a calendar day as paid. The scheduled alert will not appear for a paid day.</p><div className="inline-action"><label>Date<input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label><button className={paid ? "button secondary" : "button primary"} onClick={() => void toggle()}>{paid ? "Mark unpaid" : "Mark paid"}</button><button className="button secondary" onClick={() => void toggleAlerts()}>{client.paymentAlertsEnabled ? "Disable alerts for client" : "Enable alerts for client"}</button></div>{message && <p className="form-success">{message}</p>}</section>;
}

function ChatPanel({ coach, client }: { coach: User; client: Client }) {
  const [chatId, setChatId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Array<{ id: string; sender: string; body: string; sentAt: string }>>([]);
  const [body, setBody] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  async function load() {
    if (!supabase) return;
    const { data, error } = await supabase.rpc("ensure_coach_chat", { p_client_uid: client.uid });
    if (error) { setMessage(error.message); return; }
    const id = data as string; setChatId(id);
    const { data: rows, error: messageError } = await supabase.from("coachChatMessages").select("coachChatMessages__id,coachChatMessages__senderUid,coachChatMessages__body,coachChatMessages__sentAt").eq("coachChatMessages__chatId", id).order("coachChatMessages__sentAt");
    if (messageError) setMessage(messageError.message); else setMessages((rows ?? []).map((row) => ({ id: row.coachChatMessages__id, sender: row.coachChatMessages__senderUid, body: row.coachChatMessages__body, sentAt: row.coachChatMessages__sentAt })));
  }
  useEffect(() => { void load(); }, [client.uid]);
  useEffect(() => {
    if (!supabase || !chatId) return;
    const channel = supabase.channel("chat-" + chatId).on("postgres_changes", { event: "INSERT", schema: "public", table: "coachChatMessages", filter: "coachChatMessages__chatId=eq." + chatId }, () => void load()).subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [chatId]);
  async function send(event: FormEvent) {
    event.preventDefault(); if (!supabase || !chatId || !body.trim()) return;
    const { error } = await supabase.from("coachChatMessages").insert({ coachChatMessages__chatId: chatId, coachChatMessages__senderUid: coach.id, coachChatMessages__body: body.trim() });
    if (error) setMessage(error.message); else setBody("");
  }
  return <section className="surface chat"><h2>Secure chat</h2><p>Messages are sent over TLS, stored in encrypted Supabase infrastructure and protected by a strict coach-client RLS boundary.</p>{message && <p className="form-error">{message}</p>}<div className="messages">{messages.map((item) => <article className={item.sender === coach.id ? "message own" : "message"} key={item.id}><p>{item.body}</p><small>{new Date(item.sentAt).toLocaleString()}</small></article>)}</div><form className="inline-form" onSubmit={send}><input value={body} onChange={(event) => setBody(event.target.value)} placeholder="Write a message" maxLength={4000} /><button className="button primary">Send</button></form></section>;
}

function Empty({ title, body }: { title: string; body: string }) { return <section className="empty"><h2>{title}</h2><p>{body}</p></section>; }
function weekday(day: number) { return ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"][day] ?? "Day"; }
function localDate() { return new Date().toLocaleDateString("en-CA"); }

import { FormEvent, useEffect, useState } from "react";
import { supabase } from "../lib/supabase";

type Exercise = { id: string; name: string };
type PlannedExercise = { id: string; name: string; position: number };
type PlannedSet = { id: string; exerciseId: string; number: number; repsMin: number | null; repsMax: number | null; weight: number | null };

export function WorkoutComposer({ planWorkoutId }: { planWorkoutId: string }) {
  const [catalogue, setCatalogue] = useState<Exercise[]>([]);
  const [planned, setPlanned] = useState<PlannedExercise[]>([]);
  const [sets, setSets] = useState<PlannedSet[]>([]);
  const [exerciseId, setExerciseId] = useState("");
  const [setExerciseId, setSetExerciseId] = useState("");
  const [reps, setReps] = useState("10");
  const [weight, setWeight] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  async function load() {
    if (!supabase) return;
    const [exerciseResponse, planResponse] = await Promise.all([
      supabase.from("exercises").select("exercises__id,exercises__name").order("exercises__name").limit(500),
      supabase.from("coachPlanWorkoutExercises").select("coachPlanWorkoutExercises__id,coachPlanWorkoutExercises__exerciseNameSnapshot,coachPlanWorkoutExercises__position").eq("coachPlanWorkoutExercises__planWorkoutId", planWorkoutId).order("coachPlanWorkoutExercises__position"),
    ]);
    if (exerciseResponse.error || planResponse.error) { setMessage(exerciseResponse.error?.message ?? planResponse.error?.message ?? "Could not load exercise data"); return; }
    const next = (planResponse.data ?? []).map((row) => ({ id: row.coachPlanWorkoutExercises__id, name: row.coachPlanWorkoutExercises__exerciseNameSnapshot, position: row.coachPlanWorkoutExercises__position }));
    setCatalogue((exerciseResponse.data ?? []).map((row) => ({ id: row.exercises__id, name: row.exercises__name })));
    setPlanned(next); setSetExerciseId((current) => current || next[0]?.id || "");
    if (next.length) {
      const { data, error } = await supabase.from("coachPlanWorkoutSets").select("coachPlanWorkoutSets__id,coachPlanWorkoutSets__planWorkoutExerciseId,coachPlanWorkoutSets__setNumber,coachPlanWorkoutSets__targetRepsMin,coachPlanWorkoutSets__targetRepsMax,coachPlanWorkoutSets__targetWeightKg").in("coachPlanWorkoutSets__planWorkoutExerciseId", next.map((item) => item.id)).order("coachPlanWorkoutSets__setNumber");
      if (error) setMessage(error.message); else setSets((data ?? []).map((row) => ({ id: row.coachPlanWorkoutSets__id, exerciseId: row.coachPlanWorkoutSets__planWorkoutExerciseId, number: row.coachPlanWorkoutSets__setNumber, repsMin: row.coachPlanWorkoutSets__targetRepsMin, repsMax: row.coachPlanWorkoutSets__targetRepsMax, weight: row.coachPlanWorkoutSets__targetWeightKg ? Number(row.coachPlanWorkoutSets__targetWeightKg) : null })));
    } else setSets([]);
  }
  useEffect(() => { void load(); }, [planWorkoutId]);

  async function addExercise(event: FormEvent) {
    event.preventDefault(); if (!supabase || !exerciseId) return;
    const source = catalogue.find((item) => item.id === exerciseId); if (!source) return;
    const { error } = await supabase.from("coachPlanWorkoutExercises").insert({
      coachPlanWorkoutExercises__planWorkoutId: planWorkoutId, coachPlanWorkoutExercises__exerciseId: source.id,
      coachPlanWorkoutExercises__exerciseNameSnapshot: source.name, coachPlanWorkoutExercises__position: planned.length + 1,
    });
    if (error) setMessage(error.message); else { setExerciseId(""); await load(); }
  }
  async function saveAsTemplate() {
    if (!supabase) return;
    const name = window.prompt("Name this reusable workout session");
    if (!name?.trim()) return;
    const { error } = await supabase.rpc("save_coach_plan_workout_as_template", {
      p_plan_workout_id: planWorkoutId,
      p_name: name.trim(),
      p_description: null,
    });
    setMessage(error ? error.message : "Workout saved to your private template library.");
  }
  async function addSet(event: FormEvent) {
    event.preventDefault(); if (!supabase || !setExerciseId) return;
    const position = sets.filter((item) => item.exerciseId === setExerciseId).length + 1;
    const { error } = await supabase.from("coachPlanWorkoutSets").insert({
      coachPlanWorkoutSets__planWorkoutExerciseId: setExerciseId, coachPlanWorkoutSets__setNumber: position,
      coachPlanWorkoutSets__targetRepsMin: Number(reps), coachPlanWorkoutSets__targetRepsMax: Number(reps),
      coachPlanWorkoutSets__targetWeightKg: weight === "" ? null : Number(weight), coachPlanWorkoutSets__setType: "WORKING",
    });
    if (error) setMessage(error.message); else { setWeight(""); await load(); }
  }

  return <div className="workout-composer">
    <div className="panel-head"><div><h3>Manual workout builder</h3><p>Add exercises from the Supabase exercise library, then define planned sets, reps and weight.</p></div><button type="button" className="button secondary" onClick={() => void saveAsTemplate()}>Save as session</button></div>
    {message && <p className="form-error">{message}</p>}
    <form className="inline-form" onSubmit={addExercise}><select value={exerciseId} onChange={(event) => setExerciseId(event.target.value)}><option value="">Choose exercise</option>{catalogue.map((exercise) => <option key={exercise.id} value={exercise.id}>{exercise.name}</option>)}</select><button className="button secondary">Add exercise</button></form>
    <ul className="plain-list">{planned.map((exercise) => <li key={exercise.id}><strong>{exercise.position}. {exercise.name}</strong><span>{sets.filter((item) => item.exerciseId === exercise.id).map((set) => "Set " + set.number + ": " + set.repsMin + " reps" + (set.weight !== null ? " @ " + set.weight + " kg" : "")).join(" · ") || "No prescribed sets"}</span></li>)}</ul>
    {planned.length > 0 && <form className="inline-form" onSubmit={addSet}><select value={setExerciseId} onChange={(event) => setSetExerciseId(event.target.value)}>{planned.map((exercise) => <option key={exercise.id} value={exercise.id}>{exercise.name}</option>)}</select><input value={reps} onChange={(event) => setReps(event.target.value)} inputMode="numeric" aria-label="Target reps" /><input value={weight} onChange={(event) => setWeight(event.target.value)} inputMode="decimal" placeholder="kg" aria-label="Target weight in kg" /><button className="button primary">Add set</button></form>}
  </div>;
}

import { FormEvent, useEffect, useState } from "react";
import { supabase } from "../lib/supabase";

type Recipe = { id: string; name: string };

export function RecipeScaler({ planMealId }: { planMealId: string }) {
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [recipeId, setRecipeId] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!supabase) return;
    void supabase
      .from("recipes")
      .select("recipes__id,recipes__name")
      .order("recipes__name")
      .then(({ data, error }) => {
        if (error) { setMessage(error.message); return; }
        setRecipes((data ?? []).map((row) => ({
          id: row.recipes__id,
          name: row.recipes__name,
        })));
      });
  }, []);

  async function scale(event: FormEvent) {
    event.preventDefault();
    if (!supabase || !recipeId) return;
    const { data, error } = await supabase.rpc("scale_recipe_to_plan_meal", {
      p_plan_meal_id: planMealId,
      p_recipe_id: recipeId,
    });
    setMessage(
      error
        ? error.message
        : "Recipe scaled. Factor: " + Number((data as { scaleFactor: number }).scaleFactor).toFixed(2),
    );
  }

  if (!recipes.length) return <p className="muted">Create a private recipe in the mobile library to scale it into this meal.</p>;
  return <form className="inline-form compact" onSubmit={scale}>
    <select value={recipeId} onChange={(event) => setRecipeId(event.target.value)} aria-label="Recipe to scale">
      <option value="">Scale a recipe to this meal</option>
      {recipes.map((recipe) => <option key={recipe.id} value={recipe.id}>{recipe.name}</option>)}
    </select>
    <button className="button secondary" disabled={!recipeId}>Scale recipe</button>
    {message && <small className={message.startsWith("Recipe") ? "form-success" : "form-error"}>{message}</small>}
  </form>;
}

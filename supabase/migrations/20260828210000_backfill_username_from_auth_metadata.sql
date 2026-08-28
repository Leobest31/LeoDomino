-- Backfill profiles.username from auth.users user_metadata.username.
-- CREATE in the repo for review. Do NOT apply to hosted Supabase until approved.
-- Does not copy display_name. Does not overwrite a claimed username.
-- Does not delete profiles, friendships, messages, matches, RP, or referrals.
-- Skips invalid handles and duplicate candidates.

WITH candidates AS (
  SELECT
    u.id,
    public.normalize_player_username(COALESCE(u.raw_user_meta_data->>'username', '')) AS handle
  FROM auth.users u
  JOIN public.profiles p ON p.id = u.id
  WHERE p.username IS NULL
),
ranked AS (
  SELECT
    id,
    handle,
    ROW_NUMBER() OVER (PARTITION BY handle ORDER BY id) AS rn
  FROM candidates
  WHERE handle IS NOT NULL
)
UPDATE public.profiles AS p
SET username = r.handle
FROM ranked r
WHERE p.id = r.id
  AND p.username IS NULL
  AND r.rn = 1
  AND NOT EXISTS (
    SELECT 1
    FROM public.profiles taken
    WHERE taken.username = r.handle
  );

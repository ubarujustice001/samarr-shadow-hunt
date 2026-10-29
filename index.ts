import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const url = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "Authentication required" }, 401);

  // Validate the caller's JWT with Supabase Auth; do not trust user/player IDs in the body.
  const callerClient = createClient(url, anonKey, { global: { headers: { Authorization: authHeader } } });
  const { data: { user }, error: authError } = await callerClient.auth.getUser();
  if (authError || !user) return json({ error: "Invalid session" }, 401);

  let body: { room_id?: string; player_id?: string; lat?: number; lng?: number; accuracy?: number };
  try { body = await req.json(); } catch { return json({ error: "Invalid JSON" }, 400); }
  const { room_id, player_id, lat, lng, accuracy } = body;
  if (!room_id || !player_id || !Number.isFinite(lat) || !Number.isFinite(lng) ||
      lat! < -90 || lat! > 90 || lng! < -180 || lng! > 180) {
    return json({ error: "Invalid location payload" }, 400);
  }

  const admin = createClient(url, serviceKey);
  const { data: player, error: playerError } = await admin
    .from("hunt_players")
    .select("id,user_id,room_id,display_name,role,location_opt_in")
    .eq("id", player_id).eq("user_id", user.id).eq("room_id", room_id).maybeSingle();
  if (playerError || !player) return json({ error: "Player membership not found" }, 403);
  if (player.role !== "shadow") return json({ error: "Only Shadows may publish location" }, 403);
  if (!player.location_opt_in) return json({ error: "Location sharing is not enabled" }, 403);

  const { data: room, error: roomError } = await admin
    .from("hunt_rooms").select("id,status").eq("id", room_id).maybeSingle();
  if (roomError || !room || room.status !== "running") return json({ error: "Game is not running" }, 409);

  // Publish only to the private Hunter location feed. Coordinates are not persisted.
  const channel = admin.channel(`hunt-location:${room_id}`, { config: { private: true } });
  const subscribed = await new Promise<boolean>((resolve) => {
    channel.subscribe((status) => {
      if (status === "SUBSCRIBED") resolve(true);
      if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") resolve(false);
    });
  });
  if (!subscribed) {
    await admin.removeChannel(channel);
    return json({ error: "Could not open secure location channel" }, 503);
  }
  const result = await channel.send({
    type: "broadcast",
    event: "shadow_location",
    payload: {
      player_id: player.id,
      name: player.display_name,
      lat, lng,
      accuracy: Number.isFinite(accuracy) ? Math.max(0, Math.min(accuracy!, 10000)) : null,
      at: Date.now()
    }
  });
  await admin.removeChannel(channel);
  if (result !== "ok") return json({ error: "Location broadcast failed" }, 503);
  return json({ ok: true }, 200);
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" }
  });
}

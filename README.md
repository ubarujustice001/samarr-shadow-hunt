# Samarr presents: Shadow Hunt — multiplayer starter

This is the next-step web app scaffold for a campus-based, mobile-friendly multiplayer game. It uses Vite + vanilla JavaScript and Supabase Auth/Database/Realtime.

## What is included
- Responsive phone-first lobby UI
- Hunter / Shadow role selection
- Supabase-backed room create/join RPC calls
- Player roster refreshed from database changes
- Realtime private-channel scaffold for game state
- Explicit location opt-in, a persistent sharing indicator, and immediate stop-sharing control
- Shadow GPS is sent to a Supabase Edge Function, which verifies user identity, room membership, Shadow role, opt-in state and running-game status before broadcasting
- Hunter-only private location feed with server-side Realtime read policy
- GPS coordinates are not written to a database by this starter
- Mission timers and campus safety copy

## Run locally
1. Install Node.js 20+.
2. Copy `.env.example` to `.env`.
3. Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.
4. In Supabase, enable **Anonymous Sign-ins**.
5. Run `supabase/schema.sql` in the Supabase SQL Editor.
6. Configure private Realtime channel authorization as described below.
7. Run:
   ```bash
   npm install
   npm run dev
   ```
8. Open the local URL printed by Vite. For location testing, use HTTPS or localhost.

## Backend setup still required
- Create a Supabase project and set its URL/key.
- Enable anonymous auth or replace it with university email sign-in.
- Deploy the Edge Function: `supabase functions deploy shadow-location`.
- Configure Realtime private-channel authorization so only room members can subscribe to `hunt:<room UUID>` and only authorised Hunters can subscribe to `hunt-location:<room UUID>`. Do not use public channels for player location.
- The Edge Function uses the service-role key server-side only. Never put the service-role key in the frontend `.env`.
- Verify the RLS policies and RPCs in a test project before launch. This is a starter scaffold, not a security-audited production service.
- Add a server-authoritative game engine for the timers, zone shrink, role rules, catch validation, host permissions and game completion. Client timers alone can be manipulated.
- Add a real map SDK and draw a host-defined campus boundary. The map placeholder is illustrative.
- Route location data by role on the server. The current sample broadcasts location events on the room channel and therefore must not be deployed for real player GPS until channel authorization and role-based visibility are implemented and tested. A safe production design sends exact/coarse location only to authorized Hunters and exposes only the approved scheduled ping to other users.
- Add rate limits, room expiry, abuse reporting, data-retention rules and a process for deleting location-related data.
- Add a proper account/session recovery approach if anonymous sign-in is not enough.

## Consent and safety
- Browser geolocation requires explicit browser permission and HTTPS (localhost is normally exempt).
- Ask for clear in-app consent before calling geolocation.
- Make sharing state visible and provide an immediate stop-sharing control.
- Explain who can see location, when it is shared, how long it is retained, and how to leave the game.
- For campus games, use an agreed play boundary, avoid roads/restricted buildings, and never encourage trespassing or physical contact.

## Important limitation
The app cannot connect to a live backend until a Supabase project is configured. Realtime location currently demonstrates the client event path only; production authorization and role-filtered location delivery are required before real gameplay.

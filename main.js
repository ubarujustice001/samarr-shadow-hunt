import { createClient } from '@supabase/supabase-js';
import './style.css';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;
const configured = Boolean(SUPABASE_URL && SUPABASE_KEY && !SUPABASE_URL.includes('YOUR_PROJECT'));
const supabase = configured ? createClient(SUPABASE_URL, SUPABASE_KEY) : null;

const state = {
  user: null, room: null, player: null, role: 'shadow', players: [],
  running: false, sharing: false, watchId: null, channel: null, locationChannel: null,
  lastPosition: null, hunterLocations: new Map(), gameEndsAt: null, timer: null
};

const app = document.querySelector('#app');
const escapeHtml = (s='') => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const code = () => Math.random().toString(36).slice(2, 7).toUpperCase();
const notify = msg => { const el = document.querySelector('#toast'); if (!el) return; el.textContent = msg; el.classList.add('show'); setTimeout(()=>el.classList.remove('show'), 2800); };

function render() {
  app.innerHTML = `
    <header class="topbar">
      <div class="brand"><div class="logo">⌁</div><div><small>SAMARR PRESENTS</small><h1>SHADOW HUNT</h1></div></div>
      <span class="live"><i></i>${state.room ? `ROOM ${escapeHtml(state.room.code)}` : 'CAMPUS EDITION'}</span>
    </header>
    <section class="hero">
      <div><small class="lime">STAY HIDDEN. STAY MOVING.</small><h2>THE CAMPUS IS YOURS.<br><span>DON'T GET CAUGHT.</span></h2>
      <p>Join the hunt. Pick a side. Watch the zone. Every move counts.</p></div>
      <div class="hero-stat"><small>GAME SETTINGS</small><div class="statline"><b>03:00</b><span>Location ping cycle</span></div><div class="statline"><b>10:00</b><span>Zone shrink cycle</span></div><div class="statline"><b>${state.players.length}</b><span>Players in room</span></div></div>
    </section>
    ${!configured ? `<section class="panel warning"><h3>Backend setup needed</h3><p>This project is ready to connect to Supabase. Add your project URL and publishable/anon key to a <code>.env</code> file, then run the SQL in <code>supabase/schema.sql</code>. Until then, room creation and realtime sync are disabled.</p></section>` : ''}
    <main class="grid">
      <section class="panel">
        <div class="panel-head"><div><h3>${state.room ? 'YOUR GAME ROOM' : 'ENTER THE HUNT'}</h3><p class="muted">${state.room ? 'Room updates sync through the backend.' : 'Create a lobby or join your friends with a code.'}</p></div><span class="tag">${state.room ? (state.running?'IN PROGRESS':'LOBBY') : 'READY'}</span></div>
        ${!state.room ? `<label>PLAYER NAME<input id="playerName" maxlength="20" placeholder="Your game name" value=""/></label>
          <div class="role-pick"><button class="role active" data-role="shadow">◉ <b>Shadow</b><small>Hide and survive</small></button><button class="role" data-role="hunter">⌖ <b>Hunter</b><small>Find the Shadows</small></button></div>
          <label>PLAY AREA<input id="campus" placeholder="Campus / university name" value="University campus"/></label>
          <div class="two"><button class="primary" id="create">CREATE ROOM</button><button class="secondary" id="showJoin">JOIN WITH CODE</button></div>
          <div id="joinBox" class="hidden"><label>ROOM CODE<input id="roomCode" maxlength="8" placeholder="Enter host's code"/></label><button class="primary full" id="join">JOIN GAME</button></div>` :
          `<div class="room-code"><small>SHARE THIS ROOM CODE</small><strong>${escapeHtml(state.room.code)}</strong><button class="secondary" id="copyCode">COPY CODE</button></div>
          <p class="muted">Play area: ${escapeHtml(state.room.campus || 'Campus')}</p>
          <div class="two"><button class="primary" id="start">${state.running?'GAME RUNNING':'START GAME'}</button><button class="secondary" id="leave">LEAVE ROOM</button></div>`}
        <div class="divider"></div>
        <div class="panel-head"><div><h3>PLAYER ROSTER</h3><p class="muted">Only players in this room appear here.</p></div><b>${state.players.length}</b></div>
        <div id="players" class="players">${state.players.map(p=>playerMarkup(p)).join('') || '<p class="empty">Your crew will show up here.</p>'}</div>
      </section>
      <section class="panel">
        <div class="panel-head"><div><h3>LOCATION & SAFETY</h3><p class="muted">Only opted-in Shadows share with authorised Hunters.</p></div><span class="tag ${state.sharing?'sharing-tag':''}">${state.sharing?'● SHARING':'SHARING OFF'}</span></div>
        <div class="map-placeholder"><div class="zone"></div><div class="map-center">⌖</div><div class="map-caption">CAMPUS ARENA<br><small>Live player map integration required</small></div></div>
        <div class="consent"><b>${state.sharing?'● YOUR LOCATION IS SHARING':'Location sharing is optional'}</b><p>${state.sharing?'Your location is being sent to authorised Hunters. Stop sharing immediately at any time.':'Only Shadows who explicitly opt in share their live location. Authorised Hunters can receive it while the game is running.'}</p>
          <button id="share" class="${state.sharing?'danger':'primary'} full" ${!state.room || !state.running || state.role!=='shadow' ? 'disabled' : ''}>${state.sharing?'STOP SHARING LOCATION':'OPT IN & SHARE LOCATION'}</button>
        </div>
        ${state.role==='hunter' ? `<div class="location-list"><b>SHADOW SIGNALS</b><p class="muted">Only opted-in Shadows appear here.</p>${[...state.hunterLocations.values()].map(x=>`<div class="signal"><span class="signal-dot"></span><span>${escapeHtml(x.name || 'Shadow')}</span><small>Updated ${Math.max(0,Math.round((Date.now()-x.at)/1000))}s ago</small></div>`).join('') || '<p class="empty">No live signals received.</p>'}</div>` : ''}
        <div class="divider"></div>
        <div class="timers"><div><small>GAME TIMER</small><b id="gameTimer">--:--</b></div><div><small>NEXT PING</small><b id="pingTimer">03:00</b></div><div><small>NEXT ZONE SHRINK</small><b id="zoneTimer">10:00</b></div><div><small>ZONE STAGE</small><b id="stage">01 / 04</b></div></div>
        <p class="safety-note">Campus play only: agree a boundary before starting. No roads, rooftops, restricted buildings, chasing strangers or entering private spaces.</p>
      </section>
    </main>
    <footer>© Samarr presents: Shadow Hunt · Campus edition <span>Location is opt-in. Stop sharing whenever you want.</span></footer>
    <div id="toast" class="toast"></div>`;
  bind();
}

function playerMarkup(p) {
  const name = p.display_name || 'Player';
  return `<div class="player"><div class="avatar">${escapeHtml(name.slice(0,1).toUpperCase())}</div><div class="player-info"><b>${escapeHtml(name)}</b><small>${escapeHtml(p.status || 'Joined')}</small></div><span class="role-tag ${p.role==='hunter'?'hunter':''}">${escapeHtml(p.role || 'shadow')}</span></div>`;
}
function bind() {
  document.querySelectorAll('[data-role]').forEach(b=>b.onclick=()=>{state.role=b.dataset.role;document.querySelectorAll('[data-role]').forEach(x=>x.classList.toggle('active',x===b));});
  document.querySelector('#create')?.addEventListener('click', createRoom);
  document.querySelector('#showJoin')?.addEventListener('click',()=>document.querySelector('#joinBox').classList.toggle('hidden'));
  document.querySelector('#join')?.addEventListener('click',joinRoom);
  document.querySelector('#copyCode')?.addEventListener('click',async()=>{await navigator.clipboard.writeText(state.room.code);notify('Room code copied')});
  document.querySelector('#start')?.addEventListener('click',startGame);
  document.querySelector('#leave')?.addEventListener('click',leaveRoom);
  document.querySelector('#share')?.addEventListener('click',()=>state.sharing?stopSharing():startSharing());
}

async function ensureUser() {
  if (!supabase) throw new Error('Add Supabase credentials first.');
  if (state.user) return state.user;
  // Enable Anonymous Sign-ins in Supabase Auth for this flow.
  const {data,error}=await supabase.auth.signInAnonymously();
  if(error) throw error;
  state.user=data.user; return state.user;
}
async function createRoom() {
  try {
    const user=await ensureUser();
    const name=document.querySelector('#playerName').value.trim();
    const campus=document.querySelector('#campus').value.trim();
    if(!name) return notify('Enter your player name first.');
    // Room creation is an RPC so room code generation and host membership happen atomically.
    const {data,error}=await supabase.rpc('create_hunt_room',{p_code:code(),p_campus:campus || 'University campus',p_display_name:name,p_role:state.role});
    if(error) throw error;
    const room = Array.isArray(data) ? data[0] : data;
    await enterRoom(room.room_id,room.room_code,room.campus,room.player_id,true);
  } catch(e) { notify(e.message || 'Could not create room'); }
}
async function joinRoom() {
  try {
    await ensureUser();
    const name=document.querySelector('#playerName').value.trim();
    const roomCode=document.querySelector('#roomCode').value.trim().toUpperCase();
    if(!name || !roomCode) return notify('Enter your name and room code.');
    const {data,error}=await supabase.rpc('join_hunt_room',{p_code:roomCode,p_display_name:name,p_role:state.role});
    if(error) throw error;
    const room = Array.isArray(data) ? data[0] : data;
    await enterRoom(room.room_id,room.room_code,room.campus,room.player_id,false);
  } catch(e) { notify(e.message || 'Could not join room'); }
}
async function enterRoom(id,roomCode,campus,playerId,isHost) {
  state.room={id,code:roomCode,campus,host:isHost};state.player={id:playerId};
  const {data,error}=await supabase.from('hunt_players').select('id,display_name,role,status').eq('room_id',id).order('created_at');
  if(error) throw error;
  state.players=data || [];
  state.channel=supabase.channel(`hunt:${id}`,{config:{private:true}})
    .on('broadcast',{event:'game_state'},({payload})=>{state.running=payload.running;state.gameEndsAt=payload.endsAt || null;render();})
    .subscribe();
  // Only Hunters subscribe to the private location feed. The server-side Realtime
  // SELECT policy also checks room membership, role, and active game state.
  if(state.role==='hunter') {
    state.locationChannel=supabase.channel(`hunt-location:${id}`,{config:{private:true}})
      .on('broadcast',{event:'shadow_location'},({payload})=>handleLocation(payload))
      .subscribe((status)=>{ if(status==='CHANNEL_ERROR') notify('Could not connect to the secure Hunter signal feed.'); });
  }
  supabase.channel(`room-db:${id}`).on('postgres_changes',{event:'*',schema:'public',table:'hunt_players',filter:`room_id=eq.${id}`},async()=>refreshPlayers()).subscribe();
  render();notify(isHost?'Room created. Share the code with players.':'You joined the room.');
}
async function refreshPlayers() {
  if(!state.room)return;
  const {data}=await supabase.from('hunt_players').select('id,display_name,role,status').eq('room_id',state.room.id).order('created_at');
  if(data){state.players=data;render();}
}
async function startGame() {
  if(!state.room?.host) return notify('Only the room host can start the game.');
  const endsAt=new Date(Date.now()+30*60*1000).toISOString();
  const {error}=await supabase.from('hunt_rooms').update({status:'running',started_at:new Date().toISOString(),ends_at:endsAt}).eq('id',state.room.id);
  if(error)return notify(error.message);
  state.running=true;state.gameEndsAt=endsAt;
  await state.channel?.send({type:'broadcast',event:'game_state',payload:{running:true,endsAt}});
  render();notify('Game started. Players can opt in to location sharing.');
}
async function leaveRoom() {
  await stopSharing();
  if(state.channel) await supabase.removeChannel(state.channel);
  if(state.locationChannel) await supabase.removeChannel(state.locationChannel);
  state.channel=null;state.locationChannel=null;state.room=null;state.player=null;state.players=[];state.running=false;state.hunterLocations.clear();render();
}
function handleLocation(payload) {
  // The server emits this event only to authorised Hunters in this room.
  if(state.role!=='hunter' || !payload?.player_id || !Number.isFinite(payload.lat) || !Number.isFinite(payload.lng)) return;
  state.hunterLocations.set(payload.player_id,{name:payload.name || 'Shadow',lat:payload.lat,lng:payload.lng,accuracy:payload.accuracy,at:payload.at || Date.now()});
  // Coordinates stay in memory only; they are not written to browser storage.
  render();
}
async function setLocationConsent(enabled) {
  if(!state.player?.id) throw new Error('Join a room first.');
  const {error}=await supabase.rpc('set_location_opt_in',{p_player_id:state.player.id,p_enabled:enabled});
  if(error) throw error;
}
async function startSharing() {
  if(!state.room || !state.running) return notify('Join a running room first.');
  if(state.role!=='shadow') return notify('Only Shadows can share their location.');
  if(!navigator.geolocation) return notify('This browser does not support location.');
  const confirmed=window.confirm('OPT IN TO LIVE LOCATION SHARING? Your live location will be shared with authorised Hunters while the game is running. You can stop sharing at any time.');
  if(!confirmed)return;
  try {
    await setLocationConsent(true);
    state.sharing=true;render();
    state.watchId=navigator.geolocation.watchPosition(async pos=>{
      if(!state.sharing || !state.room || !state.player) return;
      state.lastPosition={lat:pos.coords.latitude,lng:pos.coords.longitude,accuracy:pos.coords.accuracy};
      // The Edge Function verifies the signed-in player, active room, Shadow role,
      // and stored opt-in before broadcasting to the Hunter-only private channel.
      const {error}=await supabase.functions.invoke('shadow-location',{body:{
        room_id:state.room.id,player_id:state.player.id,
        lat:pos.coords.latitude,lng:pos.coords.longitude,accuracy:pos.coords.accuracy
      }});
      if(error) notify('Location update was rejected. Sharing remains enabled until you stop it.');
    },err=>{
      state.sharing=false;
      setLocationConsent(false).catch(()=>{});
      notify(err.code===1?'Location permission was denied.':'Could not get your location.');
      render();
    },{enableHighAccuracy:true,maximumAge:3000,timeout:12000});
    notify('Live sharing is ON. Stop sharing any time.');
  } catch(e) {
    state.sharing=false;
    notify(e.message || 'Could not enable location sharing.');
  }
  render();
}
async function stopSharing() {
  // Stop browser updates first, before making any network request.
  if(state.watchId!==null && navigator.geolocation) navigator.geolocation.clearWatch(state.watchId);
  state.watchId=null;state.sharing=false;state.lastPosition=null;
  render();
  try { await setLocationConsent(false); } catch(e) { notify('Sharing stopped on this device; server consent update needs attention.'); return; }
  notify('Location sharing stopped.');
}
let remaining=1800,ping=180,zone=600,stage=1;
setInterval(()=>{
  if(!state.running)return;
  if(remaining>0)remaining--;if(ping>0)ping--;if(zone>0)zone--;
  if(ping===0)ping=180;
  if(zone===0){zone=600;stage=Math.min(4,stage+1)}
  const timer=document.querySelector('#gameTimer');if(timer)timer.textContent=`${String(Math.floor(remaining/60)).padStart(2,'0')}:${String(remaining%60).padStart(2,'0')}`;
  const p=document.querySelector('#pingTimer');if(p)p.textContent=`${String(Math.floor(ping/60)).padStart(2,'0')}:${String(ping%60).padStart(2,'0')}`;
  const z=document.querySelector('#zoneTimer');if(z)z.textContent=`${String(Math.floor(zone/60)).padStart(2,'0')}:${String(zone%60).padStart(2,'0')}`;
  const s=document.querySelector('#stage');if(s)s.textContent=`${String(stage).padStart(2,'0')} / 04`;
},1000);

render();

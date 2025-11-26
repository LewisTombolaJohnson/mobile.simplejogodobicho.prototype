import { Application, Container, Graphics, Text, TextStyle, Rectangle } from 'pixi.js';
// Vite env typing shim for TypeScript (dev-mobile flag)
declare global {
  interface ImportMetaEnv { VITE_MOBILE?: string; }
  interface ImportMeta { env: ImportMetaEnv; }
}
// Diagnostic flags for external inspection
// @ts-ignore
window.__PIXIBUNDLE_LOADED = true;
console.log('[diag] bundle evaluated');
import { animals } from './animals';

// Force an immediate mobile detection log as early as possible so user can see it even before Pixi init.
const BUILD_TAG = 'mobile-layout-fallback-1';
console.log('[build-tag]', BUILD_TAG);
// Capture env flag once (Vite replaces import.meta.env.* statically); if present, set a hard override.
// This guarantees dev-mobile enforces mobile layout even if later heuristics conflict.
const __ENV_MOBILE_FLAG = !!import.meta.env.VITE_MOBILE;
// @ts-ignore
if (__ENV_MOBILE_FLAG) { window.__FORCE_MOBILE = true; console.log('[env-mobile-flag] Detected VITE_MOBILE -> forcing mobile layout'); }
// Explicit dev-mobile flag for simpler branching
const DEV_MOBILE_MODE = __ENV_MOBILE_FLAG === true;
console.log('[dev-mobile-flag]', { DEV_MOBILE_MODE, raw: import.meta.env.VITE_MOBILE });
try {
  // @ts-ignore
  const earlyMobile = !!(import.meta as any).env?.VITE_MOBILE;
  console.log('[early-mobile-check] VITE_MOBILE present:', earlyMobile, 'raw value:', (import.meta as any).env?.VITE_MOBILE);
  // Store for external inspection
  // @ts-ignore
  window.__EARLY_MOBILE = earlyMobile;
} catch(err){
  console.warn('[early-mobile-check] failed', err);
}

// Ticket data structures
interface Ticket { id:number; animals:number[]; complete:boolean; stake:number; lastWin?:number; posMatches?:boolean[]; anyMatches?:boolean[]; randomBuilding?:boolean; tempPotentialWin?:number; winProb?:number; evMult?:number; }
let tickets: Ticket[] = [];
// Track a manual 5th selection currently flying (orange outline)
let manualFlightInProgress: number | null = null;
let editingTicketId: number | null = null;
let nextTicketId = 1;
const TICKET_HEIGHT = 72; // reverted to original ticket height
const SLOT_ROW_Y = 34; // reverted original slot row Y
// Slow reorder animation factor (higher -> faster). Targets full settle over ~ baseDelay window.
const REORDER_LERP_FACTOR = 0.12;
// Bonus flag probability (per result slot)
const BONUS_FLAG_PROB = 0.20; // adjust for tuning; higher = more frequent bonus rounds
// Motion map retains Graphics reference + target Y so we can smoothly approach between renders
const ticketMotion: Record<number,{card:Graphics; targetY:number}> = {};
// --- Audio removed: provide inert stub to avoid runtime errors where audio.play was called ---
class AudioStub {
  play(_key: string, _opts?: { volume?: number; force?: boolean }) { /* no-op */ }
  beep(_f?: number, _d?: number) { /* no-op */ }
  mute() {}
  unmute() {}
}
const audio = new AudioStub();

// Helper to read current stake from stake-value element (avoids ordering issues)
function getCurrentStake(): number {
  const el = document.getElementById('stake-value');
  if (!el) return 0.05;
  const raw = el.textContent || '5p';
  if (raw.endsWith('p')) {
    const num = parseInt(raw.replace(/[^0-9]/g,''),10);
    return isNaN(num)?0.05:num/100;
  }
  // pounds format £X or £X.XX
  const num = parseFloat(raw.replace(/£/,'').trim());
  return isNaN(num)?0.05:num;
}

function formatStakeValue(v:number){ return v < 1 ? `${(v*100).toFixed(0)}p` : `£${v.toFixed(2)}`; }

const MAX_TOTAL_STAKE = 10; // £10 total stake limit for confirmed tickets
function totalConfirmedStake(){ return tickets.filter(t=>t.complete).reduce((sum,t)=> sum + t.stake,0); }
function totalPendingStake(){ return tickets.filter(t=>!t.complete).reduce((sum,t)=> sum + t.stake,0); }
// Gameplay state flags (moved earlier to avoid TDZ issues in updatePlayButtonState)
let isPlaying = false;
function updatePlayButtonState(){
  const btn = document.getElementById('play-btn') as HTMLButtonElement | null;
  if (!btn) return;
  const hasCompleted = tickets.some(t=>t.complete);
  if (!hasCompleted || isPlaying){
    btn.setAttribute('disabled','true');
    btn.style.opacity = '0.35';
    btn.style.cursor = 'not-allowed';
  } else {
    btn.removeAttribute('disabled');
    btn.style.opacity = '1';
    btn.style.cursor = 'pointer';
  }
  updateRandomButtonState();
}
function refreshStakeLimitStatus(){
  const limitEl = document.querySelector('.stake-limit');
  if (!limitEl) return;
  const used = totalConfirmedStake() + totalPendingStake();
  if (used >= MAX_TOTAL_STAKE){
    limitEl.textContent = `Stake limit reached (£${MAX_TOTAL_STAKE})`;
    (limitEl as HTMLElement).style.color = '#ff7675';
  } else {
    limitEl.textContent = `Overall stake limit £${MAX_TOTAL_STAKE}`;
    (limitEl as HTMLElement).style.color = '#8293a3';
  }
}

// Override ensureEditingTicket to respect limit
function ensureEditingTicket() {
  if (editingTicketId === null) {
    const stake = getCurrentStake();
    const projected = totalConfirmedStake() + totalPendingStake() + stake;
    if (projected > MAX_TOTAL_STAKE){
      // Could add toast; for now just ignore creation
      console.log('Stake limit exceeded, cannot create new ticket');
      return;
    }
  const t: Ticket = { id: nextTicketId++, animals: [], complete:false, stake, winProb:0, evMult:0 };
  tickets.unshift(t); editingTicketId = t.id; renderTickets(); refreshStakeLimitStatus(); updatePlayButtonState(); updateClearButtonState();
  }
}

function deleteTicket(id:number){
  tickets = tickets.filter(t=>t.id!==id);
  if (editingTicketId === id) editingTicketId = null;
  renderTickets(); buildGrid(); layout(); refreshStakeLimitStatus(); updatePlayButtonState(); updateClearButtonState();
}

function currentEditingTicket(): Ticket | null {
  return tickets.find(t => t.id === editingTicketId) || null;
}

function addAnimalToTicket(animalId: number) {
  ensureEditingTicket();
  const t = currentEditingTicket();
  if (!t || t.complete) return;
  if (t.animals.includes(animalId)) return;
  const isFifth = t.animals.length === 4; // about to add 5th
  if (isFifth) {
    manualFlightInProgress = animalId; // mark before push for highlight
  }
  if (t.animals.length < 5) {
  t.animals.push(animalId);
  updateTicketOdds(t);
    audio.play('select');
    // completion handled after flight animation ends (see pointer tap handler)
    renderTickets(); buildGrid(); layout(); refreshStakeLimitStatus(); updatePlayButtonState(); updateClearButtonState();
  }
}

function confirmTicket(id:number) {
  const t = tickets.find(tt=>tt.id===id); if (!t) return;
  t.complete = true; if (editingTicketId === id) editingTicketId = null;
  audio.play('confirm');
  renderTickets(); buildGrid(); layout(); refreshStakeLimitStatus(); updatePlayButtonState(); updateClearButtonState();
}

function clearTickets() {
  tickets = []; editingTicketId = null; nextTicketId = 1;
  renderTickets(); buildGrid(); layout(); refreshStakeLimitStatus(); updatePlayButtonState(); updateClearButtonState();
}

// Deferred Pixi bootstrap: wait for DOMContentLoaded so #app-root exists; handle duplicate roots.
let app: Application;
let leftContainer: Container; let centerContainer: Container; let rightContainer: Container;
async function initPixi(){
  console.log('[bootstrap] starting');
  try {
    app = new Application();
    await app.init({ background: '#12151c', resizeTo: window, antialias: true, preference: 'webgl' });
  } catch(err){
    console.error('[bootstrap] app.init failed', err);
    // @ts-ignore
    window.__PIXIBOOT_ERROR = err;
    return;
  }
  const roots = Array.from(document.querySelectorAll('#app-root')) as HTMLElement[];
  if (roots.length > 1){
    console.warn('[bootstrap] multiple #app-root elements found; removing extras', roots.length);
    roots.slice(1).forEach(r=> r.remove());
  }
  const root = roots[0] || (()=> {
    const r = document.createElement('div'); r.id='app-root'; document.body.prepend(r); return r;
  })();
  try {
    root.appendChild(app.canvas);
  } catch(err){
    console.error('[bootstrap] append canvas failed', err);
    // @ts-ignore
    window.__PIXICANVAS_ERROR = err;
    return;
  }
  console.log('[bootstrap] Pixi application initialized', {
    size: { w: app.renderer.width, h: app.renderer.height },
    dpr: window.devicePixelRatio,
    rendererType: app.renderer.type
  });
  // @ts-ignore
  window.__PIXIBOOT_DONE = true;
  // Containers (declare after app exists)
  leftContainer = new Container();
  centerContainer = new Container();
  rightContainer = new Container();
  app.stage.addChild(leftContainer, centerContainer, rightContainer);
  app.stage.sortableChildren = true;
  // Continue initial UI construction once Pixi ready
  postInit();
}
if (document.readyState === 'loading'){
  document.addEventListener('DOMContentLoaded', () => { initPixi(); });
} else {
  initPixi();
}

// Code that depends on containers/app moved into postInit to ensure ordering.
function postInit(){
  // Instantiate ticket panel structures now that leftContainer exists
  ticketsHeaderContainer = new Container();
  ticketsListContainer = new Container();
  ticketsScrollbar = new Graphics();
  leftContainer.addChild(ticketsHeaderContainer, ticketsListContainer, ticketsScrollbar);
  // Additional explicit mobile layout log inside postInit to ensure visibility
  console.log('[postInit] isMobileLayout() =>', isMobileLayout());
  attachTicketPanelInteractions();
  // Initial ticket render & layout chain
  renderTickets(); refreshStakeLimitStatus(); updatePlayButtonState(); updateRandomButtonState(); updateClearButtonState();
  buildGrid();
  layout();
  // No debug banner in production/dev; layout changes will be visible directly
  window.addEventListener('resize', () => { buildGrid(); layout(); });
}

// Containers declared in initPixi; placeholder comments retained for context.

// Ticket panel containers (created after Pixi init in postInit)
let ticketsHeaderContainer: Container;
let ticketsListContainer: Container;
let ticketsScrollY = 0;
let ticketsScrollX = 0; // horizontal scroll for mobile mode
let ticketsVisibleHeight = 0; // height of scrollable area (mask height)
let ticketsVisibleWidth = 0; // width of scrollable area (mask width for mobile)
let ticketsPanelHeight = 0;
let ticketsScrollbar: Graphics;
let isDraggingTickets = false;
let dragStartY = 0;
let dragStartX = 0;
let dragInitialScrollY = 0;
let dragInitialScrollX = 0;
function getContentHeight(): number {
  // Deterministic formula: each ticket has TICKET_HEIGHT plus 10px gap, except last gap removed
  if (!tickets.length) return 0;
  if (isMobileLayout()) {
    // In mobile: tickets arranged horizontally, so height is just one ticket
    return TICKET_HEIGHT;
  }
  return tickets.length * (TICKET_HEIGHT + 10) - 10; // last ticket no trailing gap
}

function getContentWidth(): number {
  // For mobile horizontal layout: compute total width of tickets side-by-side
  if (!tickets.length) return 0;
  const gap = 10;
  return tickets.length * (SIDE_COLUMN_WIDTH + gap) - gap; // last ticket no trailing gap
}
function scrollTicketsBy(delta:number){
  if (isMobileLayout()) {
    // Horizontal scrolling in mobile mode
    const contentWidth = getContentWidth();
    if (contentWidth <= ticketsVisibleWidth){
      ticketsScrollX = 0;
      ticketsListContainer.x = 0;
      updateTicketsScrollbar();
      return;
    }
    const minX = Math.min(0, ticketsVisibleWidth - contentWidth);
    ticketsScrollX = Math.max(minX, Math.min(0, ticketsScrollX - delta));
    ticketsListContainer.x = ticketsScrollX;
    updateTicketsScrollbar();
  } else {
    // Vertical scrolling in desktop mode
    const contentHeight = getContentHeight();
    if (contentHeight <= ticketsVisibleHeight){
      ticketsScrollY = 0;
      ticketsListContainer.y = 28;
      updateTicketsScrollbar();
      console.log('[scroll] No scroll needed; content <= visible', { contentHeight, visible: ticketsVisibleHeight });
      return;
    }
    const minY = Math.min(0, ticketsVisibleHeight - contentHeight);
    ticketsScrollY = Math.max(minY, Math.min(0, ticketsScrollY - delta));
    ticketsListContainer.y = 28 + ticketsScrollY;
    console.log('[scroll] wheel/drag', { delta, contentHeight, visible: ticketsVisibleHeight, minY, scrollY: ticketsScrollY });
    updateTicketsScrollbar();
  }
}
function updateTicketsScrollbar(){
  // Visual scrollbar removed per request; keep function to maintain calls for layout consistency.
  ticketsScrollbar.clear();
  // Intentionally no drawing. Scrolling still works via wheel/drag adjusting ticketsScrollY.
}
// Interaction attachment deferred until containers exist
function attachTicketPanelInteractions(){
  if (!leftContainer || !ticketsHeaderContainer) return;
  leftContainer.eventMode = 'static';
  leftContainer.on('pointerdown', (e:any)=>{
    const local = e.getLocalPosition(leftContainer);
    if (isMobileLayout()) {
      // In mobile: horizontal drag
      if (local.y >= 0 && local.y <= TICKET_HEIGHT + 28 && local.x >= 0 && local.x <= ticketsVisibleWidth) {
        isDraggingTickets = true;
        dragStartX = local.x;
        dragInitialScrollX = ticketsScrollX;
      }
    } else {
      // Desktop: vertical drag
      if (local.x >=0 && local.x <= SIDE_COLUMN_WIDTH && local.y >= 28 && local.y <= 28 + ticketsVisibleHeight){
        isDraggingTickets = true;
        dragStartY = local.y;
        dragInitialScrollY = ticketsScrollY;
      }
    }
  });
  leftContainer.on('pointerup', ()=>{ isDraggingTickets = false; });
  leftContainer.on('pointerupoutside', ()=>{ isDraggingTickets = false; });
  leftContainer.on('pointermove', (e:any)=>{
    if (!isDraggingTickets) return;
    const local = e.getLocalPosition(leftContainer);
    if (isMobileLayout()) {
      const dx = local.x - dragStartX;
      scrollTicketsBy(-dx);
      dragStartX = local.x; // reset for continuous drag
    } else {
      const dy = local.y - dragStartY;
      scrollTicketsBy(-dy);
    }
  });
}

let winGlowRefs: Graphics[] = [];

// Precomputed odds/expected value per ticket size (1..5) irrespective of specific animals chosen.
// This assumes draws are uniformly random among animals and ticket animal identities don't affect probability structure.
interface SizeOdds { winProb:number; evMult:number; }
const sizeOddsMap: Record<number, SizeOdds> = {};
function precomputeSizeOdds(){
  // Always recompute on load so changes to multiplier table propagate.
  for (const k of Object.keys(sizeOddsMap)) delete sizeOddsMap[+k];
  const ITERATIONS = 22000; // single upfront heavier Monte Carlo for stable values
  for (let size=1; size<=5; size++){
  let winCount=0; let totalMult=0;
    // Create a synthetic ticket with first 'size' distinct animal ids (identity irrelevant)
    const synthetic: Ticket = { id:-1, animals: animals.slice(0,size).map(a=>a.id), complete:false, stake:0, winProb:0, evMult:0 };
    for (let i=0;i<ITERATIONS;i++){
      const drawn: number[] = [];
      for (let d=0; d<5; d++) drawn.push(animals[Math.floor(Math.random()*animals.length)].id);
  const { multiplier } = computeTicketWin(synthetic, drawn);
  if (multiplier>0) winCount++;
  totalMult += multiplier;
    }
  sizeOddsMap[size] = { winProb: winCount/ITERATIONS, evMult: totalMult/ITERATIONS };
  }
  console.log('[odds] size precompute complete', sizeOddsMap);
}
precomputeSizeOdds();
function updateTicketOdds(ticket:Ticket){
  const size = ticket.animals.length;
  if (size === 0){ ticket.winProb = 0; ticket.evMult = 0; return; }
  const cached = sizeOddsMap[size];
  if (cached){ ticket.winProb = cached.winProb; ticket.evMult = cached.evMult; }
}

function renderTickets(){
  if (!app || !leftContainer || !ticketsHeaderContainer || !ticketsListContainer) return;
  winGlowRefs = [];
  ticketsListContainer.removeChildren();
  // Header (simple summary / could show total stake)
  ticketsHeaderContainer.removeChildren();
  const totalStake = totalConfirmedStake() + totalPendingStake();
  const headerStyle = new TextStyle({ fill:'#ffcc66', fontSize:16, fontFamily:'system-ui', fontWeight:'600' });
  const hdrText = new Text(`Tickets (${tickets.length}) • Stake: ${formatStakeValue(totalStake)}`, headerStyle);
  hdrText.anchor.set(0.5,0); 
  if (isMobileLayout()) {
    // Center the header across the full panel width; if not yet initialized, compute a safe width
    ticketsHeaderContainer.x = 0;
    const marginX = 20;
    const deviceW = window.innerWidth;
    const baseGridWidth = centerContainer?.width || (CARD_SIZE * GRID_COLS + GRID_GAP * (GRID_COLS - 1));
    const fallbackWidth = Math.max(Math.min(deviceW - marginX * 2, baseGridWidth), 320);
    const panelWidth = ticketsVisibleWidth && ticketsVisibleWidth > 0 ? ticketsVisibleWidth : fallbackWidth;
    hdrText.x = panelWidth / 2;
  } else {
    hdrText.x = SIDE_COLUMN_WIDTH/2;
  }
  hdrText.y = 4; // slight top offset to align visually with right column header
  ticketsHeaderContainer.addChild(hdrText);
  
  tickets.forEach((ticket, idx) => {
    const panelWidth = SIDE_COLUMN_WIDTH;
    const card = new Graphics(); card.roundRect(0,0,panelWidth,TICKET_HEIGHT,16); card.fill({ color:0x232a34 }); card.stroke({ color:0x2f3d4b, width:2 }); 
    
    if (isMobileLayout()) {
      // Horizontal layout: cards side by side
      card.x = idx * (panelWidth + 10);
      card.y = 0;
    } else {
      // Vertical layout: cards stacked
      card.x = 0;
      card.y = idx * (TICKET_HEIGHT + 10);
    }
    
    // Motion tracking setup
    if (!ticketMotion[ticket.id]){ 
      ticketMotion[ticket.id] = { card, targetY: card.y }; 
    } else {
      // Retain existing card reference if possible
      ticketMotion[ticket.id].targetY = card.y;
    }
    // Header stake / win
    const stakeStr = formatStakeValue(ticket.stake);
    const winSuffix = ticket.lastWin && ticket.lastWin > 0 ? `  +${formatStakeValue(ticket.lastWin)}` : '';
    const headerStyle = new TextStyle({ fill: ticket.lastWin && ticket.lastWin>0 ? '#ffd54f' : '#ffcc66', fontSize:15, fontFamily:'system-ui', fontWeight:'600' });
    const header = new Text(stakeStr + winSuffix, headerStyle); header.anchor.set(0,0); header.x = 10; header.y = 6; card.addChild(header);
    // Odds text removed per user request; winProb still computed for potential future internal use.
    if (ticket.lastWin && ticket.lastWin>0){
      const glow = new Graphics(); glow.roundRect(-4,-4,panelWidth+8,TICKET_HEIGHT+8,18); glow.stroke({ color:0xffd54f, width:3 }); glow.alpha = 0.3; card.addChild(glow); winGlowRefs.push(glow);
    }
    // Slots
  const slotSize = 34; const slotGap = 6; const totalSlotsWidth = slotSize * 5 + slotGap * 4; const startX = (panelWidth - totalSlotsWidth)/2; const startY = SLOT_ROW_Y;
    for (let i=0;i<5;i++){
      const hasAnimal = i < ticket.animals.length;
      const positional = hasAnimal && ticket.posMatches && ticket.posMatches[i];
      const anyMatch = hasAnimal && ticket.anyMatches && ticket.anyMatches[i];
      const slot = new Graphics(); slot.roundRect(0,0,slotSize,slotSize,8);
      let fillColor = 0x1b222b;
      if (hasAnimal) fillColor = 0x283342;
      if (anyMatch) fillColor = 0x5d4a1a;
      if (positional) fillColor = 0x1e4d2b;
      slot.fill({ color: fillColor });
      slot.stroke({ color: positional ? 0x66bb6a : anyMatch ? 0xffd54f : 0x2f3d4b, width:1 });
      slot.x = startX + i*(slotSize + slotGap); slot.y = startY;
      if (hasAnimal){
        const a = animals.find(a=>a.id===ticket.animals[i]);
        if (a){
          const emo = new Text(a.emoji, new TextStyle({ fill:'#fff', fontSize:22 })); emo.anchor.set(0.5); emo.x=slotSize/2; emo.y=slotSize/2; slot.addChild(emo);
          if (positional || anyMatch){
            const markerChar = positional ? '\u2713' : '\u2605';
            const marker = new Text(markerChar, new TextStyle({ fill: positional ? '#6ef392' : '#ffd54f', fontSize:14, fontWeight:'700' })); marker.anchor.set(1,0); marker.x = slotSize - 4; marker.y = 4; slot.addChild(marker);
          }
        }
      }
      card.addChild(slot);
    }
    // Action buttons
    if (!ticket.complete){
      const radius = 12.6; const gap = 5; const topY = 20; const rightEdge = panelWidth - 10; const confirmCenterX = rightEdge - radius; const deleteCenterX = confirmCenterX - (radius*2) - gap;
      const makeCircle = (color:number, stroke:number, x:number, enabled:boolean, label:string, onTap?:()=>void) => {
        const g = new Graphics(); g.circle(0,0,radius); g.fill({ color }); g.stroke({ color: stroke, width:2 }); g.x = x; g.y = topY; const txt = new Text(label, new TextStyle({ fill:'#fff', fontSize: label==='\u2713'?14:13, fontWeight:'700' })); txt.anchor.set(0.5); g.addChild(txt); if (enabled && onTap){ g.eventMode='static'; g.cursor='pointer'; g.on('pointertap', onTap); } else { g.alpha = 0.35; } return g; };
      const canConfirm = ticket.animals.length>0;
      const confirmBtn = makeCircle(0x2e7d32,0x4caf50,confirmCenterX,canConfirm,'\u2713',()=>confirmTicket(ticket.id));
      const deleteBtn = makeCircle(0xb71c1c,0xe53935,deleteCenterX,true,'\u2715',()=>deleteTicket(ticket.id));
      card.addChild(confirmBtn, deleteBtn);
    }
    ticketsListContainer.addChild(card);
  });
  // Scroll bounds
  if (isMobileLayout()) {
    const contentWidth = getContentWidth();
    const minX = Math.min(0, ticketsVisibleWidth - contentWidth);
    ticketsScrollX = Math.max(minX, Math.min(0, ticketsScrollX));
    ticketsListContainer.x = ticketsScrollX;
    // Keep list anchored below header in mobile (headerHeight = 28)
    ticketsListContainer.y = 28;
  } else {
    const contentHeight = getContentHeight();
    const minY = Math.min(0, ticketsVisibleHeight - contentHeight);
    ticketsScrollY = Math.max(minY, Math.min(0, ticketsScrollY));
    ticketsListContainer.y = 28 + ticketsScrollY;
  }
  updateTicketsScrollbar();
  // Clean up motion entries for removed tickets
  const currentIds = new Set(tickets.map(t=>t.id));
  Object.keys(ticketMotion).forEach(idStr => { const id = +idStr; if (!currentIds.has(id)) delete ticketMotion[id]; });
  // Ensure single ticker for motion
  const motionKey = '__ticketReorderMotion';
  // @ts-ignore
  if (!(app as any)[motionKey]){
    const tick = () => { Object.values(ticketMotion).forEach(entry => { const dy = entry.targetY - entry.card.y; entry.card.y += Math.abs(dy) < 0.35 ? dy : dy * REORDER_LERP_FACTOR; }); };
    // @ts-ignore
    (app as any)[motionKey] = tick; app.ticker.add(tick);
  }
  // Winner glow pulse
  if (app){
    const pulseKey = '__winGlowPulse';
    // @ts-ignore
    if ((app as any)[pulseKey]){ app.ticker.remove((app as any)[pulseKey]); }
    if (winGlowRefs.length){
      let t=0; const fn = ()=>{ t++; const base=0.25, amp=0.15; const val = base + amp*Math.sin(t*0.08); winGlowRefs.forEach(g=> g.alpha = val); };
      // @ts-ignore
      (app as any)[pulseKey] = fn; app.ticker.add(fn);
    }
  }
}

// Constants
const GRID_COLS = 5;
const GRID_GAP = 12;
const CARD_SIZE = 120;
const SIDE_GAP = 30; // gap between grid and side columns
const BOTTOM_UI_HEIGHT = 70; // shortened cabinet height for better vertical fit
const TOP_MARGIN = 30;
const SIDE_COLUMN_WIDTH = 210; // width for ticket panel and reveal slots columns

// Mobile layout helper (multi-source fallback)
let manualMobileOverride: boolean | null = null; // toggled via keypress 'm'
function isMobileLayout(): boolean {
  // TEMP: force mobile to resolve layout immediately
  // @ts-ignore
  window.__MOBILE_SOURCES = { forcedAlways: true };
  // @ts-ignore
  window.__MOBILE = true;
  console.log('[isMobileLayout] FORCED MOBILE (temporary)');
  return true;
}

// Helper map last two digits -> animal group
function getAnimalByTwoDigits(two: string) {
  let d = parseInt(two, 10);
  if (two === '00') d = 100;
  return animals.find(a => a.numbers.includes(d)) || null;
}

// Build animal grid
function buildGrid() {
  if (!app || !centerContainer) return;
  centerContainer.removeChildren();
  const editing = currentEditingTicket();
  const selectedIds = new Set(editing?.animals || []);
  const emojiStyle = new TextStyle({ fill:'#fff', fontSize: 42, fontFamily:'system-ui', align:'center' });
  const numsStyle = new TextStyle({ fill:'#90caf9', fontSize:14, fontFamily:'monospace', align:'center' });
  // Reset grid positions for random ticket animation (avoid const reassignment)
  for (const key in gridPositions){ delete (gridPositions as any)[key]; }
  animals.forEach((animal, idx) => {
    const col = idx % GRID_COLS;
    const row = Math.floor(idx / GRID_COLS);
    const card = new Graphics();
    card.roundRect(0,0,CARD_SIZE,CARD_SIZE,18);
  const isSelected = selectedIds.has(animal.id);
  const isPreview = randomFlightPreview.includes(animal.id); // random awaiting flight
  const isManual5th = manualFlightInProgress === animal.id; // manual 5th in-flight
  let fillCol = 0x1e242f;
  let strokeCol = 0x374252;
  let strokeW = 2;
  // Priority: manual 5th (orange) > selected (gold) > random preview (yellow) > base
  if (isPreview){ fillCol = 0x242e38; strokeCol = 0xffd54f; strokeW = 3; }
  if (isSelected){ fillCol = 0x253040; strokeCol = 0xffd54f; strokeW = 4; }
  if (isManual5th){ fillCol = 0x2e2612; strokeCol = 0xff9800; strokeW = 4; }
    card.fill({ color: fillCol });
    card.stroke({ color: strokeCol, width: strokeW });
    card.x = col * (CARD_SIZE + GRID_GAP);
    card.y = row * (CARD_SIZE + GRID_GAP);
    card.eventMode = 'static'; card.cursor = 'pointer';
    // Hover tilt + shadow
    let hoverFrame = 0; let isHover = false;
    const shadow = new Graphics(); shadow.roundRect(4,8,CARD_SIZE-8,CARD_SIZE-8,16); shadow.fill({ color:0x000000, alpha:0.35 }); shadow.alpha = 0; card.addChild(shadow); shadow.zIndex = -1;
    card.on('pointerover', ()=>{ isHover = true; });
    card.on('pointerout', ()=>{ isHover = false; });
    app.ticker.add(function hoverTick(){
      // target values
      const targetScale = isHover ? 1.05 : 1;
      const targetRot = isHover ? 0.04 : 0;
      const targetShadow = isHover ? 0.6 : 0;
      // lerp
      card.scale.x += (targetScale - card.scale.x)*0.18;
      card.scale.y = card.scale.x;
      card.rotation += (targetRot - card.rotation)*0.18;
      shadow.alpha += (targetShadow - shadow.alpha)*0.15;
    });
    card.on('pointertap', () => {
      // Pulse ring
      const ring = new Graphics();
      ring.circle(0,0,CARD_SIZE/2 - 6);
      ring.stroke({ color:0xffd54f, width:4 });
      ring.x = card.x + CARD_SIZE/2;
      ring.y = card.y + CARD_SIZE/2 - 12;
      ring.alpha = 0.9;
      centerContainer.addChild(ring);
      let rf = 0; const rTotal = 28;
      app.ticker.add(function ringTick(){
        rf++;
        const p = rf/rTotal;
        ring.scale.set(1 + p*0.55);
        ring.alpha = 0.9 * (1 - p);
        if (rf >= rTotal){ app.ticker.remove(ringTick); ring.destroy(); }
      });
      const before = currentEditingTicket();
  const wasEditing = currentEditingTicket();
  const beforeCount = wasEditing?.animals.length || 0;
  addAnimalToTicket(animal.id);
  const afterTicket = currentEditingTicket() || wasEditing;
  const becameFifth = beforeCount === 4; // we just added 5th
      const after = currentEditingTicket();
      const targetTicket = after || before;
      if (targetTicket){
        const targetIndex = targetTicket.animals.length - 1;
  const slotSize = 34; const slotGap = 6; const totalSlotsWidth = slotSize*5 + slotGap*4; const startX = (SIDE_COLUMN_WIDTH - totalSlotsWidth)/2; const slotY = SLOT_ROW_Y;
        const slotX = startX + targetIndex * (slotSize + slotGap) + slotSize/2;
        const fromX = centerContainer.x + card.x + CARD_SIZE/2;
        const fromY = centerContainer.y + card.y + CARD_SIZE/2 - 12;
        const toX = leftContainer.x + slotX;
        const toY = leftContainer.y + 28 + slotY + slotSize/2;
        const fly = new Text(animal.emoji, new TextStyle({ fill:'#ffd54f', fontSize:42 }));
        fly.anchor.set(0.5); fly.x = fromX; fly.y = fromY; fly.alpha = 1; fly.scale.set(0.9);
        app.stage.addChild(fly);
        let f = 0; const dur = 36;
        app.ticker.add(function travel(){
          f++;
          const p = f/dur;
          const e = p < 0.5 ? 4*p*p*p : 1 - Math.pow(-2*p+2,3)/2;
          fly.x = fromX + (toX - fromX)*e;
          fly.y = fromY + (toY - fromY)*e - Math.sin(p*Math.PI)*28;
          fly.scale.set(0.9 + 0.2*e);
          fly.alpha = 1 - Math.max(0,(p-0.7)/0.3);
          if (f >= dur){ app.ticker.remove(travel); fly.destroy(); }
            if (manualFlightInProgress === animal.id){
              // finalize ticket completion now
              const t = tickets.find(tt=>tt.id===targetTicket.id);
              if (t){ t.complete = true; editingTicketId = null; }
              manualFlightInProgress = null; buildGrid(); updatePlayButtonState(); updateClearButtonState();
            }
        });
      }
    });
    const emojiText = new Text(animal.emoji, emojiStyle);
    emojiText.anchor.set(0.5);
    emojiText.x = CARD_SIZE/2;
    emojiText.y = CARD_SIZE/2 - 12;
    const numString = animal.numbers.map(n => n === 100 ? '00' : n.toString().padStart(2,'0')).join(' ');
    const numsText = new Text(numString, numsStyle);
    numsText.anchor.set(0.5);
    numsText.x = CARD_SIZE/2;
    numsText.y = CARD_SIZE - 26;
    card.addChild(emojiText, numsText);
    centerContainer.addChild(card);
    // Store center position (will transform later when used)
    (gridPositions as any)[animal.id] = { cardX: card.x, cardY: card.y };
  });
}

// Replace old left spacer build function with ticket panel sizing
function buildLeftSpacer() { // renamed function preserved for layout calls
  leftContainer.removeChildren();
  
  if (isMobileLayout()) {
    // Mobile: horizontal tickets panel above grid
    const headerHeight = 28;
    const listHeight = mobileTicketsFillHeight ?? TICKET_HEIGHT;
    const panelHeight = headerHeight + listHeight;
    // Fit to device width with margins
    const marginX = 20;
    const deviceW = window.innerWidth;
    const gridWidth = Math.max(
      Math.min(deviceW - marginX*2, centerContainer.width || (CARD_SIZE * GRID_COLS + GRID_GAP * (GRID_COLS - 1))),
      320
    );
    
    console.log('[buildLeftSpacer mobile]', { gridWidth, panelHeight });
    
    // Background for tickets panel
    const bg = new Graphics();
    bg.roundRect(0, headerHeight, gridWidth, listHeight, 18);
    bg.fill({ color: 0x1a2027 });
    bg.stroke({ color:0x2e3a47, width:2 });
    leftContainer.addChild(bg);
    
  // Header sits above bg; header container stays at x=0
  leftContainer.addChild(ticketsHeaderContainer, ticketsListContainer);
  ticketsHeaderContainer.x = 0;
  ticketsHeaderContainer.y = 0;
    
    // Mask covers list area beneath header
  // Restore a mask sized to the panel to prevent overflow during play animations
  const safeMask = new Graphics();
    safeMask.rect(0, headerHeight, gridWidth, listHeight);
  safeMask.fill(0xffffff);
  leftContainer.addChild(safeMask);
  ticketsListContainer.mask = safeMask;
    
  // Add scrollbar
    leftContainer.addChild(ticketsScrollbar);
    
  ticketsVisibleWidth = gridWidth;
     ticketsVisibleHeight = listHeight;
  // y already set; ensure header remains at 0
  ticketsHeaderContainer.y = 0;
    ticketsListContainer.y = headerHeight;
    
    const contentWidth = getContentWidth();
    const minX = Math.min(0, ticketsVisibleWidth - contentWidth);
    ticketsScrollX = Math.max(minX, Math.min(0, ticketsScrollX));
    ticketsListContainer.x = ticketsScrollX;
    
  leftContainer.hitArea = new Rectangle(0, 0, gridWidth, panelHeight);
    updateTicketsScrollbar();
    
  } else {
    // Desktop: vertical tickets panel on left side
    const gridHeight = centerContainer.height || (CARD_SIZE * GRID_COLS + GRID_GAP * (GRID_COLS - 1));
    const headerHeight = 28;
    // Draw background starting BELOW header so header appears "freed"
    const bg = new Graphics();
    bg.roundRect(0,headerHeight,SIDE_COLUMN_WIDTH,Math.max(0,gridHeight - headerHeight),18);
    bg.fill({ color: 0x1a2027 });
    bg.stroke({ color:0x2e3a47, width:2 });
    leftContainer.addChild(bg);
    // Header sits above bg now
    leftContainer.addChild(ticketsHeaderContainer, ticketsListContainer);
    // Mask covers only list area beneath header
    const mask = new Graphics();
    mask.rect(0,headerHeight,SIDE_COLUMN_WIDTH,Math.max(0,gridHeight - headerHeight));
    mask.fill(0xffffff);
    leftContainer.addChild(mask);
  // Desktop retains mask for vertical scrolling
  ticketsListContainer.mask = mask;
    // Scrollbar above mask
    leftContainer.addChild(ticketsScrollbar);
    ticketsVisibleHeight = Math.max(0, gridHeight - headerHeight);
    ticketsVisibleWidth = SIDE_COLUMN_WIDTH;
    // Slight header lift for breathing space
    ticketsHeaderContainer.y = 0; // flush top
    const contentHeight = getContentHeight();
    const minY = Math.min(0, ticketsVisibleHeight - contentHeight);
    ticketsScrollY = Math.max(minY, Math.min(0, ticketsScrollY));
    ticketsListContainer.y = headerHeight + ticketsScrollY;
    updateTicketsScrollbar();
    leftContainer.hitArea = new Rectangle(0,0,SIDE_COLUMN_WIDTH,Math.max(0,gridHeight));
    console.log('[buildLeftSpacer] freedHeader visibleHeight', ticketsVisibleHeight, 'contentHeight', contentHeight);
  }
}

// Layout and sizing functions
function layout() {
  if (!app || !leftContainer || !centerContainer || !rightContainer) return;
  let w = app.renderer.width;
  let h = app.renderer.height;
  const mobile = isMobileLayout();
  console.log('[layout] branch', mobile ? 'MOBILE' : 'DESKTOP', { w, h });
  
  if (mobile) {
    // Add body class for mobile styling hooks (once)
    document.body.classList.add('mobile-mode');
    // Mobile layout: results above grid, tickets below grid, all centered horizontally
    // First ensure grid is at scale 1
    centerContainer.scale.set(1);

    // Build panels FIRST with correct dimensions before positioning
    buildLeftSpacer();
    buildRightSlots();

    // Constrain grid width to device viewport and derive aligned width for sections
    const marginX = 20;
    const deviceW = window.innerWidth;
    let baseGridWidth = centerContainer.width;
    let gridWidth = Math.max(Math.min(deviceW - marginX * 2, baseGridWidth), 320);
    let gridHeight = centerContainer.height;

    // Ensure grid fits horizontally: apply width-based scaling if needed
    const maxGridWidth = deviceW - marginX * 2;
    if (baseGridWidth > maxGridWidth) {
      const scaleW = Math.max(0.45, Math.min(1, maxGridWidth / baseGridWidth));
      centerContainer.scale.set(scaleW);
      // Recompute grid dimensions after width scaling
      baseGridWidth = centerContainer.width;
      gridWidth = Math.max(Math.min(deviceW - marginX * 2, baseGridWidth), 320);
      gridHeight = centerContainer.height;
      // Rebuild results panel to align to new gridWidth
      buildRightSlots();
    }
    
  const ticketPanelHeight = 28 + TICKET_HEIGHT; // header + ticket height
  const resultPanelHeight = 30 + 100; // header + slot height (approx; slots sized in buildRightSlots)
  const gap = 15; // gap between sections
  let totalHeight = ticketPanelHeight + gap + gridHeight + gap + resultPanelHeight;

  // If total content exceeds viewport height, scale down the grid (not tickets/results) to fit
  const availableViewportH = window.innerHeight - BOTTOM_UI_HEIGHT - TOP_MARGIN - 40;
    if (totalHeight > availableViewportH) {
      const maxGridHeight = Math.max(120, availableViewportH - (ticketPanelHeight + resultPanelHeight + gap * 2));
      const scaleY = Math.min(1, Math.max(0.45, maxGridHeight / gridHeight));
      // Preserve any width scaling already applied by using uniform scaling to the smaller
      const currentScale = centerContainer.scale.x;
      const finalScale = Math.min(currentScale, scaleY);
      centerContainer.scale.set(finalScale);
      // Recompute grid dimensions after scaling
      baseGridWidth = centerContainer.width;
      gridWidth = Math.max(Math.min(deviceW - marginX * 2, baseGridWidth), 320);
      gridHeight = centerContainer.height;
      totalHeight = ticketPanelHeight + gap + gridHeight + gap + resultPanelHeight;
      // Rebuild results panel to align to new gridWidth
      buildRightSlots();
    }
    
  // Anchor at top-center: compute tickets fill height to occupy space down to UI
  const remainingBelowGrid = Math.max(0, availableViewportH - (resultPanelHeight + gap + gridHeight));
    // Fill space for tickets list (beneath header) and leave 50px buffer for UI at the end
    const UI_BUFFER = 50;
  mobileTicketsFillHeight = Math.max(TICKET_HEIGHT, (remainingBelowGrid - gap) - UI_BUFFER - 50);

    // Resize renderer to fully contain mobile content to avoid clipping
    const desiredW = gridWidth + 40;
  const desiredH = (resultPanelHeight + gap + gridHeight + gap + (28 + (mobileTicketsFillHeight ?? TICKET_HEIGHT))) + TOP_MARGIN + BOTTOM_UI_HEIGHT + 40;
    if (desiredW !== w || desiredH !== h) {
      app.renderer.resize(desiredW, desiredH);
      w = desiredW; h = desiredH;
    }
  // Anchor start at top margin, with an extra drop for visual spacing (now 35px)
  const startY = TOP_MARGIN + 35;
    
    // All elements centered horizontally at the same X
  const centerX = (w - gridWidth) / 2;
    
    // Position results above grid (using rightContainer)
    // Results centered to gridWidth (buildRightSlots already sizes to gridWidth)
    rightContainer.x = centerX;
    rightContainer.y = startY;

    // Position grid below results
    centerContainer.x = centerX;
    centerContainer.y = startY + resultPanelHeight + gap;

    // Position tickets below grid (using leftContainer)
    // Tickets may be wider than grid if not constrained; center within gridWidth
    leftContainer.x = centerX;
  leftContainer.y = centerContainer.y + gridHeight + gap;
  // Rebuild tickets with the new fill height
  buildLeftSpacer();
    
    console.log('[mobile layout]', {
      centerX,
      resultsY: rightContainer.y,
      gridY: centerContainer.y,
      ticketsY: leftContainer.y,
      gridWidth,
      totalHeight
    });
    
  } else {
    document.body.classList.remove('mobile-mode');
    // Desktop layout: side columns + center grid
    // Potential total width
    const gridWidth = centerContainer.width;
    let totalWidth = gridWidth + SIDE_COLUMN_WIDTH * 2 + SIDE_GAP * 2; // left + right + gaps
    let scale = 1;
    if (totalWidth > w - 40) {
      scale = Math.min(1, Math.max(0.4, (w - 40) / totalWidth));
      centerContainer.scale.set(scale);
      // recompute gridWidth and totalWidth after scaling
      totalWidth = centerContainer.width + SIDE_COLUMN_WIDTH * 2 + SIDE_GAP * 2;
    } else {
      centerContainer.scale.set(1);
    }
    const startX = (w - totalWidth) / 2;
    const verticalSpace = h - BOTTOM_UI_HEIGHT - TOP_MARGIN - 20;
    const gridHeight = centerContainer.height;
    const startY = TOP_MARGIN + (verticalSpace - gridHeight) / 2;
    // Position containers
    leftContainer.x = startX;
    leftContainer.y = startY;
    centerContainer.x = leftContainer.x + SIDE_COLUMN_WIDTH + SIDE_GAP;
    centerContainer.y = startY;
    rightContainer.x = centerContainer.x + centerContainer.width + SIDE_GAP;
    rightContainer.y = startY;
    // Resize left spacer if height changed
    buildLeftSpacer();
    buildRightSlots();
  }
  // Parallax removed in clean build; placeholder comment retained

  // Mobile scaling: when mobile layout is active, fit within device screen, never exceed width/height
  if (isMobileLayout()) {
    const canvas = app.canvas as HTMLCanvasElement;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
    let cssScale = 1;
    // Calculate logical content width/height for mobile stack
    const logicalContentWidth = w;
    const logicalContentHeight = h;
    const wScale = vw / logicalContentWidth;
    const hScale = vh / logicalContentHeight;
  cssScale = Math.min(1, Math.max(0.5, Math.min(wScale, hScale)));
  canvas.style.transformOrigin = 'top center';
    canvas.style.transform = `scale(${cssScale})`;
    canvas.style.width = `${app.renderer.width}px`; // keep original logical size
    canvas.style.height = `${app.renderer.height}px`;
    // Provide a debug attribute for verification
    canvas.setAttribute('data-mobile-scale', cssScale.toFixed(3));
  } else {
    const canvas = app?.canvas as HTMLCanvasElement | undefined;
    if (canvas) {
      canvas.style.transform = 'none';
      canvas.removeAttribute('data-mobile-scale');
    }
  }
}

// Dev convenience: press 'm' to toggle manual mobile override on/off
window.addEventListener('keydown', (e) => {
  if (e.key.toLowerCase() === 'm') {
    manualMobileOverride = manualMobileOverride === true ? false : true;
    console.log('[manual-toggle] mobile override now', manualMobileOverride);
    layout();
  }
});

let resultSlots: Graphics[] = [];
// Mobile-only dynamic tickets fill height (height of list area beneath header)
let mobileTicketsFillHeight: number | null = null;
function buildRightSlots() {
  rightContainer.removeChildren();
  resultSlots = [];
  
  if (isMobileLayout()) {
    // Mobile: horizontal results below grid
    const marginX = 20;
    const deviceW = window.innerWidth;
    const baseGridWidth = centerContainer.width || (CARD_SIZE * GRID_COLS + GRID_GAP * (GRID_COLS - 1));
    const gridWidth = Math.max(Math.min(deviceW - marginX*2, baseGridWidth), 320);
    
    console.log('[buildRightSlots mobile]', { gridWidth });
    
    const header = new Text('Game Result', new TextStyle({ fill:'#ffcc66', fontSize:16, fontFamily:'system-ui', fontWeight:'600' }));
    header.anchor.set(0.5,0);
    header.x = gridWidth/2; 
    header.y = 0;
    rightContainer.addChild(header);
    
  const slotCount = 5;
  const gap = Math.max(10, Math.min(18, Math.floor((gridWidth) / 30)));
  const headerOffset = 30;
  // Responsive slot width to fit exactly within gridWidth
  const resultsCount = 5;
  const totalGap = gap * (resultsCount - 1);
  const slotWidth = Math.floor((gridWidth - totalGap) / resultsCount);
  const slotHeight = Math.max(72, Math.min(110, Math.floor(slotWidth * 0.44)));
    
  const totalSlotsWidth = slotWidth * resultsCount + gap * (resultsCount - 1);
    const startX = (gridWidth - totalSlotsWidth) / 2;
    
    console.log('[buildRightSlots mobile slots]', { totalSlotsWidth, startX, slotCount });
    
    for (let i=0;i<slotCount;i++) {
      const slot = new Graphics();
      slot.roundRect(0,0,slotWidth,slotHeight,14);
      slot.fill({ color: 0x232a34 });
      slot.stroke({ color: 0x445364, width:2 });
      slot.x = startX + i * (slotWidth + gap);
      slot.y = headerOffset;
  const numeralStyle = new TextStyle({ fill:'#ffffff', fontSize: Math.min(72, slotHeight * 0.85), fontFamily:'system-ui', fontWeight:'700', align:'center' });
  const numeral = new Text(String(i+1), numeralStyle);
  numeral.anchor.set(0.5);
  numeral.x = slotWidth/2; numeral.y = slotHeight/2; numeral.alpha = 0.06;
      slot.addChild(numeral);
      rightContainer.addChild(slot);
      resultSlots.push(slot);
    }
    
  } else {
    // Desktop: vertical results on right side
    const gridHeight = centerContainer.height || (CARD_SIZE * GRID_COLS + GRID_GAP * (GRID_COLS - 1));
    const header = new Text('Game Result', new TextStyle({ fill:'#ffcc66', fontSize:16, fontFamily:'system-ui', fontWeight:'600' }));
    header.anchor.set(0.5,0);
    header.x = SIDE_COLUMN_WIDTH/2; header.y = 0;
    rightContainer.addChild(header);
    const slotCount = 5;
    const gap = 16;
    const headerOffset = 30; // space for header
    const availableHeight = gridHeight - headerOffset;
    const totalGapHeight = gap * (slotCount - 1);
    const slotHeight = (availableHeight - totalGapHeight) / slotCount;
    for (let i=0;i<slotCount;i++) {
      const slot = new Graphics();
      slot.roundRect(0,0,SIDE_COLUMN_WIDTH,slotHeight,14);
      slot.fill({ color: 0x232a34 });
      slot.stroke({ color: 0x445364, width:2 });
      slot.y = headerOffset + i * (slotHeight + gap);
      const numeralStyle = new TextStyle({ fill:'#ffffff', fontSize: Math.min(140, slotHeight * 0.8), fontFamily:'system-ui', fontWeight:'700', align:'center' });
      const numeral = new Text(String(i+1), numeralStyle);
      numeral.anchor.set(0.5);
      numeral.x = SIDE_COLUMN_WIDTH/2; numeral.y = slotHeight/2; numeral.alpha = 0.06;
      slot.addChild(numeral);
      rightContainer.addChild(slot);
      resultSlots.push(slot);
    }
  }
}

// New Clear button beside Play
const clearBtn = document.getElementById('clear-btn') as HTMLButtonElement | null;
function updateClearButtonState(){
  if (!clearBtn) return;
  const hasConfirmed = tickets.some(t=>t.complete);
  if (!hasConfirmed || isPlaying){
    clearBtn.setAttribute('disabled','true');
    clearBtn.style.opacity = '0.35';
    clearBtn.style.cursor = 'not-allowed';
  } else {
    clearBtn.removeAttribute('disabled');
    clearBtn.style.opacity = '1';
    clearBtn.style.cursor = 'pointer';
  }
}
clearBtn?.addEventListener('click', ()=>{ if (!clearBtn || clearBtn.disabled) return; clearTickets(); updateClearButtonState(); });

// Random ticket creation button (moved earlier to avoid TDZ before initial state refresh)
const randomBtn = document.getElementById('random-btn') as HTMLButtonElement | null;
const playHtmlBtn = document.getElementById('play-btn') as HTMLButtonElement | null;
function attachButtonBounce(btn:HTMLButtonElement|null){
  if (!btn) return;
  btn.addEventListener('click', ()=>{
    btn.classList.remove('btn-bounce');
    void btn.offsetWidth;
    btn.classList.add('btn-bounce');
  });
}
attachButtonBounce(randomBtn);
attachButtonBounce(playHtmlBtn);
attachButtonBounce(clearBtn);
function updateRandomButtonState(){
  // Safe access: randomBtn is declared above initial updatePlayButtonState invocation
  if (!randomBtn) return;
  const projected = totalConfirmedStake() + totalPendingStake();
  const limitHit = projected >= MAX_TOTAL_STAKE;
  if (isPlaying || limitHit){
    randomBtn.setAttribute('disabled','true');
    randomBtn.style.opacity = '0.35';
    randomBtn.style.cursor = 'not-allowed';
  } else {
    randomBtn.removeAttribute('disabled');
    randomBtn.style.opacity = '1';
    randomBtn.style.cursor = 'pointer';
  }
}
// Particle burst on arrival
function spawnArrivalParticles(x:number,y:number){
  for (let i=0;i<10;i++){
    const p = new Graphics();
    p.circle(0,0,3);
    p.fill({ color:0xffd54f });
    p.x = x; p.y = y; p.alpha = 1;
    const ang = Math.random()*Math.PI*2;
    const speed = 2 + Math.random()*2.5;
    const life = 28 + Math.random()*14;
    let f=0;
    app.stage.addChild(p);
    app.ticker.add(function particle(){
      f++;
      p.x += Math.cos(ang)*speed;
      p.y += Math.sin(ang)*speed*0.7;
      p.alpha = 1 - f/life;
      p.scale.set(1 + f/life*0.8);
      if (f>=life){ app.ticker.remove(particle); p.destroy(); }
    });
  }
}
const gridPositions: Record<number,{cardX:number;cardY:number}> = {} as any;
let randomFlightPreview: number[] = []; // ids highlighted for random selection animation
// Store last known Y positions for ticket animation
const ticketPreviousY: Record<number, number> = {};
// Compute slot center (x,y) in stage coordinates for given slot index (0..4) within ticket being edited (top-most during creation)
function computeSlotCenter(slotIndex:number): {x:number;y:number} {
  const slotSize = 34; const slotGap = 6; const totalSlotsWidth = slotSize * 5 + slotGap * 4; const startX = (SIDE_COLUMN_WIDTH - totalSlotsWidth)/2; const startY = SLOT_ROW_Y;
  const cx = leftContainer.x + startX + slotIndex * (slotSize + slotGap) + slotSize/2;
  const cy = leftContainer.y + 28 + startY + slotSize/2; // +28 header offset
  return { x: cx, y: cy };
}
function createRandomTicket(){
  if (isPlaying) return;
  const stake = getCurrentStake();
  const projected = totalConfirmedStake() + totalPendingStake() + stake;
  if (projected > MAX_TOTAL_STAKE){ console.log('Stake limit exceeded, random ticket blocked'); return; }
  const count = Math.floor(Math.random()*5)+1; // 1..5 animals
  const ids: number[] = []; const available = [...animals];
  while(ids.length < count && available.length){
    const idx = Math.floor(Math.random()*available.length);
    ids.push(available[idx].id); available.splice(idx,1);
  }
  randomFlightPreview = [...ids]; // highlight grid cards
  const t: Ticket = { id: nextTicketId++, animals: [], complete:false, stake, randomBuilding:true };
  tickets.unshift(t); editingTicketId = t.id;
  renderTickets(); buildGrid(); layout();
  ids.forEach((aId, index) => {
    const pos = (gridPositions as any)[aId]; if (!pos) return;
    const fromX = centerContainer.x + pos.cardX + CARD_SIZE/2;
    const fromY = centerContainer.y + pos.cardY + CARD_SIZE/2 - 12;
    // Always map sequential left-to-right into the first N ticket slots
    const { x: toX, y: toY } = computeSlotCenter(index);
    const fly = new Text((animals.find(a=>a.id===aId)?.emoji)||'❓', new TextStyle({ fill:'#ffd54f', fontSize:42 }));
    fly.anchor.set(0.5); fly.x = fromX; fly.y = fromY; fly.alpha = 0; fly.scale.set(0.85); app.stage.addChild(fly);
    const delayFrames = index * 6; let f = -delayFrames; const dur = 38;
    app.ticker.add(function travel(){
      f++; if (f < 0) return;
      const p = f/dur; const e = p < 0.5 ? 4*p*p*p : 1 - Math.pow(-2*p+2,3)/2;
      fly.alpha = Math.min(1, p*2);
      fly.x = fromX + (toX - fromX)*e;
      fly.y = fromY + (toY - fromY)*e - Math.sin(p*Math.PI)*30;
      fly.scale.set(0.85 + 0.25*e);
      if (f >= dur){
        app.ticker.remove(travel); fly.destroy();
        const ticket = tickets.find(tt=>tt.id===t.id);
        if (ticket && !ticket.complete){
          ticket.animals.push(aId);
          updateTicketOdds(ticket);
          randomFlightPreview = randomFlightPreview.filter(x=>x!==aId);
          if (ticket.animals.length === count){ ticket.complete = true; ticket.randomBuilding = false; editingTicketId = null; randomFlightPreview = []; }
          renderTickets(); buildGrid(); spawnArrivalParticles(toX,toY);
          // Elastic overshoot on newly placed slot emoji
          const cardIdx = tickets.indexOf(ticket);
          if (cardIdx !== -1){
            const ticketCard = ticketsListContainer.children[cardIdx] as Container | undefined;
            if (ticketCard){
              // Slot position corresponds to index (left-to-right)
              const slotSize = 34; const slotGap = 6; const totalSlotsWidth = slotSize * 5 + slotGap * 4; const startX = (SIDE_COLUMN_WIDTH - totalSlotsWidth)/2; const startY = SLOT_ROW_Y;
              const slotX = startX + (ticket.animals.length - 1) * (slotSize + slotGap);
              // Find emoji text inside that slot
              const slotGraphic = ticketCard.children.find(c => c instanceof Graphics && (c as Graphics).y === startY && (c as Graphics).x === slotX) as Graphics | undefined;
              if (slotGraphic){
                const emoji = slotGraphic.children.find(ch=> ch instanceof Text) as Text | undefined;
                if (emoji){
                  let f2=0; const dur2=22; const baseScale = emoji.scale.x; const peak=baseScale*1.35;
                  app.ticker.add(function elastic(){
                    f2++; const p=f2/dur2;
                    // ease out back-like curve
                    const s=1.4; const eased = 1 + (Math.pow(p-1,3)*(s+1) + (p-1)*(-s));
                    const current = baseScale + (peak-baseScale)*Math.min(1,eased);
                    emoji.scale.set(current);
                    if (f2>=dur2){ emoji.scale.set(baseScale); app.ticker.remove(elastic); }
                  });
                }
              }
            }
          }
          updatePlayButtonState(); updateClearButtonState();
        }
        if (index === ids.length -1){ buildGrid(); layout(); refreshStakeLimitStatus(); updateRandomButtonState(); }
      }
    });
  });
}
randomBtn?.addEventListener('click', createRandomTicket);
// Removed premature initial render sequence; postInit() handles first draw after Pixi ready.
window.addEventListener('resize', () => { buildGrid(); layout(); });

// Play button logic retains background numerals
const playBtn = document.getElementById('play-btn');
let balance = 1000; // starting balance
function refreshBalance(){ const el = document.getElementById('balance-value'); if (!el) return; el.textContent = `£${balance.toFixed(2)}`.replace('.00',''); }
refreshBalance();
function animateBalanceTo(target:number){
  const start = balance; const delta = target - start; if (delta===0){ refreshBalance(); return; }
  const dur=600; const t0=performance.now();
  function easeOutQuad(t:number){ return 1 - (1-t)*(1-t); }
  function step(now:number){ const p=Math.min(1,(now-t0)/dur); balance = start + delta*easeOutQuad(p); refreshBalance(); if(p<1) requestAnimationFrame(step); else { balance=target; refreshBalance(); } }
  requestAnimationFrame(step);
}
// New unified payout computation per clarified rules
// Revised multiplier model approximating traditional Jogo do Bicho style escalation.
// Mapping rationale (approximate public payout ranges vary by operator):
//  Grupo (single group) often ~18x                     -> size 1 all-present 18x
//  Duque de Grupo (2 groups) can span ~200x-600x       -> size 2 both-present 300x (midpoint)
//  Terno de Grupo (3 groups) often ~2000x-4000x        -> size 3 all-present 3000x
//  Quadra (4 groups) scaled up (rarer)                 -> size 4 all-present 15000x (extrapolated)
//  Quina (5 groups) very rare high jackpot            -> size 5 all-present 60000x (extrapolated)
// Partial matches are non-traditional but added for UX feedback; values chosen to keep EV moderate.
// Positional bonuses removed; only presence count drives payout.
function computeTicketWin(ticket: Ticket, drawnAnimalIds: (number|null)[]): { multiplier:number; posMatches:boolean[]; anyMatches:boolean[] } {
  const size = ticket.animals.length;
  const posMatches = new Array(size).fill(false); // retained for UI tick marks (positional logic now same as any match)
  const anyMatches = new Array(size).fill(false);
  const drawnSet = new Set(drawnAnimalIds.filter(id => id !== null) as number[]);
  ticket.animals.forEach((aId, idx) => {
    if (drawnAnimalIds[idx] !== null && drawnAnimalIds[idx] === aId) posMatches[idx] = true; // still mark positional for visual
    if (drawnSet.has(aId)) anyMatches[idx] = true;
  });
  const presentCount = anyMatches.filter(Boolean).length;
  let mult = 0;
  switch(size){
    case 1: // Grupo style (choose one group)
      if (presentCount === 1) mult = 18;
      break;
    case 2: // Duque style
      if (presentCount === 2) mult = 300; else if (presentCount === 1) mult = 2.5;
      break;
    case 3: // Terno style
      if (presentCount === 3) mult = 3000; else if (presentCount === 2) mult = 22; else if (presentCount === 1) mult = 2;
      break;
    case 4: // Quadra style
      if (presentCount === 4) mult = 15000; else if (presentCount === 3) mult = 140; else if (presentCount === 2) mult = 8; else if (presentCount === 1) mult = 1.2;
      break;
    case 5: // Quina style
      if (presentCount === 5) mult = 60000; else if (presentCount === 4) mult = 1000; else if (presentCount === 3) mult = 55; else if (presentCount === 2) mult = 5; else if (presentCount === 1) mult = 0.8;
      break;
  }
  return { multiplier: mult, posMatches, anyMatches };
}
if (playBtn) {
  playBtn.addEventListener('click', async () => {
    if (isPlaying) return;
    // Remove any unconfirmed (in-progress) tickets before starting play
    if (tickets.some(t=>!t.complete)){
      tickets = tickets.filter(t=>t.complete);
      editingTicketId = null; // ensure no dangling editing reference
      renderTickets(); buildGrid(); layout();
    }
    isPlaying = true; updatePlayButtonState(); updateClearButtonState();
    // Deduct stakes for all confirmed tickets at the moment play begins
    const stakeCost = totalConfirmedStake();
    if (stakeCost > 0) {
      balance -= stakeCost;
      if (balance < 0) balance = 0; // prevent negative display (assumption)
      refreshBalance();
    }
    // Reset previous win state so tickets start clean (no stars/ticks/green or win amounts)
    tickets.forEach(t => { delete t.lastWin; t.posMatches = undefined; t.anyMatches = undefined; });
    renderTickets();
    // Clear previous slot content except numerals
    resultSlots.forEach(slot => { while (slot.children.length > 1) slot.removeChild(slot.children[slot.children.length - 1]); });
    // Precompute results (add bonus flag with probability)
    const results: { number: string; animal: typeof animals[number] | null; bonus?:boolean }[] = [];
    for (let i=0;i<5;i++) {
      const n = Math.floor(Math.random()*10000).toString().padStart(4,'0');
      const lastTwo = n.slice(2);
      const animal = getAnimalByTwoDigits(lastTwo);
      const bonus = Math.random() < BONUS_FLAG_PROB;
      results.push({ number: n, animal, bonus });
    }
    // Progressive reveal & live match updates with pre-reveal shimmer
    const progressiveDrawn: (number|null)[] = [null,null,null,null,null];
  const revealDelays = [650, 720, 780, 900]; // progressive build-up for first 4 slots
    for (let revealIndex=0; revealIndex<results.length; revealIndex++) {
      const res = results[revealIndex];
      const slot = resultSlots[revealIndex]; if (!slot) continue;
      const isFinal = revealIndex === results.length - 1;
  const emojiStyle = new TextStyle({ fill:'#fff', fontSize: Math.min(64, slot.height*0.45), fontFamily:'system-ui' });
  const numStyle = new TextStyle({ fill:'#ffc107', fontSize: Math.min(28, slot.height*0.25), fontFamily:'monospace' });
  let emoji: Text; let numberText: Text; let bonusIcon: Graphics | null = null;
      if (!isFinal){
        // Shimmer & animated reveal for first 4 slots
        const shimmer = new Graphics();
  const slotW = slot.width; const slotH = slot.height;
        shimmer.rect(0,0,60,slotH);
        shimmer.fill({ color:0xffffff, alpha:0.12 });
        shimmer.x = -70; shimmer.y = 0; slot.addChild(shimmer);
        let sf=0; const sDur=40; app.ticker.add(function shimmerTick(){
          sf++; const p = sf/sDur; shimmer.x = -70 + (slotW + 140)*p; shimmer.alpha = 0.18*(1 - Math.abs(p-0.5)*1.9); if (sf>=sDur){ app.ticker.remove(shimmerTick); shimmer.destroy(); }
        });
  emoji = new Text(res.animal ? res.animal.emoji : '❓', emojiStyle); emoji.anchor.set(0.5); emoji.x = slotW/2; emoji.y = slotH/2 - 10; emoji.alpha = 0; emoji.scale.set(0.2);
  numberText = new Text(res.number, numStyle); numberText.anchor.set(0.5); numberText.x = slotW/2; numberText.y = slotH - 5 - (numStyle.fontSize as number)/2; numberText.alpha = 0; numberText.scale.set(0.2);
        // Bonus icon (small star in corner) if bonus
        if (res.bonus) {
          bonusIcon = new Graphics();
          bonusIcon.star(0,0,5,14,6); // Pixi Graphics star
          bonusIcon.fill({ color:0x000000, alpha:0.85 });
          bonusIcon.stroke({ color:0xffd54f, width:2 });
          bonusIcon.x = slotW - 26; bonusIcon.y = 14; bonusIcon.scale.set(0.55); bonusIcon.alpha = 0; // fade in with emoji
          slot.addChild(bonusIcon);
        }
        slot.addChild(emoji, numberText);
        const startTime = performance.now(); const duration = 350;
        function animate(now:number){
          const t = Math.min(1, (now - startTime)/duration); const ease = 1 - Math.pow(1 - t, 3);
          const scale = 0.2 + (1 - 0.2) * ease; emoji.alpha = ease; numberText.alpha = ease; emoji.scale.set(scale); numberText.scale.set(scale);
          if (bonusIcon){ bonusIcon.alpha = ease*0.95; }
          if (t < 1) requestAnimationFrame(animate);
        }
        requestAnimationFrame(animate);
      } else {
        // Instant final reveal (no shimmer, no easing) immediately after shake completes
  emoji = new Text(res.animal ? res.animal.emoji : '❓', emojiStyle); emoji.anchor.set(0.5); emoji.x = slot.width/2; emoji.y = slot.height/2 - 10; emoji.alpha = 1; emoji.scale.set(1);
  numberText = new Text(res.number, numStyle); numberText.anchor.set(0.5); numberText.x = slot.width/2; numberText.y = slot.height - 5 - (numStyle.fontSize as number)/2; numberText.alpha = 1; numberText.scale.set(1);
        if (res.bonus){
          bonusIcon = new Graphics();
          bonusIcon.star(0,0,5,16,7); bonusIcon.fill({ color:0x000000, alpha:0.85 }); bonusIcon.stroke({ color:0xffd54f, width:2 });
          bonusIcon.x = slot.width - 26; bonusIcon.y = 14; bonusIcon.scale.set(0.6); bonusIcon.alpha = 1;
          slot.addChild(bonusIcon);
        }
        slot.addChild(emoji, numberText);
      }
      // Record drawn result and update ticket match markers (immediate for final, after animation start for others)
      progressiveDrawn[revealIndex] = res.animal ? res.animal.id : null;
      tickets.filter(t=>t.complete).forEach(ticket => {
        const { posMatches, anyMatches } = computeTicketWin(ticket, progressiveDrawn);
        ticket.posMatches = posMatches; ticket.anyMatches = anyMatches;
        // Do NOT assign lastWin yet (only after full draw)
        // Compute a provisional potential win for ordering (stake * multiplier using current reveals)
        const { multiplier } = computeTicketWin(ticket, progressiveDrawn);
        ticket.tempPotentialWin = ticket.stake * multiplier;
      });
      // Reorder tickets based on current potential win (descending). Incomplete tickets sink with potential 0.
      tickets.sort((a,b)=>{
        const aw = a.tempPotentialWin || 0;
        const bw = b.tempPotentialWin || 0;
        if (aw === bw){ return a.id - b.id; }
        return bw - aw;
      });
      renderTickets();
      if (revealIndex < results.length - 1){
        // Uniform delays: slots 1-4 each wait the same baseDelay before proceeding.
        if (revealIndex < results.length - 2){
          const d = revealDelays[revealIndex] || 750;
          await new Promise(r=> setTimeout(r, d));
        } else if (revealIndex === results.length - 2){
          // After revealing slot 4: immediately start shake (no extra delay); ramp amplitude up from 0 then down.
          const finalSlot = resultSlots[results.length -1];
          if (finalSlot){
            await new Promise<void>(resolve => {
              let frames=0; const totalFrames = 180; // target ~3s at 60fps
              const origX = finalSlot.x; const origY = finalSlot.y;
              function drumRoll(){
                frames++;
                const p = frames/totalFrames;
                const phase = Math.pow(p, 1.8) * 90; // accelerating frequency
                // Ramp amplitude: grow first third, stay near peak middle, decay final third. Overall intensity halved.
                let ampEnvelope: number;
                if (p < 0.33){
                  ampEnvelope = p / 0.33; // 0 -> 1
                } else if (p < 0.66){
                  ampEnvelope = 1 - (p-0.33)/0.66 * 0.15; // slight softening mid
                } else {
                  const tail = (p-0.66)/0.34; ampEnvelope = 1 - tail; // decay 1 -> 0
                }
                const baseAmp = 6; // half of previous ~12
                const amplitude = baseAmp * ampEnvelope + 1.2; // small floor to avoid total stillness
                // Parallax jitter removed in clean build
                finalSlot.x = origX + Math.sin(phase) * amplitude * (Math.random()>0.55?1:-1);
                finalSlot.y = origY + Math.cos(phase*1.25) * amplitude * 0.35;
                if (frames>=totalFrames){
                  app.ticker.remove(drumRoll);
                  finalSlot.x = origX; finalSlot.y = origY;
                  // Parallax final shake reset removed
                  resolve(); // end shake -> immediately continue to final reveal
                }
              }
              app.ticker.add(drumRoll);
            });
          } else {
            // Fallback if slot missing: approximate shake duration then proceed
            await new Promise(r=> setTimeout(r, 3000));
          }
        }
      }
    }
    // Final payout computation using full progressiveDrawn array
    let totalWin = 0;
    tickets.filter(t=>t.complete).forEach(ticket => {
      const { multiplier, posMatches, anyMatches } = computeTicketWin(ticket, progressiveDrawn);
      ticket.posMatches = posMatches; ticket.anyMatches = anyMatches; ticket.lastWin = ticket.stake * multiplier; totalWin += ticket.lastWin;
    });
    if (totalWin > 0) {
      animateBalanceTo(balance + totalWin);
      spawnWinPopup(totalWin);
  const winners = tickets.filter(t=>t.lastWin && t.lastWin>0);
  winners.forEach((t,i)=> { spawnTicketWinParticles(t); spawnCoinTravel(t,i); });
    }
    // BONUS TRIGGER: count bonus flags in results
    const bonusCount = results.filter(r=>r.bonus).length;
    console.log('[bonus] round complete bonusCount=', bonusCount, 'flags:', results.map(r=>r.bonus));
    if (bonusCount >= 3){
      // Initiate bonus round flow (scaffold)
      startBonusRound(results.filter(r=>r.bonus).map(r=>r.animal?.id || null));
      return; // bonus flow will handle resetting isPlaying when done
    }
    renderTickets();
      isPlaying = false; updatePlayButtonState(); updateClearButtonState();
  });
}

// --- Bonus Round System (25-Box Selection) ---
/**
 * CUSTOM BONUS ROUND (25-BOX SELECTION)
 * Trigger: 3+ bonus flags in base game.
 * Phase 1 (Selection): Display 5x5 grid of 25 distinct numbers (distribution: 9 two-digit, 8 three-digit, 8 four-digit).
 * Player picks exactly 5; boxes highlight gold when chosen and lock.
 * Phase 2 (Draw): Draw 5 animals; each animal assigned a number sample-with-replacement from the 25 set.
 * Match hierarchy (highest applies per draw): 4-digit exact = 40x stake base; 3-digit tail = 15x; 2-digit tail = 5x.
 * Guarantee: If no natural matches occur, force last draw to become a match (prefer longest selected number for potential top tier).
 * Celebration: If all 5 draws are 4-digit full matches of chosen numbers -> special excited alert + particle shower.
 * Stake Base: Sum of confirmed ticket stakes at trigger time (fallback 0.05 minimum to show prizes consistently).
 * Transition: Reuse existing multi-phase fade (base game out + overlay in, board fade in; reversed on completion).
 */
let bonusActive = false;
let bonusOverlay: Graphics | null = null;
let bonusContainer: Container | null = null;
let bonusBackdrop: Graphics | null = null; // solid backdrop under bonus UI
// Legacy lives variable retained (unused) for compatibility with existing transition code references
let bonusLivesRemaining = 0;
// New selection bonus state
let bonusSelectionNumbers: string[] = []; // 25 numbers
let bonusSelectedIndices: number[] = []; // indices of chosen boxes (length 5)
let bonusDrawAssigned: { animalId:number|null; number:string; tier?:number }[] = []; // five draws
let bonusPhase: 'select' | 'draw' | 'celebrate' | null = null;
let bonusCommitAnimating = false; // guards suck-in animation
// Captured stake at moment bonus starts (used for bonus payout base)
let bonusCapturedStake: number = 0;

function startBonusRound(triggerIds:(number|null)[]){
  if (bonusActive){ console.log('[bonus] startBonusRound called while already active - ignoring'); return; }
  console.log('[bonus] START bonus round triggerIds=', triggerIds);
  bonusActive = true;
  // Capture current selected stake (stakeSteps[stakeIndex]) for bonus payout base
  bonusCapturedStake = stakeSteps[stakeIndex];
  // Disable stake controls while bonus active
  if (stakePlusBtn instanceof HTMLElement) { stakePlusBtn.setAttribute('disabled','true'); stakePlusBtn.style.opacity='0.35'; stakePlusBtn.style.cursor='not-allowed'; }
  if (stakeMinusBtn instanceof HTMLElement) { stakeMinusBtn.setAttribute('disabled','true'); stakeMinusBtn.style.opacity='0.35'; stakeMinusBtn.style.cursor='not-allowed'; }
  // Phase 1: Fade base game out while overlay fades in for layered dissolve
  const baseContainers = [leftContainer, centerContainer, rightContainer];
  let baseFadeFrame = 0; const baseFadeTotal = 80; // match overlay duration
  const originalBaseAlpha = baseContainers.map(c=>c.alpha);
  app.ticker.add(function baseFade(){
    baseFadeFrame++;
    const pRaw = baseFadeFrame/baseFadeTotal;
    const p = 1 - Math.pow(1 - pRaw, 3); // cubic ease
    baseContainers.forEach((c,i)=>{ c.alpha = (1 - p) * originalBaseAlpha[i]; });
    if (baseFadeFrame >= baseFadeTotal){
      app.ticker.remove(baseFade);
      baseContainers.forEach(c=> c.visible = false); // hide completely once faded
    }
  });
  // Overlay fade in atop fading base
  bonusOverlay = new Graphics();
  bonusOverlay.rect(0,0,app.renderer.width, app.renderer.height);
  bonusOverlay.fill({ color:0x000000, alpha:0.0 });
  bonusOverlay.zIndex = 999;
  app.stage.addChild(bonusOverlay);
  let frame=0; const fadeFrames=80;
  app.ticker.add(function overlayFadeIn(){
    frame++;
    const rawP = frame/fadeFrames;
    const p = 1 - Math.pow(1 - rawP, 3);
    const targetAlpha = 0.82;
    if (bonusOverlay) bonusOverlay.alpha = targetAlpha * p;
    if (frame>=fadeFrames){ app.ticker.remove(overlayFadeIn); showBonusBoard(); }
  });
}

function showBonusBoard(){
  if (!bonusActive) return;
  console.log('[bonus] showBonusBoard (25-box selection)');
  bonusPhase = 'select';
  // Backdrop
  bonusBackdrop = new Graphics(); bonusBackdrop.rect(0,0,app.renderer.width, app.renderer.height); bonusBackdrop.fill({ color:0x101316, alpha:0 }); bonusBackdrop.zIndex = 1000; app.stage.addChild(bonusBackdrop);
  bonusContainer = new Container(); bonusContainer.zIndex = 1001; bonusContainer.alpha = 0; app.stage.addChild(bonusContainer);
  // Generate predetermined numbers: 9 two-digit, 8 three-digit, 8 four-digit
  bonusSelectionNumbers = [];
  const genUnique = (len:number):string => {
    let out='';
    do {
      if (len===2) out = Math.floor(Math.random()*100).toString().padStart(2,'0');
      else if (len===3) out = Math.floor(Math.random()*1000).toString().padStart(3,'0');
      else out = Math.floor(Math.random()*10000).toString().padStart(4,'0');
    } while (bonusSelectionNumbers.includes(out));
    return out;
  };
  for (let i=0;i<9;i++) bonusSelectionNumbers.push(genUnique(2));
  for (let i=0;i<8;i++) bonusSelectionNumbers.push(genUnique(3));
  for (let i=0;i<8;i++) bonusSelectionNumbers.push(genUnique(4));
  bonusSelectionNumbers = bonusSelectionNumbers.sort(()=>Math.random()-0.5);
  bonusSelectedIndices = [];
  // Layout 5x5
  const cols=5, rows=5; const cellW=118, cellH=92, gap=12;
  const boardW = cols*cellW + (cols-1)*gap; const boardH = rows*cellH + (rows-1)*gap;
  const startX = (app.renderer.width - boardW)/2; const startY = (app.renderer.height - boardH)/2;
  const title = new Text('BONUS SELECTION', new TextStyle({ fill:'#ffcc66', fontSize:30, fontWeight:'700', fontFamily:'system-ui' })); title.anchor.set(0.5); title.x = app.renderer.width/2; title.y = startY - 80; bonusContainer.addChild(title);
  const instr = new Text('Pick 5 boxes', new TextStyle({ fill:'#ffffff', fontSize:20, fontFamily:'system-ui' })); instr.anchor.set(0.5); instr.x = app.renderer.width/2; instr.y = startY - 44; bonusContainer.addChild(instr);
  const boxRefs: Graphics[] = [];
  bonusSelectionNumbers.forEach((num, idx)=>{
    const r = Math.floor(idx/cols); const c = idx%cols;
    const g = new Graphics(); g.roundRect(0,0,cellW,cellH,16); g.fill({ color:0x1d2229 }); g.stroke({ color:0x394653, width:3 });
    g.x = startX + c*(cellW+gap); g.y = startY + r*(cellH+gap); g.eventMode='static'; g.cursor='pointer';
    const style = new TextStyle({ fill:'#ffcc66', fontSize: num.length===4?34: num.length===3?30:28, fontWeight:'600', fontFamily:'monospace' });
    const txt = new Text(num, style); txt.anchor.set(0.5); txt.x = cellW/2; txt.y = cellH/2; g.addChild(txt);
    let hover=false; app.ticker.add(function hoverTick(){ if (g.destroyed){ app.ticker.remove(hoverTick); return; } const target = hover?1.06:1; g.scale.x += (target - g.scale.x)*0.15; g.scale.y = g.scale.x; });
    g.on('pointerover',()=> hover=true); g.on('pointerout',()=> hover=false);
    g.on('pointertap',()=>{
      if (bonusPhase!=='select') return;
      if (bonusSelectedIndices.includes(idx)) return;
      if (bonusCommitAnimating) return; // block selections during commit animation
      bonusSelectedIndices.push(idx);
  // Minimal selection state: subtle darker fill (no gold outline)
  g.fill({ color:0x223028 });
  g.stroke({ color:0x2f3d4b, width:3 });
  (g as any).isSelectedBox = true;
      if (bonusSelectedIndices.length === 5){ instr.text = 'Selections locked'; selectionCommitSuckIn(boxRefs); }
    });
  bonusContainer!.addChild(g); boxRefs.push(g);
  });
  // Fade in
  let f=0; const fadeFrames=40; app.ticker.add(function fadeIn(){ f++; const p=f/fadeFrames; const ease = 1 - Math.pow(1 - p, 3); if (bonusBackdrop) bonusBackdrop.alpha = ease; if (bonusContainer) bonusContainer.alpha = ease; if (f>=fadeFrames){ app.ticker.remove(fadeIn); } });
}

// Selection commit "suck-in" animation before alignment
function selectionCommitSuckIn(boxRefs: Graphics[]){
  if (bonusCommitAnimating) return; bonusCommitAnimating = true;
  const chosenGraphics = bonusSelectedIndices.map(i=> boxRefs[i]).filter(g=> !!g);
  if (!chosenGraphics.length){ bonusCommitAnimating = false; beginBonusDrawPhase(boxRefs); return; }
  // Compute centroid of chosen boxes
  const center = chosenGraphics.reduce((acc,g)=> { acc.x += g.x + g.width/2; acc.y += g.y + g.height/2; return acc; }, { x:0, y:0 });
  center.x /= chosenGraphics.length; center.y /= chosenGraphics.length;
  // Animate: shrink toward centroid then pop out slightly before alignment
  let f=0; const total=50; // ~0.8s
  const origs = chosenGraphics.map(g=> ({ x: g.x, y: g.y, sx: g.scale.x, sy: g.scale.y }));
  app.ticker.add(function commitTick(){
    f++; const p = f/total;
    // phases: 0-0.5 shrink, 0.5-0.85 expand overshoot, 0.85-1 settle to 1
    let scaleMult: number;
    if (p < 0.5){ // shrink
      scaleMult = 1 - p*0.25; // to 0.875
    } else if (p < 0.85){ // overshoot
      const local = (p-0.5)/(0.35); // 0..1
      scaleMult = 0.875 + local*0.38; // up to ~1.255
    } else { // settle
      const local = (p-0.85)/0.15; // 0..1
      scaleMult = 1.255 - local*0.255; // back to 1
    }
    chosenGraphics.forEach((g,i)=>{
      const o = origs[i];
      // position toward center during shrink, then slight outward on overshoot
      const towardStrength = p < 0.5 ? (p/0.5) : (1 - Math.max(0,(p-0.5)/0.5));
      const targetX = o.x + (center.x - (o.x + g.width/2))*0.18*towardStrength;
      const targetY = o.y + (center.y - (o.y + g.height/2))*0.18*towardStrength;
      g.x += (targetX - g.x)*0.22;
      g.y += (targetY - g.y)*0.22;
      g.scale.set(o.sx * scaleMult, o.sy * scaleMult);
    });
    if (f>=total){ app.ticker.remove(commitTick); bonusCommitAnimating = false; beginBonusDrawPhase(boxRefs); }
  });
}

function beginBonusDrawPhase(boxRefs:Graphics[]){
  bonusPhase='draw';
  console.log('[bonus] begin draw phase selections=', bonusSelectedIndices);
  // Fade out unselected boxes and horizontally align chosen five
  const chosenSet = new Set(bonusSelectedIndices);
  const chosenGraphics: Graphics[] = [];
  boxRefs.forEach((g, idx)=>{
    if (!chosenSet.has(idx)){
      let f=0; const dur=30; app.ticker.add(function fadeOut(){ f++; const p=f/dur; g.alpha = 1 - p; g.scale.x = g.scale.y = 1 - 0.1*p; if (f>=dur){ app.ticker.remove(fadeOut); g.destroy(); } });
    } else {
      chosenGraphics.push(g);
    }
  });
  // Reposition chosen five into an evenly spaced centered horizontal row
  if (chosenGraphics.length){
    const baselinePanelY = app.renderer.height - 180;
    const finalPanelY = Math.max(40, baselinePanelY - 260);
    const rowVerticalGap = 24;
    const baseY = finalPanelY - (chosenGraphics[0].height + rowVerticalGap);
    const totalWidthAvailable = app.renderer.width * 0.9; // use 90% of renderer width for breathing space
    const boxW = chosenGraphics[0].width;
    // Compute uniform gap so that N boxes + (N-1)*gap fits inside available width; cap minimum gap at 12
    let gap = (totalWidthAvailable - boxW * chosenGraphics.length) / (chosenGraphics.length - 1);
    gap = Math.max(12, Math.min(gap, 72));
    const rowWidth = boxW * chosenGraphics.length + gap * (chosenGraphics.length - 1);
    const startXRow = (app.renderer.width - rowWidth)/2;
    chosenGraphics.forEach((g,i)=>{
      const targetX = startXRow + i*(boxW + gap);
      const targetY = baseY;
      const sx = g.x; const sy = g.y; let f=0; const dur=42;
      app.ticker.add(function moveSel(){ f++; const p=f/dur; const ease = 1 - Math.pow(1 - p, 3); g.x = sx + (targetX - sx)*ease; g.y = sy + (targetY - sy)*ease; if (f>=dur){ app.ticker.remove(moveSel); } });
    });
  }
  // Determine base game slot height to mirror dimensions
  const baseGridHeight = centerContainer.height || (CARD_SIZE * GRID_COLS + GRID_GAP * (GRID_COLS - 1));
  const baseSlotCount = 5; const baseGap = 16; const baseHeaderOffset = 30;
  const baseAvailableHeight = baseGridHeight - baseHeaderOffset;
  const baseTotalGapHeight = baseGap * (baseSlotCount - 1);
  const baseSlotHeight = (baseAvailableHeight - baseTotalGapHeight) / baseSlotCount; // mirrors result slotHeight
  // Adopt SIDE_COLUMN_WIDTH for width to match base game result slots
  const drawSlotWidth = SIDE_COLUMN_WIDTH;
  const horizontalGap = 18;
  const panelPaddingX = 20; // left/right padding inside panel
  const panelInnerWidth = drawSlotWidth * baseSlotCount + horizontalGap * (baseSlotCount - 1);
  const panelWidth = panelInnerWidth + panelPaddingX * 2;
  // Panel height accommodates title area + slot height + bottom margin
  const panelTitleArea = 60; const panelBottomMargin = 28; const panelHeight = panelTitleArea + baseSlotHeight + panelBottomMargin;
  const panel = new Graphics(); panel.roundRect(0,0,panelWidth,panelHeight,22); panel.fill({ color:0x1a2027, alpha:0.92 }); panel.stroke({ color:0x394653, width:3 }); panel.x = (app.renderer.width-panelWidth)/2; panel.y = app.renderer.height - 180; bonusContainer?.addChild(panel);
  // Move panel up closer to selection row
  const raise = 260; panel.y = Math.max(40, panel.y - raise);
  const title = new Text('Drawing 5 Animals', new TextStyle({ fill:'#ffcc66', fontSize:24, fontWeight:'700', fontFamily:'system-ui' })); title.anchor.set(0.5); title.x = panel.x + panelWidth/2; title.y = panel.y + 28; bonusContainer?.addChild(title);
  const draws: { number:string; animalId:number|null }[] = [];
  const usedNumbers = new Set<string>();
  for (let i=0;i<5;i++){
    let num = '';
    for (let attempts=0; attempts<50; attempts++){
      const candidate = bonusSelectionNumbers[Math.floor(Math.random()*bonusSelectionNumbers.length)];
      if (!usedNumbers.has(candidate)){ num = candidate; break; }
    }
    if (!num){ num = bonusSelectionNumbers.find(n=> !usedNumbers.has(n)) || bonusSelectionNumbers[0]; }
    usedNumbers.add(num);
    const lastTwo = num.slice(-2); const animal = getAnimalByTwoDigits(lastTwo);
    draws.push({ number:num, animalId: animal? animal.id : null });
  }
  const selectedNumbers = bonusSelectedIndices.map(i=> bonusSelectionNumbers[i]);
  // Tier logic: For 4-digit selections and 4-digit drawn numbers, ONLY full match counts (no tail matches).
  // Otherwise evaluate 3-digit tail first then 2-digit tail.
  const tierFor = (sel:string, drawn:string):number => {
    if (sel.length===4 && drawn.length===4){
      return sel===drawn ? 40 : 0; // require full equality
    }
    if (sel.slice(-3) === drawn.slice(-3)) return 15;
    if (sel.slice(-2) === drawn.slice(-2)) return 5;
    return 0;
  };
  let anyMatch = draws.some(d=> selectedNumbers.some(sel=> tierFor(sel,d.number)>0));
  if (!anyMatch){
    const preferred = [...selectedNumbers].sort((a,b)=> b.length - a.length)[0];
    if (!usedNumbers.has(preferred)){
      const animal = getAnimalByTwoDigits(preferred.slice(-2));
      usedNumbers.delete(draws[draws.length-1].number);
      usedNumbers.add(preferred);
      draws[draws.length-1] = { number: preferred, animalId: animal? animal.id : null };
    } else {
      const alt = selectedNumbers.find(s=> !usedNumbers.has(s));
      if (alt){
        const animalAlt = getAnimalByTwoDigits(alt.slice(-2));
        usedNumbers.delete(draws[draws.length-1].number);
        usedNumbers.add(alt);
        draws[draws.length-1] = { number: alt, animalId: animalAlt? animalAlt.id : null };
      }
    }
  }
  bonusDrawAssigned = [];
  const slotW=drawSlotWidth, slotH=baseSlotHeight, gap=horizontalGap; const drawTotalWidth = slotW*5 + gap*4; const startX = panel.x + (panelWidth - drawTotalWidth)/2; const startY = panel.y + 60; // 60px title area
  const matchedOnce = new Set<number>(); // track global selected index matches to avoid duplicate effects
  function spawnMatchParticles(gRef: Graphics){
    for (let p=0; p<18; p++){
      const part = new Graphics();
      part.circle(0,0,3);
      part.fill({ color:0x6ef392 });
      const angle = Math.random()*Math.PI*2;
      const speed = 2 + Math.random()*2.5;
      part.x = gRef.x + gRef.width/2;
      part.y = gRef.y + gRef.height/2;
      part.alpha = 0.95;
      bonusContainer?.addChild(part);
      let f=0; const life = 42 + Math.random()*18;
      app.ticker.add(function particleTick(){
        f++; const prog = f/life;
        part.x += Math.cos(angle)*speed;
        part.y += Math.sin(angle)*speed*0.55 - 0.02*f;
        part.alpha = 0.95*(1 - prog);
        part.scale.set(1 + prog*0.8);
        if (f>=life){ app.ticker.remove(particleTick); part.destroy(); }
      });
    }
  }
  async function reveal(i:number){
    const slot = new Graphics(); slot.roundRect(0,0,slotW,slotH,16); slot.fill({ color:0x232a34 }); slot.stroke({ color:0x445364, width:2 }); slot.x = startX + i*(slotW+gap); slot.y = startY; slot.alpha=0; bonusContainer?.addChild(slot);
    const number = draws[i].number;
    const animalEmoji = (() => { const lastTwo = number.slice(-2); const ani = getAnimalByTwoDigits(lastTwo); return ani? ani.emoji : '❓'; })();
    const emojiTxt = new Text(animalEmoji, new TextStyle({ fill:'#ffffff', fontSize:42, fontFamily:'system-ui' }));
    emojiTxt.anchor.set(0.5); emojiTxt.x = slotW/2; emojiTxt.y = 20; emojiTxt.alpha=0; emojiTxt.scale.set(0.2);
    const numTxt = new Text(number, new TextStyle({ fill:'#ffcc66', fontSize: number.length===4?30:number.length===3?26:24, fontFamily:'monospace', fontWeight:'700' }));
    numTxt.anchor.set(0.5); numTxt.x=slotW/2; numTxt.y=slotH/2 + 4; numTxt.alpha=0; numTxt.scale.set(0.2);
    slot.addChild(emojiTxt, numTxt);
    let af=0; const appearDur=40; app.ticker.add(function appear(){ af++; const p=af/appearDur; const ease = 1 - Math.pow(1 - p, 3); slot.alpha = ease; numTxt.alpha = ease; numTxt.scale.set(0.2 + (1-0.2)*ease); emojiTxt.alpha = ease; emojiTxt.scale.set(0.2 + (1-0.2)*ease); if (af>=appearDur){ app.ticker.remove(appear); } });
    let bestTier=0; selectedNumbers.forEach(sel=> { const t = tierFor(sel, number); if (t>bestTier) bestTier=t; });
    if (bestTier>0){
      const prize = new Text(bestTier+'x', new TextStyle({ fill:'#6ef392', fontSize:24, fontWeight:'700', fontFamily:'system-ui' })); prize.anchor.set(0.5); prize.x = slotW/2; prize.y = slotH - 18; prize.alpha=0; slot.addChild(prize);
      let pf=0; const pDur=30; app.ticker.add(function prizeTick(){ pf++; const pp=pf/pDur; prize.alpha = pp; prize.scale.set(0.6 + 0.4*pp); if (pf>=pDur){ app.ticker.remove(prizeTick); } });
      // Green tint + particle burst for each newly matched selected box
      selectedNumbers.forEach((sel, si)=>{
        const tier = tierFor(sel, number);
        if (tier>0){
          const idxGlobal = bonusSelectedIndices[si];
          if (!matchedOnce.has(idxGlobal)){
            matchedOnce.add(idxGlobal);
            const gRef = boxRefs[idxGlobal];
            if (gRef && !gRef.destroyed){
              gRef.fill({ color:0x1e4d2b }); // green tint
              gRef.stroke({ color:0x3c7e4d, width:4 });
              // Pop scale animation
              let pf2=0; const popDur=32; const origScaleX = gRef.scale.x; const origScaleY = gRef.scale.y;
              app.ticker.add(function popAnim(){
                pf2++; const p = pf2/popDur; const ease = p<0.5? (4*p*p*p) : (1 - Math.pow(-2*p+2,3)/2);
                const overshoot = 1 + 0.28*ease;
                gRef.scale.set(origScaleX*overshoot, origScaleY*overshoot);
                if (pf2>=popDur){ gRef.scale.set(origScaleX, origScaleY); app.ticker.remove(popAnim); }
              });
              spawnMatchParticles(gRef);
            }
          }
        }
      });
    }
    bonusDrawAssigned.push({ animalId: draws[i].animalId, number, tier: bestTier });
  await new Promise(r=> setTimeout(r, 850));
  }
  (async()=>{ await new Promise(r=> setTimeout(r, 900)); for (let i=0;i<draws.length;i++){ await reveal(i); } finalizeSelectionBonus(selectedNumbers); })();
}

function finalizeSelectionBonus(selectedNumbers:string[]){
  bonusPhase='celebrate';
  // Use captured stake chosen at bonus start (fallback 0.05 if somehow zero)
  const baseStake = bonusCapturedStake || 0.05;
  let totalWin = 0; let allTop=true; let matchedCount=0;
  bonusDrawAssigned.forEach(d=>{ if (d.tier && d.tier>0){ matchedCount++; totalWin += baseStake * d.tier; if (d.tier !== 40) allTop=false; } else { allTop=false; } });
  if (totalWin>0){ animateBalanceTo(balance + totalWin); spawnWinPopup(totalWin); }
  const summaryBg = new Graphics(); summaryBg.roundRect(0,0,640,180,28); summaryBg.fill({ color:0x0d1114, alpha:0.92 }); summaryBg.stroke({ color: allTop?0xffeb3b:0xffd54f, width:4 }); summaryBg.x = (app.renderer.width-640)/2; summaryBg.y = (app.renderer.height-180)/2; bonusContainer?.addChild(summaryBg);
  const msgStr = allTop && matchedCount===5 ? 'INCREDIBLE! ALL 5 TOP MATCHES!' : `Bonus Win: £${totalWin.toFixed(2).replace('.00','')}`;
  const msg = new Text(msgStr, new TextStyle({ fill: allTop? '#ffeb3b':'#6ef392', fontSize: allTop?38:34, fontWeight:'800', fontFamily:'system-ui' })); msg.anchor.set(0.5); msg.x = summaryBg.x + 320; msg.y = summaryBg.y + 70; bonusContainer?.addChild(msg);
  if (allTop){
    for (let i=0;i<60;i++){
      const star = new Graphics(); star.rect(-2,-8,4,16); star.rect(-8,-2,16,4); star.fill({ color:0xffd54f }); star.x = summaryBg.x + Math.random()*640; star.y = summaryBg.y + 20 + Math.random()*140; star.alpha=0; bonusContainer?.addChild(star);
      let sf=0; const dur=100 + Math.random()*60; app.ticker.add(function starFx(){ sf++; const p=sf/dur; star.alpha = Math.min(0.85, p*2)*(1-p); star.rotation += 0.2; if (sf>=dur){ app.ticker.remove(starFx); star.destroy(); } });
    }
  }
  let hold=0; const holdFrames=120; app.ticker.add(function waitEnd(){ hold++; if (hold>=holdFrames){ app.ticker.remove(waitEnd); cleanupBonus(); } });
}

function cleanupBonus(){
  // Fade out bonus content first matching fade-in duration but reversed
  const contentToFade: (Container|Graphics)[] = [];
  if (bonusContainer) contentToFade.push(bonusContainer);
  if (bonusBackdrop) contentToFade.push(bonusBackdrop);
  let frame=0; const fadeFrames=80; app.ticker.add(function contentFade(){
    frame++; const rawP = frame/fadeFrames; const p = rawP*rawP*rawP; // cubic accelerate out
    contentToFade.forEach(el => { el.alpha = 1 - p; });
    if (frame>=fadeFrames){
      app.ticker.remove(contentFade);
      // Clear new bonus state
      bonusSelectionNumbers = []; bonusSelectedIndices = []; bonusDrawAssigned = []; bonusPhase=null;
      bonusContainer?.destroy(); bonusContainer = null;
      bonusBackdrop?.destroy(); bonusBackdrop = null;
      // Now fade out overlay itself
      if (bonusOverlay){
        let of=0; const odur=80; const startAlpha = bonusOverlay.alpha; app.ticker.add(function overlayFade(){
          of++; const opRaw = of/odur; const op = 1 - Math.pow(1 - opRaw, 3);
          bonusOverlay!.alpha = startAlpha*(1 - op);
          if (of>=odur){
            app.ticker.remove(overlayFade);
            bonusOverlay?.destroy(); bonusOverlay=null; bonusActive=false; isPlaying=false;
            // Phase 2: fade base game back in
            const baseContainers = [leftContainer, centerContainer, rightContainer];
            baseContainers.forEach(c=> { c.visible = true; c.alpha = 0; });
            let bf=0; const bTotal=80; app.ticker.add(function baseReturn(){ bf++; const pRaw = bf/bTotal; const p = 1 - Math.pow(1 - pRaw, 3); baseContainers.forEach(c=> c.alpha = p); if (bf>=bTotal){ app.ticker.remove(baseReturn); updatePlayButtonState(); updateClearButtonState(); } });
            // Restore stake controls
            if (stakePlusBtn instanceof HTMLElement){ stakePlusBtn.removeAttribute('disabled'); stakePlusBtn.style.opacity='1'; stakePlusBtn.style.cursor='pointer'; }
            if (stakeMinusBtn instanceof HTMLElement){ stakeMinusBtn.removeAttribute('disabled'); stakeMinusBtn.style.opacity='1'; stakeMinusBtn.style.cursor='pointer'; }
          }
        });
      }
    }
  });
}

// Debug key to force bonus round (now new selection bonus)
window.addEventListener('keydown', (e)=>{
  if (e.key === 'b' && !bonusActive && !isPlaying){
    console.log('[debug] Forcing bonus round');
    startBonusRound([]);
  }
});

// Popup win animation near balance
function spawnWinPopup(amount:number){
  const rootEl = document.getElementById('balance-value');
  if (!rootEl) return;
  const popup = document.createElement('div');
  popup.textContent = `+${formatStakeValue(amount)}`;
  popup.style.position = 'absolute';
  const rect = rootEl.getBoundingClientRect();
  const parentRect = document.body.getBoundingClientRect();
  popup.style.left = `${rect.left + rect.width/2}px`;
  popup.style.top = `${rect.top - 4}px`;
  popup.style.transform = 'translate(-50%,0)';
  popup.style.pointerEvents = 'none';
  popup.style.fontFamily = 'system-ui, monospace';
  popup.style.fontSize = '16px';
  popup.style.fontWeight = '700';
  popup.style.color = '#6ef392';
  popup.style.textShadow = '0 2px 6px rgba(0,0,0,0.6)';
  popup.style.opacity = '0';
  popup.style.transition = 'transform 0.9s ease-out, opacity 0.9s ease-out';
  document.body.appendChild(popup);
  // Force reflow then animate
  requestAnimationFrame(()=>{
    popup.style.opacity = '1';
    popup.style.transform = 'translate(-50%,-40px)';
  });
  // Remove after animation
  setTimeout(()=>{ popup.style.opacity='0'; popup.style.transform='translate(-50%,-60px)'; }, 900);
  setTimeout(()=>{ popup.remove(); }, 1600);
}

// Stake control logic
// Ticket win particle burst
function spawnTicketWinParticles(ticket:Ticket){
  const idx = tickets.indexOf(ticket); if (idx === -1) return;
  const panelWidth = SIDE_COLUMN_WIDTH;
  const cardY = idx * (TICKET_HEIGHT + 10);
  const originX = leftContainer.x + panelWidth - 60;
  const originY = leftContainer.y + 28 + cardY + 14;
  const count = 8 + Math.floor(Math.random()*5);
  for (let i=0;i<count;i++){
    const star = new Graphics();
    star.rect(-2,-8,4,16); star.rect(-8,-2,16,4);
    star.fill({ color:0xffd54f });
    star.x = originX; star.y = originY; star.alpha = 0.95; star.scale.set(1);
    const angle = (-Math.PI/2) + (Math.random()-0.5)*Math.PI/1.4;
    const speed = 2 + Math.random()*2.6;
    const life = 40 + Math.random()*18;
    const spin = (Math.random()-0.5)*0.25;
    let f=0; app.stage.addChild(star);
    app.ticker.add(function tick(){
      f++; const p = f/life;
      star.x += Math.cos(angle)*speed; star.y += Math.sin(angle)*speed*0.85 - 0.04*f;
      star.rotation += spin;
      star.scale.set(1 - p*0.6);
      star.alpha = 0.95*(1-p);
      if (f>=life){ app.ticker.remove(tick); star.destroy(); }
    });
  }
}
// Coin travel animation from winning ticket to balance display (separate from particle burst)
function spawnCoinTravel(ticket:Ticket, indexInWinners:number){
  const idx = tickets.indexOf(ticket); if (idx === -1) return;
  const panelWidth = SIDE_COLUMN_WIDTH;
  const cardY = idx * (TICKET_HEIGHT + 10);
  const startX = leftContainer.x + panelWidth - 40;
  const startY = leftContainer.y + 28 + cardY + TICKET_HEIGHT/2;
  const balanceEl = document.getElementById('balance-value');
  const canvasRect = app.canvas.getBoundingClientRect();
  let endX = startX + 100; let endY = startY - 120;
  if (balanceEl){
    const bRect = balanceEl.getBoundingClientRect();
    endX = bRect.left + bRect.width/2 - canvasRect.left;
    endY = bRect.top + bRect.height/2 - canvasRect.top;
  }
  const cpX = (startX + endX)/2 + 50;
  const cpY = Math.min(startY,endY) - 140;
  const coin = new Graphics();
  coin.circle(0,0,12);
  coin.fill({ color:0xffd54f });
  coin.stroke({ color:0x9e7b16, width:3 });
  coin.x = startX; coin.y = startY; coin.alpha = 0; coin.scale.set(0.85);
  app.stage.addChild(coin);
  let f=0; const dur=120; const startDelay = indexInWinners * 18; f = -startDelay;
  app.ticker.add(function coinTick(){
    f++;
    if (f < 0) return;
    const t = f/dur;
    const ease = t < 0.5 ? 2*t*t : 1 - Math.pow(-2*t+2,2)/2;
    const bx = (1-ease)*(1-ease)*startX + 2*(1-ease)*ease*cpX + ease*ease*endX;
    const by = (1-ease)*(1-ease)*startY + 2*(1-ease)*ease*cpY + ease*ease*endY;
    coin.x = bx; coin.y = by;
    coin.alpha = Math.min(1, t*2);
    coin.rotation += 0.35;
    coin.scale.set(0.85 + 0.18*ease);
    if (f >= 0 && f % 9 === 0){
      const spark = new Graphics(); spark.circle(0,0,3); spark.fill({ color:0xfff6c2 }); spark.x = coin.x; spark.y = coin.y; spark.alpha=0.9; app.stage.addChild(spark);
      let sf=0; const sl=30; app.ticker.add(function sparkTick(){ sf++; spark.alpha = 0.9*(1 - sf/sl); spark.scale.set(1 + sf/sl*1.4); if (sf>=sl){ app.ticker.remove(sparkTick); spark.destroy(); } });
    }
    if (f>=dur){
      app.ticker.remove(coinTick);
      let fade=0; const fadeDur=20; app.ticker.add(function fadeCoin(){ fade++; coin.alpha = 1 - fade/fadeDur; if (fade>=fadeDur){ app.ticker.remove(fadeCoin); coin.destroy(); } });
    }
  });
}
const stakeSteps = [0.05,0.10,0.20,0.50,1,2];
let stakeIndex = 0;
function formatStake(v:number){ return v < 1 ? `${(v*100).toFixed(0)}p` : `£${v.toFixed(2)}`; }
const stakeValueEl = document.getElementById('stake-value');
const stakePlusBtn = document.getElementById('stake-plus');
const stakeMinusBtn = document.getElementById('stake-minus');
function refreshStakeDisplay(){ if(stakeValueEl) stakeValueEl.textContent = stakeSteps[stakeIndex] < 1 ? `${(stakeSteps[stakeIndex]*100).toFixed(0)}p` : `£${stakeSteps[stakeIndex].toFixed(2)}`; }
stakePlusBtn?.addEventListener('click',()=>{ if(stakeIndex < stakeSteps.length-1) stakeIndex++; refreshStakeDisplay(); });
stakeMinusBtn?.addEventListener('click',()=>{ if(stakeIndex > 0) stakeIndex--; refreshStakeDisplay(); });
refreshStakeDisplay();



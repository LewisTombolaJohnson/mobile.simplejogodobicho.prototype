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
// Global layout mode: when true, remove horizontal margins and force panels to span full device width.
// This is to ensure all 5 result boxes are fully visible edge-to-edge without cropping.
const EDGE_TO_EDGE = true;
// Fixed mobile logical width target (previously hard clamp). Retained for reference but no longer used to shrink logical width.
const MOBILE_TARGET_WIDTH = 720; // historical baseline; width scaling now width-driven only
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
  // Play button removed; keep random button state updates
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
  console.log('[postInit] isMobileLayout() =>', isMobileLayout());
  attachTicketPanelInteractions();
  renderTickets(); refreshStakeLimitStatus(); updatePlayButtonState(); updateRandomButtonState(); updateClearButtonState();
  buildGrid();
  layout();
  // Show lobby on initial load
  showLaunchTicketMenu();
  if (randomBtn) randomBtn.style.display = 'none';
  if (clearBtn) clearBtn.style.display = 'none';
  // Center tickets panel
  buildCenterTicketsPanel();
  attachCenterScroll();
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
  // @ts-ignore force flag on window for external inspection
  window.__MOBILE = true;
  return true; // silent force
}

// Helper map last two digits -> animal group
function getAnimalByTwoDigits(two: string) {
  let d = parseInt(two, 10);
  if (two === '00') d = 100;
  return animals.find(a => a.numbers.includes(d)) || null;
}

// Build animal grid
function buildGrid(){
  // Hide 5x5 animal grid: use center tickets panel instead
  buildCenterTicketsPanel();
}

// Center stacked tickets panel globals (added for new middle view replacing grid)
let centerTicketsContainer: Container | null = null;
let centerTicketsMask: Graphics | null = null;
let centerScrollY = 0; // vertical scroll offset
let centerVisibleHeight = 0; // mask height (visible window)
// Remember last gameplay (non-lobby) panel width so lobby uses identical width
let lastCenterPanelWidth: number | null = null;
// Full gameplay width (including potential side columns) captured to preserve appearance under lobby
let baselineGameWidth: number | null = null;
// Baseline gameplay dimensions for mobile stack (captured when not in lobby)
let baselineGridWidth: number | null = null;
let baselineGridHeight: number | null = null;
// Track last center offsetX (inner content centering) for layout adjustments
let lastCenterContentOffsetX: number = 0;
// Fixed center panel width once established (width when first tickets created)
let fixedCenterPanelWidth: number | null = null;

// Lightweight refresh of middle ticket panel (center) preserving scroll position.
function refreshCenterTickets(){
  const prevScroll = centerScrollY;
  buildCenterTicketsPanel();
  // restore scroll (clamp inside current visible height)
  centerScrollY = prevScroll;
  if (centerTicketsContainer){
    const contentH = centerTicketsContainer.height;
    const minY = Math.min(0, centerVisibleHeight - contentH);
    centerScrollY = Math.max(minY, Math.min(0, centerScrollY));
    centerTicketsContainer.y = centerScrollY;
  }
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

function buildCenterTicketsPanel(){
  if (!app || !centerContainer) return;
  if (!centerTicketsContainer){ centerTicketsContainer = new Container(); centerContainer.addChild(centerTicketsContainer); }
  centerTicketsContainer.removeChildren();
  const marginX = EDGE_TO_EDGE ? 0 : 20;
  const deviceW = window.innerWidth;
  // Allow logical panel width to use full available device width (minus margins) without artificial clamp.
  const maxLogical = deviceW; // remove MOBILE_TARGET_WIDTH hard cap for consistent width across ticket counts
  // Compute gridWidth the same way the results panel does, so center tickets match call boxes
  const baseGridWidth = centerContainer.width || (CARD_SIZE * GRID_COLS + GRID_GAP * (GRID_COLS - 1));
  const gridWidth = EDGE_TO_EDGE ? deviceW : Math.max(Math.min(deviceW - marginX*2, baseGridWidth), 320);
  // contentPanelW is the actual width of ticket cards; centerContainer itself may span full width (deviceW)
  let panelW: number; // full logical width used previously
  let contentPanelW: number; // new inner card width (capped and centered)
  // Consistent sizing: lock to previously seen width or a target max instead of stretching to full device width.
  // Force panel width to exactly match current game width (call boxes width)
  const TARGET_MAX = 1100;
  fixedCenterPanelWidth = Math.max(420, Math.min(gridWidth, TARGET_MAX));
  panelW = gridWidth;
  baselineGameWidth = Math.max(baselineGameWidth || 0, panelW);
  // Determine inner content width (do not exceed a comfortable max for readability)
  const MAX_CONTENT_WIDTH = 1100;
  // Make inner content width equal to the panel width to remove any horizontal offset
  contentPanelW = Math.min(panelW, MAX_CONTENT_WIDTH);
  const offsetX = Math.max(0, Math.floor((panelW - contentPanelW) / 2)); // center within full width
  lastCenterContentOffsetX = offsetX;
  // Resize renderer if panel exceeds current width
  // Renderer width should at least fit the locked panel width; avoid shrinking beyond established width.
  const desiredRendererW = panelW + marginX*2;
  if (app.renderer.width < desiredRendererW){
    app.renderer.resize(desiredRendererW, app.renderer.height);
    console.log('[centerPanel] widened renderer to panel width', { desiredRendererW, panelW });
  }
  console.log('[centerPanel] CONSISTENT FIXED sizing', { panelW, contentPanelW, offsetX, fixedCenterPanelWidth, baselineGameWidth, rendererW: app.renderer.width });
  const ticketH = TICKET_HEIGHT + 30;
  tickets.forEach((ticket, idx) => {
    const card = new Graphics();
    card.roundRect(0,0,contentPanelW,ticketH,20);
    card.fill({ color:0x232a34 });
    card.stroke({ color: ticket.lastWin && ticket.lastWin>0 ? 0xffd54f : 0x2f3d4b, width: ticket.lastWin && ticket.lastWin>0 ? 3 : 2 });
    card.x = offsetX; card.y = idx * (ticketH + 12);
    const stakeStr = formatStakeValue(ticket.stake);
    const headerStyle = new TextStyle({ fill:'#ffcc66', fontSize:16, fontFamily:'system-ui', fontWeight:'600' });
    const winSuffix = ticket.lastWin && ticket.lastWin > 0 ? ` +${formatStakeValue(ticket.lastWin)}` : '';
    const header = new Text(`${stakeStr}${winSuffix}`, headerStyle); header.anchor.set(0,0); header.x = 14; header.y = 8; card.addChild(header);
    // Status badge
    const statusStyle = new TextStyle({ fill:'#ffffff', fontSize:12, fontFamily:'system-ui', fontWeight:'600' });
    const statusText = ticket.complete ? 'CONFIRMED' : 'IN-PROGRESS';
    const statusColor = ticket.complete ? 0x2e7d32 : 0x607d8b;
    const badge = new Graphics(); badge.roundRect(0,0,104,22,10); badge.fill({ color:statusColor }); badge.x = contentPanelW - 118; badge.y = 10; card.addChild(badge);
    const badgeTxt = new Text(statusText, statusStyle); badgeTxt.anchor.set(0.5); badgeTxt.x = badge.x + 52; badgeTxt.y = badge.y + 11; card.addChild(badgeTxt);
    // Slots
    const slotSize = 44; const slotGap = 10; const totalSlotsWidth = slotSize*5 + slotGap*4; const startX = offsetX + (contentPanelW - totalSlotsWidth)/2; const startY = 38;
    for (let i=0;i<5;i++){
      const hasAnimal = i < ticket.animals.length;
      const positional = hasAnimal && ticket.posMatches && ticket.posMatches[i];
      const anyMatch = hasAnimal && ticket.anyMatches && ticket.anyMatches[i];
      const slot = new Graphics(); slot.roundRect(0,0,slotSize,slotSize,12);
      let fillColor = 0x1b222b;
      if (hasAnimal) fillColor = 0x26313d;
      if (anyMatch) fillColor = 0x5d4a1a;
      if (positional) fillColor = 0x1e4d2b;
      slot.fill({ color: fillColor });
      slot.stroke({ color: positional ? 0x66bb6a : anyMatch ? 0xffd54f : 0x2f3d4b, width: 1 });
      slot.x = startX + i*(slotSize + slotGap); slot.y = startY;
      if (hasAnimal){
        const a = animals.find(a=>a.id===ticket.animals[i]);
        if (a){
          const emo = new Text(a.emoji, new TextStyle({ fill:'#fff', fontSize:30 })); emo.anchor.set(0.5); emo.x=slotSize/2; emo.y=slotSize/2; slot.addChild(emo);
          if (positional || anyMatch){
            const markerChar = positional ? '\u2713' : '\u2605';
            const marker = new Text(markerChar, new TextStyle({ fill: positional ? '#6ef392' : '#ffd54f', fontSize:16, fontWeight:'700' })); marker.anchor.set(1,0); marker.x = slotSize - 4; marker.y = 4; slot.addChild(marker);
          }
        }
      }
      card.addChild(slot);
    }
    // Win reflection / outcome line
    if (ticket.complete) {
      const outcomeY = 38 + 44 + 8; // below slots
      let outcomeText: string;
      let outcomeColor: string;
      if (ticket.lastWin && ticket.lastWin > 0) {
        outcomeText = `WIN ${formatStakeValue(ticket.lastWin)}`;
        outcomeColor = '#ffd54f';
        // Trophy icon
        const trophy = new Text('🏆', new TextStyle({ fontSize: 20 }));
        trophy.anchor.set(0,0.5); trophy.x = 14; trophy.y = outcomeY + 2; card.addChild(trophy);
        const winGlow = new Graphics();
        winGlow.roundRect(2,2,contentPanelW-4,ticketH-4,18);
        winGlow.stroke({ color:0xffd54f, width:2 });
        winGlow.alpha = 0.35; // subtle overlay
        card.addChildAt(winGlow,0); // behind content
      } else {
        outcomeText = 'NO WIN';
        outcomeColor = '#607d8b';
      }
      const outcomeStyle = new TextStyle({ fill: outcomeColor, fontSize: 14, fontFamily:'system-ui', fontWeight:'600' });
      const outcome = new Text(outcomeText, outcomeStyle);
      outcome.anchor.set(1,0.5); outcome.x = offsetX + contentPanelW - 14; outcome.y = outcomeY + 2; card.addChild(outcome);
    }
    centerTicketsContainer!.addChild(card);
  });
  const headerOffset = 0;
  // If no tickets yet, pretend there are 5 to establish initial panel height and spacing
  const initialCount = tickets.length === 0 ? 5 : tickets.length;
  const contentHeight = initialCount * (ticketH + 12) - 12;
  // Make the center panel fill the available vertical space of the CANVAS (renderer), not the window,
  // so it fits the enforced 9:16 aspect without clipping
  const canvasH = app.renderer.height;
  centerVisibleHeight = Math.max(240, canvasH - BOTTOM_UI_HEIGHT - TOP_MARGIN - 60);
  // During lobby, ensure visible height at least accommodates 5-ticket content to prevent perceived cropping
  if (launchMenuActive) {
    centerVisibleHeight = Math.max(centerVisibleHeight, contentHeight);
  }
  if (!centerTicketsMask){ centerTicketsMask = new Graphics(); centerContainer.addChild(centerTicketsMask); }
  centerTicketsMask.clear();
  // Mask only vertical clipping; widen horizontal to panelW
  // Mask should match the full panel width so scrollable area equals game width
  centerTicketsMask.rect(0, headerOffset, panelW, centerVisibleHeight);
  centerTicketsMask.fill(0xffffff);
  centerTicketsContainer!.mask = centerTicketsMask;
  centerContainer.removeChildren();
  centerContainer.addChild(centerTicketsContainer!, centerTicketsMask);
  // Clamp scroll before applying
  const minY = Math.min(0, centerVisibleHeight - contentHeight);
  centerScrollY = Math.max(minY, Math.min(0, centerScrollY));
  // Inner container anchored at 0 since cards already shifted by offsetX
  // Align inner content with mask: place container at offsetX so drawn cards match mask edges
  centerTicketsContainer!.x = offsetX; centerTicketsContainer!.y = headerOffset + centerScrollY;
  // Ensure the big central ticket box is the interactive region
  centerContainer.eventMode = 'static';
  centerContainer.hitArea = new Rectangle(0, headerOffset, panelW, centerVisibleHeight);
  console.log('[centerPanel-hitArea]', { x:0, y:headerOffset, w: panelW, h: centerVisibleHeight });
  console.log('[centerPanel]', { launchMenuActive, panelW, rendererW: app.renderer.width, deviceW });
}

// (Grid hidden) See original buildGrid for sizing; this helper removed.

// Center scroll interaction
function attachCenterScroll(){
  if (!centerContainer) return;
  centerContainer.eventMode = 'static';
  let dragging = false; let startY = 0; let startScrollY = 0;
  centerContainer.on('pointerdown',(e:any)=>{ dragging = true; startY = e.globalY; startScrollY = centerScrollY; });
  centerContainer.on('pointerup', ()=> dragging=false);
  centerContainer.on('pointerupoutside', ()=> dragging=false);
  centerContainer.on('pointermove',(e:any)=>{ if(!dragging) return; const dy = e.globalY - startY; centerScrollY = startScrollY + dy; const contentH = (centerTicketsContainer?.height||0); const minY = Math.min(0, centerVisibleHeight - contentH); centerScrollY = Math.max(minY, Math.min(0, centerScrollY)); if(centerTicketsContainer) centerTicketsContainer.y = centerScrollY; });
  // Wheel support
  window.addEventListener('wheel', (ev)=>{
    if (!centerContainer || !centerTicketsContainer) return;
    if (ev.deltaY === 0) return;
    const contentH = centerTicketsContainer.height;
    const minY = Math.min(0, centerVisibleHeight - contentH);
    centerScrollY = Math.max(minY, Math.min(0, centerScrollY - ev.deltaY));
    centerTicketsContainer.y = centerScrollY;
  }, { passive:true });
  const canvasEl = app?.canvas as HTMLCanvasElement | undefined;
  if (canvasEl){
    canvasEl.addEventListener('wheel', (ev)=>{
      if (!centerContainer || !centerTicketsContainer) return;
      if (ev.deltaY === 0) return;
      const contentH = centerTicketsContainer.height;
      const minY = Math.min(0, centerVisibleHeight - contentH);
      centerScrollY = Math.max(minY, Math.min(0, centerScrollY - ev.deltaY));
      centerTicketsContainer.y = centerScrollY;
    }, { passive:true });
  }
}

// (Duplicate postInit removed; center panel is hooked in original postInit)

function layout() {
  if (!app || !leftContainer || !centerContainer || !rightContainer) return;
  let w = app.renderer.width;
  let h = app.renderer.height;
  const mobile = isMobileLayout();
  console.log('[layout] branch', mobile ? 'MOBILE' : 'DESKTOP', { w, h });
  // Guard: if lobby active and we have a stored gameplay width, ensure renderer not narrower than baseline
  if (launchMenuActive && lastCenterPanelWidth){
    const minLogical = lastCenterPanelWidth + 40; // add some side breathing space
    if (app.renderer.width < minLogical){
      app.renderer.resize(minLogical, app.renderer.height);
      w = app.renderer.width; h = app.renderer.height;
      console.log('[layout] expanded renderer width for lobby baseline', { minLogical });
    }
  }
  if (launchMenuActive && baselineGameWidth){
    if (app.renderer.width < baselineGameWidth){
      app.renderer.resize(baselineGameWidth, app.renderer.height);
      w = app.renderer.width; h = app.renderer.height;
      console.log('[layout] enforced baselineGameWidth', { baselineGameWidth });
    }
  }
  if (!launchMenuActive){
    // Capture widest seen width of center panel during gameplay for later lobby reuse
    const currentCenterWidth = centerTicketsContainer?.width || centerContainer.width || 0;
    if (currentCenterWidth > (lastCenterPanelWidth||0)){ lastCenterPanelWidth = currentCenterWidth; }
    if (app.renderer.width > (baselineGameWidth||0)){ baselineGameWidth = app.renderer.width; }
    // Capture grid height/width snapshot (mobile baseline). Use centerContainer bounds or fallback.
    const currentGridW = centerContainer.width || currentCenterWidth;
    const currentGridH = centerContainer.height || 0;
    if (currentGridW && currentGridW > (baselineGridWidth||0)) baselineGridWidth = currentGridW;
    if (currentGridH && currentGridH > (baselineGridHeight||0)) baselineGridHeight = currentGridH;
    console.log('[layout gameplay width capture]', { lastCenterPanelWidth, baselineGameWidth, rendererW: app.renderer.width });
  }
  
  if (mobile) {
    // Add body class for mobile styling hooks (once)
    document.body.classList.add('mobile-mode');
    // Mobile layout: results above grid, tickets below grid, all centered horizontally
    // First ensure grid is at scale 1
    centerContainer.scale.set(1);

  // Build only results panel; hide legacy bottom tickets panel in mobile
  leftContainer.visible = false;
  buildRightSlots();

    // Constrain grid width to device viewport and derive aligned width for sections
    const marginX = EDGE_TO_EDGE ? 0 : 20;
    const deviceW = window.innerWidth;
  // When lobby active centerContainer may be empty/cleared; fall back to baseline captured dimensions
  let baseGridWidth = centerContainer.width; // after widening center panel
  let gridWidth = EDGE_TO_EDGE ? deviceW : Math.max(Math.min(deviceW - marginX * 2, baseGridWidth), 320);
  let gridHeight = launchMenuActive && baselineGridHeight ? baselineGridHeight : centerContainer.height;

    // Ensure grid fits horizontally: apply width-based scaling if needed
    const maxGridWidth = EDGE_TO_EDGE ? deviceW : (deviceW - marginX * 2);
    if (!EDGE_TO_EDGE && baseGridWidth > maxGridWidth && !launchMenuActive) { // avoid shrinking during lobby when margins active
      const scaleW = Math.max(0.45, Math.min(1, maxGridWidth / baseGridWidth));
      centerContainer.scale.set(scaleW);
      // Recompute grid dimensions after width scaling
      baseGridWidth = centerContainer.width;
      gridWidth = EDGE_TO_EDGE ? deviceW : Math.max(Math.min(deviceW - marginX * 2, baseGridWidth), 320);
      gridHeight = centerContainer.height;
      // Rebuild results panel to align to new gridWidth
      buildRightSlots();
    }
    
  const resultPanelHeight = 30 + 100; // header + slot height (approx; slots sized in buildRightSlots)
  const gap = 15; // gap between sections
  let totalHeight = gridHeight + gap + resultPanelHeight;

  // If total content exceeds viewport height, scale down the grid (not tickets/results) to fit
  const availableViewportH = window.innerHeight - BOTTOM_UI_HEIGHT - TOP_MARGIN - 40;
    if (totalHeight > availableViewportH) {
  const maxGridHeight = Math.max(120, availableViewportH - (resultPanelHeight + gap));
      const scaleY = Math.min(1, Math.max(0.45, maxGridHeight / gridHeight));
      // Preserve any width scaling already applied by using uniform scaling to the smaller
      const currentScale = centerContainer.scale.x;
      const finalScale = Math.min(currentScale, scaleY);
      centerContainer.scale.set(finalScale);
      // Recompute grid dimensions after scaling
      baseGridWidth = centerContainer.width;
        gridWidth = EDGE_TO_EDGE ? deviceW : Math.max(Math.min(deviceW - marginX * 2, baseGridWidth), 320);
      gridHeight = centerContainer.height;
  totalHeight = gridHeight + gap + resultPanelHeight;
      // Rebuild results panel to align to new gridWidth
      buildRightSlots();
    }
    
  // Anchor at top-center: compute tickets fill height to occupy space down to UI
  // No bottom tickets panel in mobile; center panel replaces it. Remove fill height computation.
  mobileTicketsFillHeight = null;

    // Resize renderer to fully contain mobile content to avoid clipping
    // Desired canvas width: full grid width plus small buffer when not edge-to-edge
  // Logical width never exceeds MOBILE_TARGET_WIDTH
  // Enforce global 9:16 aspect ratio in mobile: choose width/height based on viewport
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const aspectWOverH = 9/16;
  // Compute max width that fits within viewport while maintaining 9:16
  const maxWByHeight = Math.floor(vh * aspectWOverH);
  const targetW = Math.min(vw, maxWByHeight);
  const desiredWRaw = EDGE_TO_EDGE ? gridWidth : (gridWidth + 40);
  // Pick the lesser of computed targetW and layout-derived desiredWRaw to avoid over-expansion
  const desiredW = Math.min(desiredWRaw, targetW);
  let desiredH = Math.round(desiredW * (16/9));
    if (desiredW !== w || desiredH !== h) {
      app.renderer.resize(desiredW, desiredH);
      w = desiredW; h = desiredH;
    }
  // Anchor start at top margin, with an extra drop for visual spacing (now 35px)
  const startY = TOP_MARGIN + 35;
    
    // All elements: center inner content horizontally. For edge-to-edge we still center inner content width.
  // Full horizontal centering: use renderer width not grid width so all columns center
  const centerXRaw = (w - gridWidth) / 2;
  const centerX = centerXRaw;
    
    // Position results above grid (using rightContainer)
    // Results centered to gridWidth (buildRightSlots already sizes to gridWidth)
  rightContainer.x = centerXRaw;
    rightContainer.y = startY;

    // Position grid below results
  centerContainer.x = centerXRaw;
    centerContainer.y = startY + resultPanelHeight + gap;

    // Hide legacy bottom tickets panel
    leftContainer.x = 0;
    leftContainer.y = 0;
    leftContainer.visible = false;
    
    console.log('[mobile layout]', {
      centerX,
      resultsY: rightContainer.y,
      gridY: centerContainer.y,
      ticketsY: leftContainer.y,
      gridWidth,
      totalHeight,
      baselineGridWidth,
      baselineGridHeight,
      launchMenuActive
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
  // Width-only scaling: ignore height reduction so taller content does not shrink width.
  cssScale = Math.min(1.3, Math.max(0.5, wScale));
  canvas.style.transformOrigin = 'top center';
  // Center canvas horizontally in viewport (already flex centered root?) fallback ensure
  canvas.style.margin = '0 auto';
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
    const marginX = EDGE_TO_EDGE ? 0 : 20;
    const deviceW = window.innerWidth;
    const baseGridWidth = centerContainer.width || (CARD_SIZE * GRID_COLS + GRID_GAP * (GRID_COLS - 1));
    const gridWidth = EDGE_TO_EDGE ? deviceW : Math.max(Math.min(deviceW - marginX*2, baseGridWidth), 320);
    
    console.log('[buildRightSlots mobile]', { gridWidth, deviceW, edgeToEdge: EDGE_TO_EDGE });
    
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
    
    console.log('[buildRightSlots mobile slots]', { totalSlotsWidth, startX, slotCount, slotWidth, gap });
    
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
if (playHtmlBtn){
  playHtmlBtn.style.display = 'none';
}
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
// Play button removed; initiate rounds elsewhere (e.g., auto after confirmation) so listener stripped.

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
  const instr = new Text('Pick 5 boxes', new TextStyle({ fill:'#ffffff', fontSize:20, fontFamily:'system-ui' })); instr.anchor.set(0.5); instr.x = app.renderer.width/2; instr.y = title.y + 44; bonusContainer.addChild(instr);
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
  let frame=0; const fadeFrames = 80; app.ticker.add(function contentFade(){
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
          of++; const p = 1 - Math.pow(1 - of/odur, 3);
          bonusOverlay!.alpha = startAlpha*(1 - p);
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
    app.ticker.add(function particleTick(){
      f++; const p = f/life;
      star.x += Math.cos(angle)*speed; star.y += Math.sin(angle)*speed*0.85 - 0.04*f;
      star.rotation += spin;
      star.scale.set(1 - p*0.6);
      star.alpha = 0.95*(1-p);
      if (f>=life){ app.ticker.remove(particleTick); star.destroy(); }
    });
  }
}

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
  coin.circle(0,0,12); coin.fill({ color:0xffd54f }); coin.stroke({ color:0x9e7b16, width:3 });
  coin.x = startX; coin.y = startY; coin.alpha = 0; coin.scale.set(0.85);
  app.stage.addChild(coin);
  let f=0; const dur=120; const startDelay = indexInWinners * 18; f = -startDelay;
  app.ticker.add(function coinTick(){
    f++; if (f < 0) return;
    const t = f/dur;
    const ease = t < 0.5 ? 2*t*t : 1 - Math.pow(-2*t+2,2)/2;
    const bx = (1-ease)*(1-ease)*startX + 2*(1-ease)*ease*cpX + ease*ease*endX;
    const by = (1-ease)*(1-ease)*startY + 2*(1-ease)*ease*cpY + ease*ease*endY;
    coin.x = bx; coin.y = by;
    coin.alpha = Math.min(1, t*2);
    coin.rotation += 0.35;
    coin.scale.set(0.85 + 0.18*ease);
    if (f >= dur){
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


// --- Launch Ticket Selection Menu ---
let launchMenuActive = false;
let launchOverlay: Graphics | null = null;
let launchContainer: Container | null = null;
function showLaunchTicketMenu(){
  if (!app || launchMenuActive) return;
  launchMenuActive = true;
  // Reset fixed center width so each new session can recalc based on current viewport
  fixedCenterPanelWidth = null;
  // Capture full gameplay width BEFORE clearing tickets (use renderer width as baseline)
  baselineGameWidth = app.renderer.width;
  if (!lastCenterPanelWidth){ lastCenterPanelWidth = centerTicketsContainer?.width || null; }
  clearTickets();
  // Create dark overlay backdrop (fade in) if not existing
  launchOverlay = new Graphics();
  launchOverlay.rect(0,0,app.renderer.width, app.renderer.height);
  launchOverlay.fill({ color:0x000000, alpha:0.0 });
  launchOverlay.zIndex = 900;
  app.stage.addChild(launchOverlay);
  // Prepare underlying center panel widened BEFORE fade so user sees correct width while menu appears
  buildCenterTicketsPanel();
  layout();
  console.log('[launchMenu] after initial center rebuild width=', centerTicketsContainer?.width, 'rendererW=', app.renderer.width);
  // Fade in overlay then build menu content
  let f=0; const dur=70; app.ticker.add(function lobbyFade(){
    f++; const p = f/dur; const ease = 1 - Math.pow(1 - p, 3);
    if (launchOverlay) launchOverlay.alpha = 0.78 * ease; // target alpha
    if (f>=dur){ app.ticker.remove(lobbyFade); buildLaunchMenuContent(); layout(); }
  });
}

function buildLaunchMenuContent(){
  launchContainer = new Container(); launchContainer.zIndex = 901; launchContainer.alpha = 0; app.stage.addChild(launchContainer);
  // Derive baseline gameplay width
  const gameWidthCandidates = [lastCenterPanelWidth||0, baselineGameWidth||0, app.renderer.width];
  let gameWidth = Math.max(...gameWidthCandidates);
  if (gameWidth === 0) gameWidth = Math.max(360, Math.min(window.innerWidth - 40, 820));
  // Full-width background bar matching gameplay width for visual continuity
  const bg = new Graphics();
  const bgX = (app.renderer.width - gameWidth)/2; // center
  const bgY = 0;
  const bgH = app.renderer.height; // cover full vertical for dim backdrop within game span
  bg.rect(0,0,gameWidth,bgH);
  bg.fill({ color:0x0d1114, alpha:0.86 });
  bg.x = bgX; bg.y = bgY; bg.zIndex = 0;
  launchContainer.addChild(bg);
  // Inner panel (ticket selection UI) centered inside gameplay width
  const panelW = Math.min(640, Math.max(360, Math.floor(gameWidth*0.72)));
  const panelH = 380;
  const panel = new Graphics(); panel.roundRect(0,0,panelW,panelH,22); panel.fill({ color:0x1a2027, alpha:0.95 }); panel.stroke({ color:0x394653, width:3 });
  panel.x = bgX + (gameWidth - panelW)/2; panel.y = (app.renderer.height-panelH)/2;
  launchContainer.addChild(panel);
  console.log('[lobby panels]', { gameWidth, rendererW: app.renderer.width, panelW, bgX, panelX: panel.x });
  const title = new Text('Select Tickets', new TextStyle({ fill:'#ffcc66', fontSize:26, fontWeight:'700', fontFamily:'system-ui' }));
  title.anchor.set(0.5); title.x = panel.x + panelW/2; title.y = panel.y + 28; launchContainer.addChild(title);
  const subtitle = new Text('Choose how many tickets to start with', new TextStyle({ fill:'#cfd8dc', fontSize:16, fontFamily:'system-ui' }));
  subtitle.anchor.set(0.5); subtitle.x = title.x; subtitle.y = title.y + 28; launchContainer.addChild(subtitle);
  // Options
  const options: {label:string; tickets:number}[] = [
    { label: '1 Ticket', tickets: 1 },
    { label: '2 Tickets', tickets: 2 },
    { label: '3 Tickets', tickets: 3 },
    { label: '4 Tickets', tickets: 4 },
    { label: '1 Strip (5 tickets)', tickets: 5 },
    { label: '2 Strips (10 tickets)', tickets: 10 },
  ];
  const cols = 2; const gapX = 16; const gapY = 14; const btnW = (panelW - 40 - gapX)/cols; const btnH = 52;
  const startX = panel.x + 20; const startY = panel.y + 90;
  options.forEach((opt, i)=>{
    const c = i % cols; const r = Math.floor(i/cols);
    const btn = new Graphics(); btn.roundRect(0,0,btnW,btnH,12); btn.fill({ color:0x26313d }); btn.stroke({ color:0x445364, width:2 });
    btn.x = startX + c*(btnW + gapX); btn.y = startY + r*(btnH + gapY);
  const isDisabled = opt.tickets === 10; // disable 2 strips (10 tickets)
  btn.eventMode='static'; btn.cursor = isDisabled ? 'not-allowed' : 'pointer';
  if (isDisabled) { btn.alpha = 0.45; }
    const label = new Text(opt.label, new TextStyle({ fill:'#ffffff', fontSize:16, fontWeight:'600', fontFamily:'system-ui' })); label.anchor.set(0.5); label.x = btnW/2; label.y = btnH/2; btn.addChild(label);
    let hover=false; app.ticker.add(function hoverTick(){ if (btn.destroyed){ app.ticker.remove(hoverTick); return; } const target = hover?1.04:1; btn.scale.x += (target - btn.scale.x)*0.15; btn.scale.y = btn.scale.x; });
    btn.on('pointerover',()=> hover=true); btn.on('pointerout',()=> hover=false);
  if (!isDisabled){ btn.on('pointertap',()=> confirmStakeFor(opt.tickets)); }
    launchContainer!.addChild(btn);
  });
  // Fade in container
  let f=0; const dur=40; app.ticker.add(function contIn(){ f++; const p=f/dur; const ease = 1 - Math.pow(1 - p, 3); launchContainer!.alpha = ease; if (f>=dur){ app.ticker.remove(contIn); } });
}

function confirmStakeFor(ticketCount:number){
  if (!launchContainer) return;
  // Clear previous confirm UI if any
  const prev = launchContainer.children.find(ch => (ch as any).__confirmPanel);
  if (prev) launchContainer.removeChild(prev);
  const stakeEach = getCurrentStake();
  const total = stakeEach * ticketCount;
  const panelW = Math.min(520, Math.max(360, Math.floor(app.renderer.width*0.7)));
  const panelH = 160;
  const panel = new Graphics(); (panel as any).__confirmPanel = true; panel.roundRect(0,0,panelW,panelH,16); panel.fill({ color:0x11161b, alpha:0.96 }); panel.stroke({ color:0x394653, width:3 });
  panel.x = (app.renderer.width-panelW)/2; panel.y = (app.renderer.height-panelH)/2 + 110;
  launchContainer.addChild(panel);
  const msg = new Text(`You are staking ${ticketCount} ticket${ticketCount>1?'s':''} × ${formatStakeValue(stakeEach)} = ${formatStakeValue(total)}`, new TextStyle({ fill:'#ffcc66', fontSize:16, fontFamily:'system-ui' }));
  msg.anchor.set(0.5); msg.x = panel.x + panelW/2; msg.y = panel.y + 40; launchContainer.addChild(msg);
  const btnW = 120, btnH = 40; const gap = 16;
  const makeBtn = (text:string, color:number, onTap:()=>void) => {
    const g = new Graphics(); g.roundRect(0,0,btnW,btnH,10); g.fill({ color }); g.stroke({ color:0x2f3d4b, width:2 }); g.eventMode='static'; g.cursor='pointer';
    const t = new Text(text, new TextStyle({ fill:'#ffffff', fontSize:16, fontWeight:'700', fontFamily:'system-ui' })); t.anchor.set(0.5); t.x = btnW/2; t.y = btnH/2; g.addChild(t);
    g.on('pointertap', onTap);
    return g;
  };
  const confirmBtn = makeBtn('Confirm', 0x2e7d32, ()=> proceedWithTickets(ticketCount));
  const cancelBtn = makeBtn('Cancel', 0xb71c1c, ()=> { launchContainer?.removeChild(panel); });
  const bx = panel.x + (panelW - (btnW*2 + gap))/2;
  const by = panel.y + panelH - btnH - 16;
  confirmBtn.x = bx; confirmBtn.y = by; cancelBtn.x = bx + btnW + gap; cancelBtn.y = by;
  launchContainer.addChild(confirmBtn, cancelBtn);
}

function proceedWithTickets(ticketCount:number){
  const stake = getCurrentStake();
  const availableBase = [...animals];
  for (let tIdx=0; tIdx<ticketCount; tIdx++){
    const ids:number[] = [];
    const pool = [...availableBase];
    while(ids.length < 5 && pool.length){
      const pick = Math.floor(Math.random()*pool.length);
      ids.push(pool[pick].id);
      pool.splice(pick,1);
    }
    const t: Ticket = { id: nextTicketId++, animals: ids, complete:true, stake };
    updateTicketOdds(t);
    tickets.push(t);
  }
  renderTickets(); buildGrid(); layout(); refreshStakeLimitStatus(); updatePlayButtonState(); updateClearButtonState();
  const baseContainers = [leftContainer, centerContainer, rightContainer];
  let outF=0; const outDur=60; app.ticker.add(function fadeOut(){
    outF++; const p = 1 - Math.pow(1 - outF/outDur, 3);
    baseContainers.forEach(c=> c.alpha = p);
    if (outF>=outDur){ app.ticker.remove(fadeOut); }
  });
  if (launchContainer){ let cf=0; const cd=60; app.ticker.add(function contOut(){ cf++; const p = 1 - Math.pow(1 - cf/cd, 3); launchContainer!.alpha = 1 - p; if (cf>=cd){ app.ticker.remove(contOut); launchContainer?.destroy(); launchContainer=null; } }); }
  if (launchOverlay){ let of=0; const od=60; const start = launchOverlay.alpha; app.ticker.add(function overOut(){ of++; const p = 1 - Math.pow(1 - of/od, 3); launchOverlay!.alpha = start*(1 - p); if (of>=od){ app.ticker.remove(overOut); launchOverlay?.destroy(); launchOverlay=null; launchMenuActive=false; } }); }
  // Auto trigger play after fade completes
  setTimeout(()=>{ startAutoRound(); }, 200);
}

// --- Auto Round (base game) ---
function startAutoRound(){
  if (isPlaying) return;
  if (!tickets.length) return;
  isPlaying = true;
  updateRandomButtonState(); updateClearButtonState();
  // Generate 5 random animal draws
  const draws: number[] = [];
  // Ensure results panel exists
  if (resultSlots.length === 0){ buildRightSlots(); }
  // Reveal one-by-one
  const revealDelayMs = 700;
  const showDrawAt = (i:number, id:number)=>{
    const slot = resultSlots[i];
    if (!slot) return;
    slot.removeChildren();
    const slotW = slot.width; const slotH = slot.height;
    const animal = animals.find(a=>a.id===id);
    const emoji = new Text(animal? animal.emoji : '❓', new TextStyle({ fill:'#ffffff', fontSize: Math.min(64, slotH*0.8), fontFamily:'system-ui' }));
    emoji.anchor.set(0.5); emoji.x = slotW/2; emoji.y = slotH/2; emoji.alpha = 0; emoji.scale.set(0.6);
    slot.addChild(emoji);
    let f=0; const dur=24; app.ticker.add(function appear(){ f++; const p=f/dur; const e=1 - Math.pow(1-p,3); emoji.alpha = e; emoji.scale.set(0.6 + 0.4*e); if (f>=dur){ app.ticker.remove(appear); } });
  };
  const stepReveal = (idx:number)=>{
    if (idx >= 5){
      // Finalize round after last reveal
      const winners: Ticket[] = [];
      const totalWin = tickets.reduce((sum,t)=>{
        const w = t.lastWin || 0; if (w>0){ winners.push(t); }
        return sum + w;
      },0);
      if (totalWin > 0){ animateBalanceTo(balance + totalWin); spawnWinPopup(totalWin); }
      // Show total win banner below tickets panel
      showRoundTotalWin(totalWin);
      setTimeout(()=>{
        isPlaying = false;
        updateRandomButtonState(); updateClearButtonState();
        setTimeout(()=>{ showLaunchTicketMenu(); }, 5000);
      }, 600);
      return;
    }
    const pick = animals[Math.floor(Math.random()*animals.length)].id;
    draws.push(pick);
    showDrawAt(idx, pick);
    // Update tickets progressively for UI markers (pos/any) and provisional potential
    tickets.forEach(t=>{
      const partial = draws.map((d, i2)=> i2 <= idx ? d : null);
      const { multiplier, posMatches, anyMatches } = computeTicketWin(t, partial);
      t.posMatches = posMatches; t.anyMatches = anyMatches;
      // Provisional potential win for sorting during reveal
      t.tempPotentialWin = t.stake * multiplier;
      if (idx === 4){ // on final update, set lastWin to real
        t.lastWin = t.tempPotentialWin || 0;
        t.tempPotentialWin = 0;
        if (t.lastWin && t.lastWin>0){ spawnTicketWinParticles(t); }
      }
    });
    // Refresh center to reflect progressive matches/wins
    refreshCenterTickets();
    setTimeout(()=> stepReveal(idx+1), revealDelayMs);
  };
  stepReveal(0);
}

// Display total win below the tickets panel in the center section
let roundTotalWinText: Text | null = null;
function showRoundTotalWin(amount:number){
  // Remove previous banner if any
  if (roundTotalWinText && !roundTotalWinText.destroyed){ roundTotalWinText.parent?.removeChild(roundTotalWinText); roundTotalWinText.destroy(); roundTotalWinText = null; }
  const label = amount > 0 ? `Total Win: ${formatStakeValue(amount)}` : 'No Win';
  const style = new TextStyle({ fill:'#ffcc66', fontSize:24, fontFamily:'system-ui', fontWeight:'700' });
  const txt = new Text(label, style);
  txt.anchor.set(0.5,0);
  // Position centered above the cabinet UI, always visible
  const canvasW = app.renderer.width;
  const yAboveCabinet = Math.max(0, app.renderer.height - BOTTOM_UI_HEIGHT - 36);
  txt.x = canvasW/2;
  txt.y = yAboveCabinet;
  txt.zIndex = 1002;
  app.stage.addChild(txt);
  roundTotalWinText = txt;
}
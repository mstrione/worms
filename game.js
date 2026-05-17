/* Worms-clone con Phaser 3
 * - Canvas a pantalla completa del browser (Scale.RESIZE)
 * - Botón fullscreen + tecla F
 * - 3 tipos de mapa aleatorios: islas / montañas / cavernas
 * - Cámara con zoom (rueda / +-) y seguimiento del gusano activo
 * - Terreno destructible (CanvasTexture + ImageData cacheado)
 * - 2-6 equipos, 2-5 gusanos por equipo
 * - Gusanos con cuerpo segmentado
 */

const WORLD_W = 2800;
const WORLD_H = 1200;
const WATER_Y = 1000;       // nivel del mar
const GRAVITY = 600;
const GROUND_FRICTION = 9;   // fricción en el suelo (1/s) — frena el deslizamiento tras explosiones
const AIR_DRAG = 0.5;        // resistencia del aire (1/s) — leve, no mata los saltos

const TEAM_PRESETS = [
  { name: 'Rojo',    color: 0xff5555 },
  { name: 'Azul',    color: 0x5599ff },
  { name: 'Verde',   color: 0x55cc55 },
  { name: 'Amarillo',color: 0xffd84d },
  { name: 'Violeta', color: 0xb066dd },
  { name: 'Naranja', color: 0xff9933 }
];

const MAP_TYPES = ['islas', 'montañas', 'cavernas', 'ciudad'];
const NUM_TEAMS = 2;
const NUM_WORMS = 3;

// ============================================================
// ConfigScene
// ============================================================
class ConfigScene extends Phaser.Scene {
  constructor() { super('config'); }

  create() {
    const W = this.scale.width, H = this.scale.height;

    const g = this.add.graphics();
    g.fillGradientStyle(0x6ec6ff, 0x6ec6ff, 0xffd9a8, 0xffd9a8, 1);
    g.fillRect(0, 0, W, H);
    const water = this.add.graphics();
    water.fillStyle(0x3a7fb8, 1);
    water.fillRect(0, H - 80, W, 80);

    this.add.text(W / 2, 80, 'WORMS', {
      fontFamily: 'monospace', fontSize: 64, color: '#fff',
      stroke: '#000', strokeThickness: 6
    }).setOrigin(0.5);

    this.add.text(W / 2, 150, 'Configuración de partida', {
      fontFamily: 'monospace', fontSize: 20, color: '#fff',
      stroke: '#000', strokeThickness: 3
    }).setOrigin(0.5);

    this.numTeams = this.registry.get('numTeams') || 2;
    this.numWorms = this.registry.get('numWorms') || 3;

    this.makeCounter(W / 2, 260, 'Equipos', 2, 6, () => this.numTeams, (v) => this.numTeams = v);
    this.makeCounter(W / 2, 360, 'Gusanos por equipo', 2, 5, () => this.numWorms, (v) => this.numWorms = v);

    const btn = this.add.rectangle(W / 2, 480, 260, 64, 0x55aa55)
      .setStrokeStyle(3, 0x000000)
      .setInteractive({ useHandCursor: true });
    this.add.text(W / 2, 480, 'JUGAR', {
      fontFamily: 'monospace', fontSize: 30, color: '#fff',
      stroke: '#000', strokeThickness: 3
    }).setOrigin(0.5);
    btn.on('pointerover', () => btn.setFillStyle(0x66cc66));
    btn.on('pointerout', () => btn.setFillStyle(0x55aa55));
    btn.on('pointerdown', () => this.startGame());

    this.add.text(W / 2, H - 130,
      'El tipo de mapa (islas / montañas / cavernas) se elige al azar.',
      { fontFamily: 'monospace', fontSize: 14, color: '#fff', stroke: '#000', strokeThickness: 2 }
    ).setOrigin(0.5);

    this.input.keyboard.on('keydown-ENTER', () => this.startGame());

    this.scale.on('resize', () => this.scene.restart());
  }

  makeCounter(x, y, label, min, max, getter, setter) {
    this.add.text(x, y - 30, label, {
      fontFamily: 'monospace', fontSize: 18, color: '#fff', stroke: '#000', strokeThickness: 3
    }).setOrigin(0.5);

    const minus = this.add.rectangle(x - 110, y, 44, 44, 0xaa3333).setStrokeStyle(2, 0x000).setInteractive({ useHandCursor: true });
    this.add.text(x - 110, y, '−', { fontFamily: 'monospace', fontSize: 30, color: '#fff' }).setOrigin(0.5);

    const valText = this.add.text(x, y, getter().toString(), {
      fontFamily: 'monospace', fontSize: 34, color: '#fff', stroke: '#000', strokeThickness: 4
    }).setOrigin(0.5);

    const plus = this.add.rectangle(x + 110, y, 44, 44, 0x33aa33).setStrokeStyle(2, 0x000).setInteractive({ useHandCursor: true });
    this.add.text(x + 110, y, '+', { fontFamily: 'monospace', fontSize: 30, color: '#fff' }).setOrigin(0.5);

    minus.on('pointerdown', () => { const v = Math.max(min, getter() - 1); setter(v); valText.setText(v.toString()); });
    plus.on('pointerdown', () => { const v = Math.min(max, getter() + 1); setter(v); valText.setText(v.toString()); });
  }

  startGame() {
    this.registry.set('numTeams', this.numTeams);
    this.registry.set('numWorms', this.numWorms);
    this.scene.start('main');
  }
}

// ============================================================
// MainScene
// ============================================================
class MainScene extends Phaser.Scene {
  constructor() { super('main'); }

  create() {
    this.numTeams = NUM_TEAMS;
    this.numWorms = NUM_WORMS;
    this.mapType = MAP_TYPES[Phaser.Math.Between(0, MAP_TYPES.length - 1)];
    this.manualCamera = false;

    // Fondo sky (canvas texture)
    if (this.textures.exists('sky')) this.textures.remove('sky');
    this.skyTex = this.textures.createCanvas('sky', WORLD_W, WORLD_H);
    this.drawSky();
    this.add.image(WORLD_W / 2, WORLD_H / 2, 'sky');

    this.drawBackMountains();

    // Agua (graphics, animado)
    this.waterGfx = this.add.graphics();
    this.waterPhase = 0;

    // Terreno destructible
    if (this.textures.exists('terrain')) this.textures.remove('terrain');
    this.terrainTex = this.textures.createCanvas('terrain', WORLD_W, WORLD_H);
    this.terrainCtx = this.terrainTex.getContext();
    this.generateTerrain();
    this.terrainImage = this.add.image(WORLD_W / 2, WORLD_H / 2, 'terrain');
    this.refreshTerrainCache();

    // Equipos
    this.teams = [];
    for (let i = 0; i < this.numTeams; i++) {
      this.teams.push({
        name: TEAM_PRESETS[i].name,
        color: TEAM_PRESETS[i].color,
        worms: [],
        eliminated: false
      });
    }
    this.currentTeam = 0;
    this.currentWormIndex = new Array(this.numTeams).fill(0);
    this.projectile = null;
    this.charging = false;
    this.power = 0;
    this.turnEnded = false;
    this.gameOver = false;

    this.spawnAllWorms();

    // Cámara
    const cam = this.cameras.main;
    cam.setBounds(0, 0, WORLD_W, WORLD_H);
    cam.setBackgroundColor('#7ec2ee');
    // arrancar más zoom-out para ver más del mapa
    this.targetZoom = Math.max(this.minZoom() * 1.25, 0.7);
    cam.setZoom(this.targetZoom);
    const first = this.currentWorm();
    if (first) cam.centerOn(first.x, first.y);

    // UI world-space
    this.aimGfx = this.add.graphics();
    this.powerGfx = this.add.graphics();
    this.activeGfx = this.add.graphics().setDepth(800);

    // UI screen-space
    this.hudText = this.add.text(10, 10, '', {
      fontFamily: 'monospace', fontSize: 16, color: '#fff',
      stroke: '#000', strokeThickness: 3
    }).setScrollFactor(0).setDepth(1000);

    this.msgText = this.add.text(this.scale.width / 2, 36, '', {
      fontFamily: 'monospace', fontSize: 22, color: '#ffd84d',
      stroke: '#000', strokeThickness: 4
    }).setOrigin(0.5, 0).setScrollFactor(0).setDepth(1000);

    this.mapTypeText = this.add.text(10, this.scale.height - 24, `Mapa: ${this.mapType}`, {
      fontFamily: 'monospace', fontSize: 14, color: '#fff',
      stroke: '#000', strokeThickness: 3
    }).setScrollFactor(0).setDepth(1000);

    // Botón fullscreen
    this.fsBtn = this.add.text(this.scale.width - 16, 10, '⛶', {
      fontFamily: 'monospace', fontSize: 28, color: '#fff',
      backgroundColor: '#0008', padding: { x: 6, y: 2 }
    }).setOrigin(1, 0).setScrollFactor(0).setDepth(1000).setInteractive({ useHandCursor: true });
    this.fsBtn.on('pointerdown', () => this.toggleFullscreen());

    // Botón nuevo mapa (reinicia con mapa aleatorio)
    this.newBtn = this.add.text(this.scale.width - 16, 50, 'Nuevo mapa', {
      fontFamily: 'monospace', fontSize: 14, color: '#fff',
      backgroundColor: '#0008', padding: { x: 8, y: 4 }
    }).setOrigin(1, 0).setScrollFactor(0).setDepth(1000).setInteractive({ useHandCursor: true });
    this.newBtn.on('pointerdown', () => this.scene.restart());

    // Input
    this.cursors = this.input.keyboard.createCursorKeys();
    this.input.keyboard.on('keydown-SPACE', () => this.startCharging());
    this.input.keyboard.on('keyup-SPACE',   () => this.fire());
    this.input.keyboard.on('keydown-W',     () => this.jumpActive());
    this.input.keyboard.on('keydown-ENTER', () => this.endTurn());
    this.input.keyboard.on('keydown-PLUS',  () => this.zoomBy(1.15));
    this.input.keyboard.on('keydown-MINUS', () => this.zoomBy(1 / 1.15));
    this.input.keyboard.on('keydown-EQUALS',() => this.zoomBy(1.15));
    this.input.keyboard.on('keydown-F',     () => this.toggleFullscreen());
    this.input.keyboard.on('keydown-C',     () => { this.manualCamera = false; });
    this.input.on('wheel', (_p, _o, _dx, dy) => this.zoomBy(dy > 0 ? 1 / 1.12 : 1.12));

    // Paneo manual con click derecho o medio (deshabilita el menú contextual)
    this.input.mouse.disableContextMenu();
    this.panStart = null;
    this.input.on('pointerdown', (p) => {
      if (p.rightButtonDown() || p.button === 1) {
        this.panStart = { px: p.x, py: p.y, sx: this.cameras.main.scrollX, sy: this.cameras.main.scrollY };
      }
    });
    this.input.on('pointermove', (p) => {
      if (!this.panStart) return;
      if (!(p.rightButtonDown() || p.middleButtonDown())) { this.panStart = null; return; }
      const z = this.cameras.main.zoom;
      this.cameras.main.scrollX = this.panStart.sx - (p.x - this.panStart.px) / z;
      this.cameras.main.scrollY = this.panStart.sy - (p.y - this.panStart.py) / z;
      this.manualCamera = true;
    });
    this.input.on('pointerup', () => { this.panStart = null; });

    // Resize
    this.scale.on('resize', (size) => this.onResize(size));

    // Desbloquear audio en primera interacción
    const unlock = () => { this.ensureAudio(); if (this.audioCtx && this.audioCtx.state === 'suspended') this.audioCtx.resume(); };
    this.input.once('pointerdown', unlock);
    this.input.keyboard.once('keydown', unlock);
  }

  // ---------- Audio ----------
  ensureAudio() {
    if (this.audioCtx) return;
    try {
      this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    } catch (e) {}
  }

  playExplosionSound() {
    this.ensureAudio();
    const ctx = this.audioCtx;
    if (!ctx) return;
    if (ctx.state === 'suspended') ctx.resume();
    const dur = 0.7;
    const sr = ctx.sampleRate;
    const buf = ctx.createBuffer(1, sr * dur, sr);
    const data = buf.getChannelData(0);
    // Ruido con decaimiento
    for (let i = 0; i < data.length; i++) {
      const t = i / data.length;
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, 1.8);
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    // Filtro pasa-bajo barrido para dar el "boom" grave
    const filt = ctx.createBiquadFilter();
    filt.type = 'lowpass';
    filt.frequency.setValueAtTime(900, ctx.currentTime);
    filt.frequency.exponentialRampToValueAtTime(60, ctx.currentTime + dur);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(0.8, ctx.currentTime + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
    src.connect(filt); filt.connect(gain); gain.connect(ctx.destination);
    src.start();
    // Sub-bass para "punch"
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(120, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(30, ctx.currentTime + 0.4);
    const oscG = ctx.createGain();
    oscG.gain.setValueAtTime(0.6, ctx.currentTime);
    oscG.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
    osc.connect(oscG); oscG.connect(ctx.destination);
    osc.start(); osc.stop(ctx.currentTime + 0.45);
  }

  // ---------- Muerte / mensajes ----------
  playDeathSound() {
    // Reproduce me-muero.mp3 si existe en la carpeta del proyecto.
    // Si falla la carga (no está el archivo), no hace nada.
    try {
      const a = new Audio('me-muero.mp3');
      a.volume = 0.9;
      a.play().catch(() => {});
    } catch (e) {}
  }

  killWorm(w) {
    if (!w.alive) return;
    w.alive = false;
    w.hp = 0;
    this.playDeathSound();
    // ocultar gráficos del gusano
    this.time.delayedCall(150, () => {
      w.gfx.clear();
      w.label.setVisible(false);
    });
    if (!w.team.eliminated) {
      const stillAlive = w.team.worms.some(ww => ww.alive);
      if (!stillAlive) {
        w.team.eliminated = true;
        this.showEliminatedBanner(w.team);
      }
    }
  }

  showEliminatedBanner(team) {
    const W = this.scale.width;
    const colorHex = '#' + team.color.toString(16).padStart(6, '0');
    const t = this.add.text(W / 2, 100, `¡Equipo ${team.name} eliminado!`, {
      fontFamily: 'monospace', fontSize: 30, color: colorHex,
      stroke: '#000', strokeThickness: 6, fontStyle: 'bold',
      backgroundColor: '#0009', padding: { x: 14, y: 8 }
    }).setOrigin(0.5).setScrollFactor(0).setDepth(2000).setAlpha(0);
    this.tweens.add({
      targets: t, alpha: 1, duration: 200,
      yoyo: false,
      onComplete: () => {
        this.tweens.add({
          targets: t, alpha: 0, y: 80, duration: 800, delay: 2500,
          onComplete: () => t.destroy()
        });
      }
    });
  }

  showWinnerBanner(team) {
    const W = this.scale.width, H = this.scale.height;
    // overlay oscuro
    const bg = this.add.rectangle(W / 2, H / 2, W, H, 0x000000, 0.55)
      .setScrollFactor(0).setDepth(2500);

    if (team) {
      const colorHex = '#' + team.color.toString(16).padStart(6, '0');
      this.add.text(W / 2, H / 2 - 50, '¡GANADOR!', {
        fontFamily: 'monospace', fontSize: 56, color: '#ffd84d',
        stroke: '#000', strokeThickness: 8, fontStyle: 'bold'
      }).setOrigin(0.5).setScrollFactor(0).setDepth(2600);
      this.add.text(W / 2, H / 2 + 20, `Equipo ${team.name}`, {
        fontFamily: 'monospace', fontSize: 42, color: colorHex,
        stroke: '#000', strokeThickness: 6, fontStyle: 'bold'
      }).setOrigin(0.5).setScrollFactor(0).setDepth(2600);
    } else {
      this.add.text(W / 2, H / 2, 'EMPATE', {
        fontFamily: 'monospace', fontSize: 56, color: '#fff',
        stroke: '#000', strokeThickness: 8, fontStyle: 'bold'
      }).setOrigin(0.5).setScrollFactor(0).setDepth(2600);
    }

    const playAgain = this.add.text(W / 2, H / 2 + 100, '[ Jugar de nuevo ]', {
      fontFamily: 'monospace', fontSize: 22, color: '#fff',
      backgroundColor: '#55aa55', padding: { x: 16, y: 8 }
    }).setOrigin(0.5).setScrollFactor(0).setDepth(2600).setInteractive({ useHandCursor: true });
    playAgain.on('pointerdown', () => this.scene.restart());
  }

  toggleFullscreen() {
    if (this.scale.isFullscreen) this.scale.stopFullscreen();
    else this.scale.startFullscreen();
  }

  onResize(size) {
    const cam = this.cameras.main;
    cam.setSize(size.width, size.height);
    // reposicionar UI screen-space
    if (this.msgText) this.msgText.setX(size.width / 2);
    if (this.fsBtn) this.fsBtn.setPosition(size.width - 16, 10);
    if (this.newBtn) this.newBtn.setPosition(size.width - 16, 50);
    if (this.mapTypeText) this.mapTypeText.setY(size.height - 24);
  }

  minZoom() {
    const cam = this.cameras.main;
    return Math.max(cam.width / WORLD_W, cam.height / WORLD_H, 0.35);
  }

  zoomBy(factor) {
    this.targetZoom = Phaser.Math.Clamp(this.targetZoom * factor, this.minZoom(), 2.5);
  }

  // ---------- Cielo ----------
  drawSky() {
    const ctx = this.skyTex.getContext();
    const g = ctx.createLinearGradient(0, 0, 0, WORLD_H);
    g.addColorStop(0, '#7ec2ee');
    g.addColorStop(0.45, '#bfd9e8');
    g.addColorStop(0.75, '#e8d0a8');
    g.addColorStop(1, '#a0c8d8');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, WORLD_W, WORLD_H);

    const sunX = WORLD_W * 0.78, sunY = WORLD_H * 0.18;
    const sg = ctx.createRadialGradient(sunX, sunY, 5, sunX, sunY, 200);
    sg.addColorStop(0, 'rgba(255,245,210,1)');
    sg.addColorStop(0.25, 'rgba(255,225,160,0.85)');
    sg.addColorStop(1, 'rgba(255,200,140,0)');
    ctx.fillStyle = sg;
    ctx.fillRect(0, 0, WORLD_W, WORLD_H);
    ctx.beginPath(); ctx.fillStyle = '#fff5d0';
    ctx.arc(sunX, sunY, 42, 0, Math.PI * 2); ctx.fill();

    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    for (let i = 0; i < 35; i++) {
      const x = Math.random() * WORLD_W;
      const y = Math.random() * WORLD_H * 0.4 + 30;
      const r = 25 + Math.random() * 55;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.arc(x + r * 0.7, y + 4, r * 0.8, 0, Math.PI * 2);
      ctx.arc(x - r * 0.6, y + 6, r * 0.7, 0, Math.PI * 2);
      ctx.fill();
    }
    this.skyTex.refresh();
  }

  drawBackMountains() {
    const g = this.add.graphics();
    g.fillStyle(0x9aaec0, 0.55);
    g.beginPath();
    g.moveTo(0, WATER_Y);
    for (let x = 0; x <= WORLD_W; x += 60) {
      const y = WATER_Y - 80 - Math.abs(Math.sin(x * 0.004)) * 130 - Math.random() * 30;
      g.lineTo(x, y);
    }
    g.lineTo(WORLD_W, WATER_Y); g.lineTo(0, WATER_Y);
    g.closePath(); g.fillPath();

    g.fillStyle(0x6c8499, 0.7);
    g.beginPath();
    g.moveTo(0, WATER_Y);
    for (let x = 0; x <= WORLD_W; x += 60) {
      const y = WATER_Y - 40 - Math.abs(Math.sin(x * 0.006 + 1.5)) * 80 - Math.random() * 25;
      g.lineTo(x, y);
    }
    g.lineTo(WORLD_W, WATER_Y); g.lineTo(0, WATER_Y);
    g.closePath(); g.fillPath();
  }

  // ---------- Terreno ----------
  generateTerrain() {
    const ctx = this.terrainCtx;
    ctx.clearRect(0, 0, WORLD_W, WORLD_H);

    this.spawnZones = []; // dónde se pueden poner gusanos

    if (this.mapType === 'islas')         this.genIslands(ctx);
    else if (this.mapType === 'montañas') this.genMountains(ctx);
    else if (this.mapType === 'cavernas') this.genCaverns(ctx);
    else                                  this.genCity(ctx);

    this.terrainTex.refresh();
  }

  // --- Modo: ISLAS ---
  genIslands(ctx) {
    const numIslands = Phaser.Math.Between(5, 8);
    const margin = 80;
    const usable = WORLD_W - margin * 2;
    const bandW = usable / numIslands;
    const minGap = 100;
    for (let i = 0; i < numIslands; i++) {
      const cx = margin + i * bandW + bandW * 0.5 + (Math.random() - 0.5) * bandW * 0.3;
      const width = Phaser.Math.Between(200, Math.min(440, bandW - minGap));
      const peakHeight = Phaser.Math.Between(100, 220);
      const topY = WATER_Y - Phaser.Math.Between(100, 360);
      const isl = { cx, width, peakHeight, topY };
      this.drawIsland(ctx, isl);
      this.spawnZones.push({ xMin: cx - width * 0.35, xMax: cx + width * 0.35 });
    }
  }

  drawIsland(ctx, isl) {
    const { cx, width, peakHeight, topY } = isl;
    const half = width / 2;
    const leftX = cx - half, rightX = cx + half;
    const topPts = [], botPts = [];
    const steps = 50;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const x = leftX + width * t;
      const bell = Math.sin(t * Math.PI);
      const noise = Math.sin(t * 8 + cx) * 8 + Math.sin(t * 17 + cx * 0.5) * 4;
      const y = topY + (1 - bell) * peakHeight * 0.4 + (peakHeight * 0.1) - bell * 8 + noise;
      topPts.push({ x, y });
    }
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const x = rightX - width * t;
      const bell = Math.sin(t * Math.PI);
      const baseDepth = topY + peakHeight + 50;
      const noise = Math.sin(t * 6 + cx * 0.3) * 14 + Math.sin(t * 14) * 6;
      const y = baseDepth + bell * 40 + noise;
      botPts.push({ x, y });
    }
    this.fillTerrainPath(ctx, [...topPts, ...botPts], topY, topY + peakHeight + 80);
    this.addGrassBand(ctx, topPts);
    this.addNoiseSpecks(ctx, leftX, topY - 5, width, peakHeight + 100);
  }

  // --- Modo: MONTAÑAS ---
  genMountains(ctx) {
    // terreno continuo de izq a der con valles, picos, ondulación
    const topY = [];
    const baseY = WATER_Y - 200;
    // semillas para senos
    const seeds = [
      { f: 0.0018, a: 200, ph: Math.random() * 10 },
      { f: 0.005,  a: 90,  ph: Math.random() * 10 },
      { f: 0.013,  a: 35,  ph: Math.random() * 10 },
      { f: 0.035,  a: 12,  ph: Math.random() * 10 }
    ];
    let minTop = WORLD_H;
    for (let x = 0; x <= WORLD_W; x++) {
      let y = baseY;
      for (const s of seeds) y -= Math.sin(x * s.f + s.ph) * s.a;
      // sumar algo de "ruido" suavizado
      y += Math.sin(x * 0.08) * 3 + Math.sin(x * 0.17 + 1) * 2;
      // no dejar que el techo se vaya muy arriba
      y = Math.max(80, Math.min(WATER_Y - 20, y));
      topY.push(y);
      if (y < minTop) minTop = y;
    }

    this.fillTerrainContinuous(ctx, topY);
    this.addGrassBand(ctx, topY.map((y, x) => ({ x, y })).filter((_, i) => i % 2 === 0));
    this.addNoiseSpecks(ctx, 0, minTop, WORLD_W, WATER_Y - minTop + 80);

    // zonas de spawn: en cualquier x (todo el terreno es accesible)
    const zoneW = 240;
    for (let xStart = 60; xStart < WORLD_W - 60; xStart += zoneW) {
      this.spawnZones.push({ xMin: xStart, xMax: Math.min(WORLD_W - 60, xStart + zoneW) });
    }
  }

  // --- Modo: CAVERNAS ---
  genCaverns(ctx) {
    // Masa sólida que ocupa casi todo el alto, con techo ondulado, luego carvar cuevas
    const topY = [];
    const seeds = [
      { f: 0.003,  a: 120, ph: Math.random() * 10 },
      { f: 0.009,  a: 45,  ph: Math.random() * 10 },
      { f: 0.025,  a: 18,  ph: Math.random() * 10 }
    ];
    const ceiling = 150;
    for (let x = 0; x <= WORLD_W; x++) {
      let y = ceiling + 60;
      for (const s of seeds) y -= Math.sin(x * s.f + s.ph) * s.a;
      y = Math.max(80, Math.min(WATER_Y - 80, y));
      topY.push(y);
    }
    this.fillTerrainContinuous(ctx, topY);
    this.addGrassBand(ctx, topY.map((y, x) => ({ x, y })).filter((_, i) => i % 2 === 0));
    this.addNoiseSpecks(ctx, 0, 100, WORLD_W, WATER_Y);

    // carvar varias cuevas / túneles
    ctx.save();
    ctx.globalCompositeOperation = 'destination-out';
    const numCaves = Phaser.Math.Between(12, 22);
    for (let i = 0; i < numCaves; i++) {
      const cx = Phaser.Math.Between(80, WORLD_W - 80);
      const cy = Phaser.Math.Between(topY[Math.floor(cx)] + 50, WATER_Y - 30);
      const rx = Phaser.Math.Between(60, 180);
      const ry = Phaser.Math.Between(40, 110);
      const rot = Math.random() * Math.PI;
      ctx.save();
      ctx.translate(cx, cy); ctx.rotate(rot);
      ctx.beginPath();
      ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    // túneles horizontales conectando cuevas (líneas gruesas)
    const numTunnels = Phaser.Math.Between(4, 8);
    ctx.lineCap = 'round';
    for (let i = 0; i < numTunnels; i++) {
      const x1 = Phaser.Math.Between(100, WORLD_W - 100);
      const x2 = x1 + Phaser.Math.Between(-300, 300);
      const yLine = Phaser.Math.Between(topY[Math.floor(x1)] + 80, WATER_Y - 40);
      ctx.lineWidth = Phaser.Math.Between(30, 70);
      ctx.strokeStyle = '#000';
      ctx.beginPath();
      ctx.moveTo(x1, yLine);
      ctx.lineTo(x2, yLine + Phaser.Math.Between(-40, 40));
      ctx.stroke();
    }
    ctx.restore();

    // borde quemado/oscurecido en bordes de cuevas
    // (simple: skipear por ahora)

    // zonas de spawn: en la superficie superior
    const zoneW = 260;
    for (let xStart = 80; xStart < WORLD_W - 80; xStart += zoneW) {
      this.spawnZones.push({ xMin: xStart, xMax: Math.min(WORLD_W - 80, xStart + zoneW) });
    }
  }

  // --- Modo: CIUDAD ---
  genCity(ctx) {
    const groundY = WATER_Y - 30;

    // Suelo (tierra/asfalto)
    const grad = ctx.createLinearGradient(0, groundY - 4, 0, WORLD_H);
    grad.addColorStop(0, '#6a6a6a');
    grad.addColorStop(0.1, '#4a4438');
    grad.addColorStop(0.5, '#332a20');
    grad.addColorStop(1, '#1c160e');
    ctx.fillStyle = grad;
    ctx.fillRect(0, groundY, WORLD_W, WORLD_H - groundY);
    // veredas (líneas claras arriba del suelo)
    ctx.fillStyle = '#5a5a5a';
    ctx.fillRect(0, groundY, WORLD_W, 6);

    // Edificios
    let x = 40;
    while (x < WORLD_W - 80) {
      const bw = Phaser.Math.Between(90, 220);
      const bh = Phaser.Math.Between(160, 480);
      const top = groundY - bh;
      const damaged = Math.random() < 0.45;
      this.drawBuilding(ctx, x, top, bw, bh, damaged);
      this.spawnZones.push({ xMin: x + 12, xMax: x + bw - 12 });
      x += bw + Phaser.Math.Between(18, 70);
    }

    // Suelo también es zona de spawn (entre edificios)
    this.spawnZones.push({ xMin: 60, xMax: WORLD_W - 60 });
  }

  drawBuilding(ctx, bx, by, bw, bh, damaged) {
    const palettes = [
      { base: '#7a6a5a', shade: '#5a4a3a', winLit: '#e8c47e', winOff: '#2c2f44' },
      { base: '#8a7c6c', shade: '#5d4f40', winLit: '#a8c7e0', winOff: '#252a3a' },
      { base: '#6e6a64', shade: '#46423c', winLit: '#e8b270', winOff: '#28252e' },
      { base: '#9c8a7a', shade: '#6a5a4a', winLit: '#bcd9ef', winOff: '#2a3040' },
      { base: '#5a5550', shade: '#3a3530', winLit: '#e8b97a', winOff: '#1f1d28' }
    ];
    const pal = palettes[Phaser.Math.Between(0, palettes.length - 1)];

    // base (opaca)
    ctx.fillStyle = pal.base;
    ctx.fillRect(bx, by, bw, bh);
    // sombra vertical en un lado
    const shadeW = Math.min(18, bw * 0.18);
    ctx.fillStyle = pal.shade;
    ctx.fillRect(bx + bw - shadeW, by, shadeW, bh);
    // banda superior (cornisa)
    ctx.fillStyle = pal.shade;
    ctx.fillRect(bx, by, bw, 6);

    // ventanas en filas (colores opacos, sin marcos translúcidos)
    const winW = 12, winH = 16, gapX = 8, gapY = 10;
    const cols = Math.floor((bw - 16) / (winW + gapX));
    const startX = bx + (bw - (cols * (winW + gapX) - gapX)) / 2;
    for (let wy = by + 16; wy + winH < by + bh - 10; wy += winH + gapY) {
      for (let c = 0; c < cols; c++) {
        if (Math.random() < 0.18) continue;
        const wx = startX + c * (winW + gapX);
        const lit = Math.random() < 0.5;
        ctx.fillStyle = lit ? pal.winLit : pal.winOff;
        ctx.fillRect(wx, wy, winW, winH);
      }
    }

    // techo dañado (jaggies)
    if (damaged) {
      ctx.save();
      ctx.globalCompositeOperation = 'destination-out';
      ctx.beginPath();
      ctx.moveTo(bx - 2, by - 2);
      let cx = bx;
      while (cx < bx + bw) {
        const step = Phaser.Math.Between(6, 22);
        const dy = Phaser.Math.Between(0, Math.min(80, bh * 0.25));
        ctx.lineTo(cx, by + dy);
        cx += step;
      }
      ctx.lineTo(bx + bw + 2, by - 2);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  }

  // Pinta un path cerrado con gradiente de tierra
  fillTerrainPath(ctx, points, topY, bottomY) {
    const grad = ctx.createLinearGradient(0, topY - 10, 0, bottomY);
    grad.addColorStop(0, '#7fbe2a');
    grad.addColorStop(0.06, '#5a8a2a');
    grad.addColorStop(0.14, '#7a5530');
    grad.addColorStop(0.4, '#5a3a20');
    grad.addColorStop(1, '#2e1c12');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (const p of points) ctx.lineTo(p.x, p.y);
    ctx.closePath();
    ctx.fill();
  }

  // Para montañas/cavernas: terreno continuo desde top hasta el fondo
  fillTerrainContinuous(ctx, topY) {
    const minTop = Math.min(...topY);
    const grad = ctx.createLinearGradient(0, minTop - 10, 0, WORLD_H);
    grad.addColorStop(0, '#7fbe2a');
    grad.addColorStop(0.05, '#5a8a2a');
    grad.addColorStop(0.12, '#7a5530');
    grad.addColorStop(0.4, '#5a3a20');
    grad.addColorStop(1, '#2e1c12');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(0, WORLD_H);
    for (let x = 0; x < topY.length; x++) ctx.lineTo(x, topY[x]);
    ctx.lineTo(WORLD_W, WORLD_H);
    ctx.closePath();
    ctx.fill();
  }

  addGrassBand(ctx, points) {
    ctx.save();
    ctx.globalCompositeOperation = 'source-atop';
    ctx.fillStyle = '#5fa82a';
    for (const p of points) ctx.fillRect(p.x, p.y, 1, 6);
    ctx.fillStyle = '#9be84a';
    for (const p of points) ctx.fillRect(p.x, p.y, 1, 2);
    ctx.strokeStyle = '#9be84a';
    ctx.lineWidth = 1;
    for (let i = 0; i < points.length; i += 4) {
      const p = points[i];
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(p.x + (Math.random() - 0.5) * 3, p.y - 3 - Math.random() * 3);
      ctx.stroke();
    }
    ctx.restore();
  }

  addNoiseSpecks(ctx, x0, y0, w, h) {
    ctx.save();
    ctx.globalCompositeOperation = 'source-atop';
    const dots = Math.floor(w * h / 60);
    for (let i = 0; i < dots; i++) {
      const x = x0 + Math.random() * w;
      const y = y0 + Math.random() * h;
      ctx.fillStyle = `rgba(0,0,0,${Math.random() * 0.18})`;
      ctx.fillRect(x, y, 2, 2);
    }
    for (let i = 0; i < dots / 4; i++) {
      const x = x0 + Math.random() * w;
      const y = y0 + Math.random() * h;
      ctx.fillStyle = `rgba(255,230,180,${Math.random() * 0.2})`;
      ctx.fillRect(x, y, 1 + Math.random() * 2, 1 + Math.random() * 2);
    }
    ctx.restore();
  }

  refreshTerrainCache() {
    const img = this.terrainCtx.getImageData(0, 0, WORLD_W, WORLD_H);
    this.terrainData = img.data;
  }

  refreshTerrainCacheBBox(x0, y0, x1, y1) {
    x0 = Math.max(0, x0 | 0); y0 = Math.max(0, y0 | 0);
    x1 = Math.min(WORLD_W, x1 | 0); y1 = Math.min(WORLD_H, y1 | 0);
    if (x1 <= x0 || y1 <= y0) return;
    const w = x1 - x0, h = y1 - y0;
    const img = this.terrainCtx.getImageData(x0, y0, w, h);
    const src = img.data;
    const dst = this.terrainData;
    for (let row = 0; row < h; row++) {
      const dstOff = ((y0 + row) * WORLD_W + x0) * 4;
      const srcOff = row * w * 4;
      for (let col = 0; col < w; col++) {
        dst[dstOff + col * 4 + 3] = src[srcOff + col * 4 + 3];
      }
    }
  }

  isSolid(x, y) {
    x = x | 0; y = y | 0;
    if (x < 0 || x >= WORLD_W) return true;
    if (y < 0) return false;
    if (y >= WORLD_H) return true;
    return this.terrainData[(y * WORLD_W + x) * 4 + 3] > 10;
  }

  surfaceY(x, fromY = 0) {
    for (let y = fromY; y < WATER_Y; y++) if (this.isSolid(x, y)) return y;
    return -1;
  }

  carveCrater(cx, cy, radius) {
    const ctx = this.terrainCtx;
    ctx.save();
    ctx.globalCompositeOperation = 'destination-out';
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.globalCompositeOperation = 'source-atop';
    const burn = ctx.createRadialGradient(cx, cy, radius - 2, cx, cy, radius + 14);
    burn.addColorStop(0, 'rgba(20,10,5,0.9)');
    burn.addColorStop(0.5, 'rgba(60,30,15,0.55)');
    burn.addColorStop(1, 'rgba(60,30,15,0)');
    ctx.fillStyle = burn;
    ctx.beginPath();
    ctx.arc(cx, cy, radius + 14, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    this.terrainTex.refresh();
    this.refreshTerrainCacheBBox(cx - radius - 16, cy - radius - 16, cx + radius + 16, cy + radius + 16);
  }

  // ---------- Gusanos ----------
  spawnAllWorms() {
    const total = this.numTeams * this.numWorms;
    const positions = [];
    let tries = 0;
    while (positions.length < total && tries < 6000) {
      tries++;
      const zone = this.spawnZones[Phaser.Math.Between(0, this.spawnZones.length - 1)];
      const x = Phaser.Math.Between(zone.xMin, zone.xMax);
      const y = this.surfaceY(x);
      if (y < 0 || y > WATER_Y - 20) continue;
      let close = false;
      for (const p of positions) {
        if (Math.abs(p.x - x) < 50) { close = true; break; }
      }
      if (close) continue;
      positions.push({ x, y });
    }
    Phaser.Utils.Array.Shuffle(positions);
    let pi = 0;
    for (let wi = 0; wi < this.numWorms; wi++) {
      for (let ti = 0; ti < this.numTeams; ti++) {
        if (pi >= positions.length) break;
        const p = positions[pi++];
        this.spawnWorm(this.teams[ti], p.x, p.y - 12);
      }
    }
  }

  spawnWorm(team, x, y) {
    const g = this.add.graphics();
    const worm = {
      team, x, y, vx: 0, vy: 0,
      onGround: false, hp: 100, facing: 1,
      angle: -Math.PI / 4,
      gfx: g,
      label: this.add.text(0, 0, '', {
        fontFamily: 'monospace', fontSize: 11, color: '#fff',
        stroke: '#000', strokeThickness: 3
      }).setOrigin(0.5, 1),
      alive: true
    };
    team.worms.push(worm);
    this.drawWorm(worm);
    return worm;
  }

  drawWorm(w) {
    const g = w.gfx;
    g.clear();
    if (!w.alive) return;
    const x = w.x, y = w.y, f = w.facing;

    g.fillStyle(0x000000, 0.3);
    g.fillEllipse(x, y + 11, 26, 4);

    const segs = [
      { dx: -14 * f, dy: 2,  r: 5 },
      { dx: -7  * f, dy: 0,  r: 7 },
      { dx: 0,       dy: -1, r: 8 },
      { dx: 7  * f,  dy: -2, r: 9 }
    ];
    g.fillStyle(0xf2b890, 1);
    for (const s of segs) g.fillEllipse(x + s.dx, y + s.dy, s.r * 2, s.r * 2);
    g.fillStyle(0xd49775, 0.7);
    for (const s of segs) g.fillEllipse(x + s.dx, y + s.dy + s.r * 0.55, s.r * 1.6, s.r * 0.8);
    g.fillStyle(0xffd9b3, 0.6);
    for (const s of segs) g.fillEllipse(x + s.dx, y + s.dy - s.r * 0.4, s.r * 1.3, s.r * 0.5);

    const head = segs[3];
    const hx = x + head.dx, hy = y + head.dy;
    g.fillStyle(w.team.color, 1);
    g.fillRect(hx - 9, hy - 2, 18, 4);

    g.fillStyle(0xffffff, 1);
    g.fillCircle(hx + f * 2, hy + 1, 2.5);
    g.fillCircle(hx + f * 6, hy + 1, 2.5);
    g.fillStyle(0x000000, 1);
    g.fillCircle(hx + f * 2 + f * 0.8, hy + 1, 1.2);
    g.fillCircle(hx + f * 6 + f * 0.8, hy + 1, 1.2);

    g.lineStyle(1.2, 0x6a3020, 1);
    g.beginPath();
    g.arc(hx + f * 4, hy + 5, 2.5, 0, Math.PI, false);
    g.strokePath();

    const barW = 32, barH = 4;
    const bx = x - barW / 2, by = y - 22;
    g.fillStyle(0x000000, 0.6);
    g.fillRect(bx - 1, by - 1, barW + 2, barH + 2);
    const hpFrac = Math.max(0, w.hp / 100);
    const hpColor = hpFrac > 0.5 ? 0x55dd55 : hpFrac > 0.25 ? 0xddbb33 : 0xdd3333;
    g.fillStyle(hpColor, 1);
    g.fillRect(bx, by, barW * hpFrac, barH);

    w.label.setText(`${w.team.name} ${w.hp}`);
    w.label.setPosition(x, y - 26);
    w.label.setColor(Phaser.Display.Color.IntegerToColor(w.team.color).rgba);
  }

  currentWorm() {
    const team = this.teams[this.currentTeam];
    if (!team) return null;
    return team.worms[this.currentWormIndex[this.currentTeam]];
  }

  // ---------- Turnos ----------
  endTurn() {
    if (this.projectile || this.charging || this.gameOver) return;
    for (let tries = 0; tries < this.teams.length; tries++) {
      this.currentTeam = (this.currentTeam + 1) % this.teams.length;
      const t = this.teams[this.currentTeam];
      const alive = t.worms.filter(w => w.alive);
      if (alive.length === 0) continue;
      let idx = this.currentWormIndex[this.currentTeam];
      for (let i = 0; i < t.worms.length; i++) {
        idx = (idx + 1) % t.worms.length;
        if (t.worms[idx].alive) break;
      }
      this.currentWormIndex[this.currentTeam] = idx;
      break;
    }
    this.turnEnded = false;
    this.power = 0;
    this.charging = false;
    this.manualCamera = false;
    this.checkVictory();
  }

  checkVictory() {
    if (this.gameOver) return;
    const aliveTeams = this.teams.filter(t => t.worms.some(w => w.alive));
    if (aliveTeams.length <= 1) {
      this.gameOver = true;
      const winner = aliveTeams[0];
      // dar un respiro para que se vea el "ME MUERO" final
      this.time.delayedCall(900, () => this.showWinnerBanner(winner));
    }
  }

  startCharging() {
    if (this.gameOver || this.projectile || this.turnEnded) return;
    const w = this.currentWorm();
    if (!w || !w.onGround) return;
    this.charging = true;
    this.power = 0;
  }

  fire() {
    if (!this.charging) return;
    this.charging = false;
    const w = this.currentWorm();
    if (!w) return;
    const speed = 200 + this.power * 6;
    const vx = Math.cos(w.angle) * w.facing * speed;
    const vy = Math.sin(w.angle) * speed;
    this.projectile = {
      x: w.x + w.facing * 16,
      y: w.y - 4,
      vx, vy,
      gfx: this.add.graphics(),
      trail: []
    };
    this.power = 0;
    this.turnEnded = true;
  }

  jumpActive() {
    if (this.gameOver || this.projectile || this.charging || this.turnEnded) return;
    const w = this.currentWorm();
    if (w && w.onGround) {
      w.vy = -260;
      w.vx = w.facing * 120;
      w.onGround = false;
    }
  }

  update(_, dtMs) {
    const dt = Math.min(dtMs, 33) / 1000;
    this.waterPhase += dt;

    const active = this.currentWorm();
    if (active && active.alive && !this.projectile && !this.gameOver && !this.turnEnded) {
      if (active.onGround) {
        if (this.cursors.left.isDown)  { active.vx = -90; active.facing = -1; }
        else if (this.cursors.right.isDown) { active.vx = 90; active.facing = 1; }
        else active.vx = 0;
      }
      if (this.cursors.up.isDown)   active.angle -= 1.5 * dt;
      if (this.cursors.down.isDown) active.angle += 1.5 * dt;
      active.angle = Phaser.Math.Clamp(active.angle, -Math.PI / 2, 0);
      if (this.charging) this.power = Math.min(100, this.power + 80 * dt);
    }

    for (const team of this.teams) {
      for (const w of team.worms) {
        if (!w.alive) continue;
        this.simulateWorm(w, dt);
        this.drawWorm(w);
      }
    }

    if (this.projectile) this.simulateProjectile(dt);

    this.aimGfx.clear();
    this.powerGfx.clear();
    this.activeGfx.clear();

    // Indicador del gusano activo: flecha que rebota arriba + halo pulsante
    if (active && active.alive && !this.gameOver) {
      const bob = Math.sin(this.time.now * 0.006) * 5;
      const arrowY = active.y - 44 + bob;
      const cx = active.x;
      const color = active.team.color;
      // halo pulsante
      const pulse = 0.55 + Math.sin(this.time.now * 0.008) * 0.25;
      this.activeGfx.lineStyle(2, color, pulse);
      this.activeGfx.strokeCircle(cx, active.y + 2, 18);
      this.activeGfx.lineStyle(1, color, pulse * 0.5);
      this.activeGfx.strokeCircle(cx, active.y + 2, 24);
      // flecha apuntando hacia abajo (al gusano)
      this.activeGfx.fillStyle(color, 1);
      this.activeGfx.beginPath();
      this.activeGfx.moveTo(cx, arrowY + 14);
      this.activeGfx.lineTo(cx - 10, arrowY);
      this.activeGfx.lineTo(cx - 4, arrowY);
      this.activeGfx.lineTo(cx - 4, arrowY - 14);
      this.activeGfx.lineTo(cx + 4, arrowY - 14);
      this.activeGfx.lineTo(cx + 4, arrowY);
      this.activeGfx.lineTo(cx + 10, arrowY);
      this.activeGfx.closePath();
      this.activeGfx.fillPath();
      this.activeGfx.lineStyle(2, 0x000000, 0.9);
      this.activeGfx.strokePath();
    }

    if (active && active.alive && !this.projectile && !this.gameOver && !this.turnEnded) {
      const ax = active.x + Math.cos(active.angle) * active.facing * 32;
      const ay = active.y + Math.sin(active.angle) * 32;
      this.aimGfx.lineStyle(2, 0xffff66, 1);
      this.aimGfx.lineBetween(active.x, active.y, ax, ay);
      this.aimGfx.fillStyle(0xffff66, 1);
      this.aimGfx.fillCircle(ax, ay, 3);
      if (this.charging || this.power > 0) {
        const barW = 80, barH = 8;
        const bx = active.x - barW / 2, by = active.y - 32;
        this.powerGfx.fillStyle(0x222222, 0.8);
        this.powerGfx.fillRect(bx, by, barW, barH);
        this.powerGfx.fillStyle(0xff7733, 1);
        this.powerGfx.fillRect(bx, by, barW * (this.power / 100), barH);
      }
    }

    this.updateCamera(dt);
    this.drawWater();

    const team = this.teams[this.currentTeam];
    const counts = this.teams.map(t => `${t.name}:${t.worms.filter(w => w.alive).length}`).join('  ');
    this.hudText.setText(
      `Turno: ${team ? team.name : '-'}   ${counts}` +
      (active && active.alive ? `   HP:${active.hp}  ang:${(active.angle * 180 / Math.PI).toFixed(0)}°` : '') +
      (this.turnEnded ? '   [Enter: siguiente]' : '') +
      `   Zoom:${this.cameras.main.zoom.toFixed(2)}x`
    );
  }

  updateCamera(dt) {
    const cam = this.cameras.main;
    const mz = this.minZoom();
    if (this.targetZoom < mz) this.targetZoom = mz;
    cam.setZoom(Phaser.Math.Linear(cam.zoom, this.targetZoom, Math.min(1, dt * 6)));

    // si el proyectil vuela, siempre lo seguimos (el manual pan se cancela)
    if (this.projectile) {
      this.manualCamera = false;
      const desiredSX = this.projectile.x - cam.width / cam.zoom / 2;
      const desiredSY = this.projectile.y - cam.height / cam.zoom / 2;
      cam.scrollX = Phaser.Math.Linear(cam.scrollX, desiredSX, Math.min(1, dt * 4));
      cam.scrollY = Phaser.Math.Linear(cam.scrollY, desiredSY, Math.min(1, dt * 4));
      return;
    }
    if (this.manualCamera) return;

    const a = this.currentWorm();
    if (a && a.alive) {
      const desiredSX = a.x - cam.width / cam.zoom / 2;
      const desiredSY = a.y - cam.height / cam.zoom / 2;
      cam.scrollX = Phaser.Math.Linear(cam.scrollX, desiredSX, Math.min(1, dt * 3));
      cam.scrollY = Phaser.Math.Linear(cam.scrollY, desiredSY, Math.min(1, dt * 3));
    }
  }

  drawWater() {
    const g = this.waterGfx;
    g.clear();
    g.fillStyle(0x2f6b9c, 0.85);
    g.fillRect(0, WATER_Y, WORLD_W, WORLD_H - WATER_Y);
    g.fillStyle(0x1f4a6c, 0.6);
    g.fillRect(0, WATER_Y + 30, WORLD_W, WORLD_H - WATER_Y - 30);
    g.fillStyle(0x6db4dd, 0.9);
    const amp = 4;
    for (let x = 0; x < WORLD_W; x += 6) {
      const y = WATER_Y + Math.sin(x * 0.04 + this.waterPhase * 2) * amp + Math.sin(x * 0.09 + this.waterPhase * 3) * 2;
      g.fillRect(x, y, 6, 3);
    }
    g.fillStyle(0xffffff, 0.15);
    for (let x = 0; x < WORLD_W; x += 30) {
      const y = WATER_Y + 8 + Math.sin(x * 0.02 + this.waterPhase) * 3;
      g.fillRect(x, y, 14, 1);
    }
  }

  simulateWorm(w, dt) {
    w.vy += GRAVITY * dt;
    const drag = w.onGround ? GROUND_FRICTION : AIR_DRAG;
    w.vx -= w.vx * Math.min(1, drag * dt);
    if (Math.abs(w.vx) < 3) w.vx = 0;
    const steps = 4;
    const sx = (w.vx * dt) / steps;
    const sy = (w.vy * dt) / steps;
    for (let i = 0; i < steps; i++) {
      const nx = w.x + sx;
      if (!this.collidesWorm(nx, w.y)) {
        w.x = nx;
      } else {
        let climbed = false;
        for (let up = 1; up <= 6; up++) {
          if (!this.collidesWorm(nx, w.y - up)) {
            w.x = nx; w.y -= up; climbed = true; break;
          }
        }
        if (!climbed) w.vx = 0;
      }
      const ny = w.y + sy;
      if (!this.collidesWorm(w.x, ny)) {
        w.y = ny;
        w.onGround = false;
      } else {
        if (sy > 0) {
          while (!this.collidesWorm(w.x, w.y + 1)) w.y += 1;
          w.onGround = true;
        }
        w.vy = 0;
      }
    }
    if (w.x < 10) w.x = 10;
    if (w.x > WORLD_W - 10) w.x = WORLD_W - 10;
    if (w.y > WATER_Y - 4) {
      this.splash(w.x, WATER_Y);
      this.killWorm(w);
      this.checkVictory();
    }
  }

  collidesWorm(x, y) {
    const r = 11;
    return (
      this.isSolid(x, y + r) ||
      this.isSolid(x - r + 2, y + r - 2) ||
      this.isSolid(x + r - 2, y + r - 2) ||
      this.isSolid(x, y - r + 2)
    );
  }

  simulateProjectile(dt) {
    const p = this.projectile;
    p.vy += GRAVITY * dt;
    const steps = 6;
    const sx = (p.vx * dt) / steps;
    const sy = (p.vy * dt) / steps;
    for (let i = 0; i < steps; i++) {
      p.x += sx; p.y += sy;
      if (p.x < 0 || p.x > WORLD_W) { this.destroyProjectile(); return; }
      if (p.y > WATER_Y) {
        this.splash(p.x, WATER_Y);
        this.destroyProjectile();
        return;
      }
      if (this.isSolid(p.x, p.y)) {
        this.explode(p.x, p.y, 40);
        this.destroyProjectile();
        return;
      }
      const hit = this.findWormHit(p.x, p.y);
      if (hit) {
        this.explode(p.x, p.y, 44);
        this.destroyProjectile();
        return;
      }
    }
    p.trail.push({ x: p.x, y: p.y });
    if (p.trail.length > 20) p.trail.shift();

    p.gfx.clear();
    for (let i = 1; i < p.trail.length; i++) {
      const a = i / p.trail.length;
      p.gfx.lineStyle(2 + a * 2, 0xffaa55, a * 0.7);
      p.gfx.lineBetween(p.trail[i - 1].x, p.trail[i - 1].y, p.trail[i].x, p.trail[i].y);
    }
    p.gfx.fillStyle(0x222222, 1);
    p.gfx.fillCircle(p.x, p.y, 5);
    p.gfx.fillStyle(0xffaa33, 1);
    p.gfx.fillCircle(p.x - p.vx * 0.005, p.y - p.vy * 0.005, 2);

    if (Math.random() < 0.7) {
      const s = this.add.circle(p.x, p.y, 3 + Math.random() * 2, 0x888888, 0.5);
      this.tweens.add({ targets: s, alpha: 0, scale: 2.2, duration: 500, onComplete: () => s.destroy() });
    }
  }

  findWormHit(x, y) {
    const shooter = this.currentWorm();
    for (const team of this.teams) {
      for (const w of team.worms) {
        if (!w.alive || w === shooter) continue;
        const dx = w.x - x, dy = w.y - y;
        if (dx * dx + dy * dy < 14 * 14) return w;
      }
    }
    return null;
  }

  destroyProjectile() {
    if (!this.projectile) return;
    this.projectile.gfx.destroy();
    this.projectile = null;
  }

  splash(x, y) {
    for (let i = 0; i < 14; i++) {
      const ang = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 0.9;
      const spd = 80 + Math.random() * 160;
      const p = this.add.circle(x, y, 2 + Math.random() * 2, 0xaaddee, 1);
      const tx = x + Math.cos(ang) * spd * 0.5;
      const ty = y + Math.sin(ang) * spd * 0.5;
      this.tweens.add({ targets: p, x: tx, y: ty, alpha: 0, duration: 600 + Math.random() * 300, onComplete: () => p.destroy() });
    }
    this.cameras.main.shake(150, 0.006);
  }

  explode(cx, cy, radius) {
    this.carveCrater(cx, cy, radius);
    this.playExplosionSound();
    this.cameras.main.shake(250, 0.012);
    const flash = this.add.circle(cx, cy, radius * 0.9, 0xffeeaa, 0.95);
    this.tweens.add({ targets: flash, alpha: 0, scale: 1.8, duration: 380, onComplete: () => flash.destroy() });
    const ring = this.add.circle(cx, cy, radius * 0.5, 0xff7a22, 0.7);
    this.tweens.add({ targets: ring, alpha: 0, scale: 3, duration: 500, onComplete: () => ring.destroy() });
    for (let i = 0; i < 22; i++) {
      const ang = Math.random() * Math.PI * 2;
      const spd = 80 + Math.random() * 220;
      const isSpark = Math.random() < 0.5;
      const p = this.add.circle(cx, cy, isSpark ? 2 : 3, isSpark ? 0xffe27a : 0x6a4628, 1);
      const tx = cx + Math.cos(ang) * spd * 0.6;
      const ty = cy + Math.sin(ang) * spd * 0.6 - 40;
      this.tweens.add({ targets: p, x: tx, y: ty, alpha: 0, duration: 500 + Math.random() * 400, ease: 'Cubic.Out', onComplete: () => p.destroy() });
    }
    for (let i = 0; i < 6; i++) {
      const s = this.add.circle(cx + (Math.random() - 0.5) * 10, cy - 4 - i * 2, 8 + Math.random() * 6, 0x444444, 0.55);
      this.tweens.add({ targets: s, y: s.y - 60 - Math.random() * 30, alpha: 0, scale: 2.4, duration: 900 + Math.random() * 400, onComplete: () => s.destroy() });
    }
    for (const team of this.teams) {
      for (const w of team.worms) {
        if (!w.alive) continue;
        const dx = w.x - cx, dy = w.y - cy;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < radius + 14) {
          const dmg = Math.round(45 * (1 - dist / (radius + 14)));
          w.hp -= dmg;
          const force = 280 * (1 - dist / (radius + 14));
          const ang = Math.atan2(dy, dx);
          w.vx += Math.cos(ang) * force;
          w.vy += Math.sin(ang) * force - 80;
          w.onGround = false;
          if (w.hp <= 0) this.killWorm(w);
        }
      }
    }
    this.checkVictory();
  }
}

new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  backgroundColor: '#7ec2ee',
  scale: {
    mode: Phaser.Scale.RESIZE,
    parent: 'game',
    width: '100%',
    height: '100%'
  },
  scene: [MainScene]
});

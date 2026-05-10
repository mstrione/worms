/* Worms-clone MVP con Phaser 3
 * Terreno destructible basado en una máscara de píxeles (CanvasTexture).
 * Colisiones gusano/terreno y proyectil/terreno por consulta de píxel alpha.
 */

const WIDTH = 1000;
const HEIGHT = 600;
const GRAVITY = 600;
const WIND = 0; // se podría randomizar por turno

class MainScene extends Phaser.Scene {
  constructor() { super('main'); }

  create() {
    // Cielo con gradiente, sol y nubes (textura)
    this.skyTex = this.textures.createCanvas('sky', WIDTH, HEIGHT);
    this.drawSky();
    this.add.image(WIDTH / 2, HEIGHT / 2, 'sky');

    // Montañas de fondo (parallax estático)
    this.drawBackMountains();

    // Terreno: textura de canvas que podemos editar (destruir) en runtime
    this.terrainTex = this.textures.createCanvas('terrain', WIDTH, HEIGHT);
    this.terrainCtx = this.terrainTex.getContext();
    this.generateTerrain();
    this.terrainImage = this.add.image(WIDTH / 2, HEIGHT / 2, 'terrain');

    // Estado del juego
    this.teams = [
      { name: 'Rojo',  color: 0xff5555, worms: [] },
      { name: 'Azul', color: 0x5599ff, worms: [] }
    ];
    this.currentTeam = 0;
    this.currentWormIndex = [0, 0];
    this.projectile = null;
    this.charging = false;
    this.power = 0;
    this.turnEnded = false;

    // Crear gusanos
    this.spawnWorm(this.teams[0], 150);
    this.spawnWorm(this.teams[0], 280);
    this.spawnWorm(this.teams[1], 720);
    this.spawnWorm(this.teams[1], 850);

    // Indicador de apuntado
    this.aimGfx = this.add.graphics();
    this.powerGfx = this.add.graphics();

    // Texto HUD
    this.hudText = this.add.text(10, 10, '', { fontFamily: 'monospace', fontSize: 16, color: '#fff' });
    this.msgText = this.add.text(WIDTH / 2, 30, '', {
      fontFamily: 'monospace', fontSize: 18, color: '#ffd84d'
    }).setOrigin(0.5, 0);

    // Input
    this.cursors = this.input.keyboard.createCursorKeys();
    this.keys = this.input.keyboard.addKeys({
      space: Phaser.Input.Keyboard.KeyCodes.SPACE,
      jump:  Phaser.Input.Keyboard.KeyCodes.W,
      end:   Phaser.Input.Keyboard.KeyCodes.ENTER
    });

    this.input.keyboard.on('keydown-SPACE', () => this.startCharging());
    this.input.keyboard.on('keyup-SPACE',   () => this.fire());
    this.input.keyboard.on('keydown-W',     () => this.jumpActive());
    this.input.keyboard.on('keydown-ENTER', () => this.endTurn());
  }

  // ---------- Cielo y fondo ----------

  drawSky() {
    const ctx = this.skyTex.getContext();
    const g = ctx.createLinearGradient(0, 0, 0, HEIGHT);
    g.addColorStop(0, '#ffd9a8');
    g.addColorStop(0.35, '#ffb37a');
    g.addColorStop(0.65, '#f08a6a');
    g.addColorStop(1, '#7c5a8a');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);

    // Sol
    const sunX = WIDTH * 0.78, sunY = HEIGHT * 0.22;
    const sg = ctx.createRadialGradient(sunX, sunY, 5, sunX, sunY, 140);
    sg.addColorStop(0, 'rgba(255,245,210,1)');
    sg.addColorStop(0.2, 'rgba(255,225,160,0.9)');
    sg.addColorStop(1, 'rgba(255,200,140,0)');
    ctx.fillStyle = sg;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
    ctx.beginPath();
    ctx.fillStyle = '#fff5d0';
    ctx.arc(sunX, sunY, 32, 0, Math.PI * 2);
    ctx.fill();

    // Nubes
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    const clouds = [
      [120, 90, 60], [220, 70, 40], [180, 110, 35],
      [560, 130, 70], [640, 110, 45], [500, 100, 30],
      [820, 60, 35], [880, 80, 50]
    ];
    for (const [x, y, r] of clouds) {
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
    // capa lejana
    g.fillStyle(0x6a4a78, 0.7);
    g.beginPath();
    g.moveTo(0, HEIGHT * 0.7);
    const farPts = [0, 80, 160, 240, 340, 440, 540, 640, 760, 860, 1000];
    const farYs  = [HEIGHT*0.55, HEIGHT*0.48, HEIGHT*0.52, HEIGHT*0.42, HEIGHT*0.5, HEIGHT*0.44, HEIGHT*0.5, HEIGHT*0.4, HEIGHT*0.47, HEIGHT*0.5, HEIGHT*0.55];
    for (let i = 0; i < farPts.length; i++) g.lineTo(farPts[i], farYs[i]);
    g.lineTo(WIDTH, HEIGHT); g.lineTo(0, HEIGHT);
    g.closePath(); g.fillPath();
    // capa cercana
    g.fillStyle(0x4a3458, 0.85);
    g.beginPath();
    g.moveTo(0, HEIGHT);
    const ys = [HEIGHT*0.62, HEIGHT*0.55, HEIGHT*0.6, HEIGHT*0.52, HEIGHT*0.58, HEIGHT*0.5, HEIGHT*0.56, HEIGHT*0.48, HEIGHT*0.55, HEIGHT*0.6, HEIGHT*0.62];
    for (let i = 0; i < farPts.length; i++) g.lineTo(farPts[i], ys[i]);
    g.lineTo(WIDTH, HEIGHT);
    g.closePath(); g.fillPath();
  }

  // ---------- Terreno ----------

  generateTerrain() {
    const ctx = this.terrainCtx;
    ctx.clearRect(0, 0, WIDTH, HEIGHT);

    // Curva de superficie con varios senos superpuestos
    const baseY = HEIGHT * 0.62;
    const points = [];
    for (let x = 0; x <= WIDTH; x++) {
      const y = baseY
        + Math.sin(x * 0.012) * 50
        + Math.sin(x * 0.03 + 1.2) * 20
        + Math.sin(x * 0.005 + 2.7) * 35;
      points.push(y);
    }

    // Relleno principal: tierra con gradiente
    const grad = ctx.createLinearGradient(0, baseY - 80, 0, HEIGHT);
    grad.addColorStop(0, '#5a8a2a');
    grad.addColorStop(0.05, '#3d6a1a');
    grad.addColorStop(0.18, '#6a4a26');
    grad.addColorStop(0.45, '#4a3018');
    grad.addColorStop(1, '#2a1c10');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(0, HEIGHT);
    for (let x = 0; x <= WIDTH; x++) ctx.lineTo(x, points[x]);
    ctx.lineTo(WIDTH, HEIGHT);
    ctx.closePath();
    ctx.fill();

    // Textura de tierra: ruido de manchitas (solo sobre el terreno)
    ctx.save();
    ctx.globalCompositeOperation = 'source-atop';
    for (let i = 0; i < 1800; i++) {
      const x = Math.random() * WIDTH;
      const y = points[Math.floor(x)] + 6 + Math.random() * (HEIGHT - points[Math.floor(x)] - 6);
      const a = Math.random() * 0.15;
      ctx.fillStyle = `rgba(0,0,0,${a})`;
      ctx.fillRect(x, y, 2, 2);
    }
    // Piedritas claras
    for (let i = 0; i < 400; i++) {
      const x = Math.random() * WIDTH;
      const py = points[Math.floor(x)];
      const y = py + 8 + Math.random() * (HEIGHT - py - 8);
      ctx.fillStyle = `rgba(255,230,180,${Math.random() * 0.18})`;
      ctx.fillRect(x, y, 1 + Math.random() * 2, 1 + Math.random() * 2);
    }
    ctx.restore();

    // Capa de pasto en la superficie (banda verde + briznas)
    ctx.save();
    ctx.globalCompositeOperation = 'source-atop';
    ctx.fillStyle = '#5fa82a';
    for (let x = 0; x <= WIDTH; x++) {
      ctx.fillRect(x, points[x], 1, 6);
    }
    ctx.fillStyle = '#7fd13a';
    for (let x = 0; x <= WIDTH; x++) {
      ctx.fillRect(x, points[x], 1, 2);
    }
    // Briznas
    ctx.strokeStyle = '#9be84a';
    ctx.lineWidth = 1;
    for (let i = 0; i < 250; i++) {
      const x = Math.random() * WIDTH;
      const py = points[Math.floor(x)];
      ctx.beginPath();
      ctx.moveTo(x, py);
      ctx.lineTo(x + (Math.random() - 0.5) * 3, py - 3 - Math.random() * 3);
      ctx.stroke();
    }
    ctx.restore();

    this.terrainTex.refresh();
  }

  // Devuelve true si el píxel (x,y) es terreno sólido
  isSolid(x, y) {
    x = x | 0; y = y | 0;
    if (x < 0 || x >= WIDTH || y >= HEIGHT) return true; // bordes y suelo bloquean
    if (y < 0) return false;
    const data = this.terrainCtx.getImageData(x, y, 1, 1).data;
    return data[3] > 10;
  }

  // Encuentra la primera Y sólida desde arriba en columna x
  surfaceY(x) {
    for (let y = 0; y < HEIGHT; y++) if (this.isSolid(x, y)) return y;
    return HEIGHT;
  }

  // Borra un círculo del terreno (cráter) con borde quemado
  carveCrater(cx, cy, radius) {
    const ctx = this.terrainCtx;
    // 1. recortar el agujero
    ctx.save();
    ctx.globalCompositeOperation = 'destination-out';
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // 2. quemar el borde — solo donde HAY terreno (source-atop nunca crea píxeles nuevos)
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
  }

  // ---------- Gusanos ----------

  spawnWorm(team, x) {
    const y = this.surfaceY(x) - 12;
    const g = this.add.graphics();
    const worm = {
      team, x, y,
      vx: 0, vy: 0,
      onGround: false,
      hp: 100,
      facing: 1,        // 1 derecha, -1 izquierda
      angle: -Math.PI / 4, // ángulo de cañón en radianes (negativo = arriba)
      gfx: g,
      label: this.add.text(0, 0, '', {
        fontFamily: 'monospace', fontSize: 12, color: '#fff',
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
    const x = w.x, y = w.y;

    // sombra
    g.fillStyle(0x000000, 0.25);
    g.fillEllipse(x, y + 11, 18, 4);

    // cuerpo (piel rosada)
    g.fillStyle(0xf2c79a, 1);
    g.fillEllipse(x, y, 22, 20);
    // panza más clara
    g.fillStyle(0xffd9b3, 1);
    g.fillEllipse(x, y + 3, 14, 10);

    // casco del color del equipo
    g.fillStyle(w.team.color, 1);
    g.slice(x, y - 2, 12, Math.PI, 0, false);
    g.fillPath();
    // banda del casco
    g.fillStyle(0x222222, 1);
    g.fillRect(x - 12, y - 2, 24, 2);

    // ojos
    g.fillStyle(0xffffff, 1);
    g.fillCircle(x + w.facing * 2 - 3, y + 1, 3);
    g.fillCircle(x + w.facing * 2 + 4, y + 1, 3);
    g.fillStyle(0x000000, 1);
    g.fillCircle(x + w.facing * 2 - 3 + w.facing, y + 1, 1.5);
    g.fillCircle(x + w.facing * 2 + 4 + w.facing, y + 1, 1.5);

    // boca
    g.lineStyle(1.5, 0x6a3020, 1);
    g.beginPath();
    g.arc(x + w.facing * 2, y + 6, 3, 0, Math.PI, false);
    g.strokePath();

    // barra de HP encima
    const barW = 28, barH = 4;
    const bx = x - barW / 2, by = y - 22;
    g.fillStyle(0x000000, 0.6);
    g.fillRect(bx - 1, by - 1, barW + 2, barH + 2);
    const hpFrac = Math.max(0, w.hp / 100);
    const hpColor = hpFrac > 0.5 ? 0x55dd55 : hpFrac > 0.25 ? 0xddbb33 : 0xdd3333;
    g.fillStyle(hpColor, 1);
    g.fillRect(bx, by, barW * hpFrac, barH);

    w.label.setText(`${w.hp}`);
    w.label.setPosition(x, y - 26);
  }

  currentWorm() {
    const team = this.teams[this.currentTeam];
    return team.worms[this.currentWormIndex[this.currentTeam]];
  }

  // ---------- Turnos ----------

  endTurn() {
    if (this.projectile || this.charging) return;
    // pasar al siguiente equipo y al siguiente gusano vivo
    for (let tries = 0; tries < this.teams.length; tries++) {
      this.currentTeam = (this.currentTeam + 1) % this.teams.length;
      const t = this.teams[this.currentTeam];
      const aliveWorms = t.worms.filter(w => w.alive);
      if (aliveWorms.length === 0) continue;
      // avanzar índice al siguiente vivo
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
    this.checkVictory();
  }

  checkVictory() {
    const aliveTeams = this.teams.filter(t => t.worms.some(w => w.alive));
    if (aliveTeams.length <= 1) {
      const winner = aliveTeams[0];
      this.msgText.setText(winner ? `¡Equipo ${winner.name} gana!` : 'Empate');
      this.gameOver = true;
    }
  }

  // ---------- Disparo ----------

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
    const speed = 200 + this.power * 6; // power 0..100 -> 200..800
    const vx = Math.cos(w.angle) * w.facing * speed;
    const vy = Math.sin(w.angle) * speed;
    this.projectile = {
      x: w.x + w.facing * 14,
      y: w.y - 4,
      vx, vy,
      gfx: this.add.graphics(),
      trail: []
    };
    this.power = 0;
    this.turnEnded = true; // turno termina al disparar
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

  // ---------- Update loop ----------

  update(_, dtMs) {
    const dt = Math.min(dtMs, 33) / 1000;

    // Movimiento del gusano activo
    const active = this.currentWorm();
    if (active && active.alive && !this.projectile && !this.gameOver && !this.turnEnded) {
      if (active.onGround) {
        if (this.cursors.left.isDown)  { active.vx = -90; active.facing = -1; }
        else if (this.cursors.right.isDown) { active.vx = 90; active.facing = 1; }
        else active.vx = 0;
      }
      // apuntado
      if (this.cursors.up.isDown)   active.angle -= 1.5 * dt;
      if (this.cursors.down.isDown) active.angle += 1.5 * dt;
      active.angle = Phaser.Math.Clamp(active.angle, -Math.PI / 2, 0);

      // cargar potencia
      if (this.charging) {
        this.power = Math.min(100, this.power + 80 * dt);
      }
    }

    // Física de todos los gusanos
    for (const team of this.teams) {
      for (const w of team.worms) {
        if (!w.alive) continue;
        this.simulateWorm(w, dt);
        this.drawWorm(w);
      }
    }

    // Proyectil
    if (this.projectile) this.simulateProjectile(dt);

    // Indicadores del gusano activo
    this.aimGfx.clear();
    this.powerGfx.clear();
    if (active && active.alive && !this.projectile && !this.gameOver && !this.turnEnded) {
      const ax = active.x + Math.cos(active.angle) * active.facing * 28;
      const ay = active.y + Math.sin(active.angle) * 28;
      this.aimGfx.lineStyle(2, 0xffff66, 1);
      this.aimGfx.lineBetween(active.x, active.y, ax, ay);
      this.aimGfx.fillStyle(0xffff66, 1);
      this.aimGfx.fillCircle(ax, ay, 3);

      if (this.charging || this.power > 0) {
        const barW = 80, barH = 8;
        const bx = active.x - barW / 2, by = active.y - 30;
        this.powerGfx.fillStyle(0x222222, 0.8);
        this.powerGfx.fillRect(bx, by, barW, barH);
        this.powerGfx.fillStyle(0xff7733, 1);
        this.powerGfx.fillRect(bx, by, barW * (this.power / 100), barH);
      }
    }

    // HUD
    const team = this.teams[this.currentTeam];
    this.hudText.setText(
      `Turno: ${team.name}` +
      (active && active.alive ? `  HP:${active.hp}  ang:${(active.angle * 180 / Math.PI).toFixed(0)}°` : '') +
      (this.turnEnded ? '   [Enter para siguiente turno]' : '')
    );
  }

  simulateWorm(w, dt) {
    // gravedad
    w.vy += GRAVITY * dt;

    // mover en pasos pequeños para chequear colisión
    const steps = 4;
    const sx = (w.vx * dt) / steps;
    const sy = (w.vy * dt) / steps;
    for (let i = 0; i < steps; i++) {
      // X
      const nx = w.x + sx;
      if (!this.collidesWorm(nx, w.y)) {
        w.x = nx;
      } else {
        // intentar subir un escalón
        let climbed = false;
        for (let up = 1; up <= 6; up++) {
          if (!this.collidesWorm(nx, w.y - up)) {
            w.x = nx; w.y -= up; climbed = true; break;
          }
        }
        if (!climbed) w.vx = 0;
      }
      // Y
      const ny = w.y + sy;
      if (!this.collidesWorm(w.x, ny)) {
        w.y = ny;
        w.onGround = false;
      } else {
        if (sy > 0) {
          // ajustar al suelo
          while (!this.collidesWorm(w.x, w.y + 1)) w.y += 1;
          w.onGround = true;
        }
        w.vy = 0;
      }
    }

    // límites
    if (w.x < 6) w.x = 6;
    if (w.x > WIDTH - 6) w.x = WIDTH - 6;
    if (w.y > HEIGHT + 30) {
      // cayó al vacío
      w.alive = false;
      w.gfx.clear();
      w.label.setVisible(false);
      this.checkVictory();
    }
  }

  collidesWorm(x, y) {
    // bbox circular aproximado: chequear unos puntos
    const r = 9;
    return (
      this.isSolid(x, y + r) ||  // pies
      this.isSolid(x - r + 2, y + r - 2) ||
      this.isSolid(x + r - 2, y + r - 2) ||
      this.isSolid(x, y - r + 2)
    );
  }

  simulateProjectile(dt) {
    const p = this.projectile;
    p.vy += GRAVITY * dt;
    p.vx += WIND * dt;

    const steps = 6;
    const sx = (p.vx * dt) / steps;
    const sy = (p.vy * dt) / steps;
    for (let i = 0; i < steps; i++) {
      p.x += sx; p.y += sy;
      if (p.x < 0 || p.x > WIDTH || p.y > HEIGHT + 50) {
        this.destroyProjectile(false);
        return;
      }
      if (this.isSolid(p.x, p.y)) {
        this.explode(p.x, p.y, 38);
        this.destroyProjectile(true);
        return;
      }
      // colisión con gusano (no el que disparó: simplificación: cualquier otro)
      const hit = this.findWormHit(p.x, p.y);
      if (hit) {
        this.explode(p.x, p.y, 42);
        this.destroyProjectile(true);
        return;
      }
    }

    p.trail.push({ x: p.x, y: p.y });
    if (p.trail.length > 20) p.trail.shift();

    p.gfx.clear();
    // estela degradada
    for (let i = 1; i < p.trail.length; i++) {
      const a = i / p.trail.length;
      p.gfx.lineStyle(2 + a * 2, 0xffaa55, a * 0.7);
      p.gfx.lineBetween(p.trail[i - 1].x, p.trail[i - 1].y, p.trail[i].x, p.trail[i].y);
    }
    // bombita
    p.gfx.fillStyle(0x222222, 1);
    p.gfx.fillCircle(p.x, p.y, 5);
    p.gfx.fillStyle(0xffaa33, 1);
    p.gfx.fillCircle(p.x - p.vx * 0.005, p.y - p.vy * 0.005, 2);

    // humo de cola
    if (Math.random() < 0.7) {
      const s = this.add.circle(p.x, p.y, 3 + Math.random() * 2, 0x888888, 0.5);
      this.tweens.add({
        targets: s, alpha: 0, scale: 2.2, duration: 500,
        onComplete: () => s.destroy()
      });
    }
  }

  findWormHit(x, y) {
    const shooter = this.currentWorm();
    for (const team of this.teams) {
      for (const w of team.worms) {
        if (!w.alive || w === shooter) continue;
        const dx = w.x - x, dy = w.y - y;
        if (dx * dx + dy * dy < 12 * 12) return w;
      }
    }
    return null;
  }

  destroyProjectile(_hit) {
    if (!this.projectile) return;
    this.projectile.gfx.destroy();
    this.projectile = null;
  }

  explode(cx, cy, radius) {
    this.carveCrater(cx, cy, radius);
    // screen shake
    this.cameras.main.shake(220, 0.012);
    // flash central
    const flash = this.add.circle(cx, cy, radius * 0.9, 0xffeeaa, 0.95);
    this.tweens.add({ targets: flash, alpha: 0, scale: 1.8, duration: 380, onComplete: () => flash.destroy() });
    // anillo
    const ring = this.add.circle(cx, cy, radius * 0.5, 0xff7a22, 0.7);
    this.tweens.add({ targets: ring, alpha: 0, scale: 3, duration: 500, onComplete: () => ring.destroy() });
    // partículas de chispas/tierra
    for (let i = 0; i < 22; i++) {
      const ang = Math.random() * Math.PI * 2;
      const spd = 80 + Math.random() * 220;
      const isSpark = Math.random() < 0.5;
      const p = this.add.circle(cx, cy, isSpark ? 2 : 3,
        isSpark ? 0xffe27a : 0x6a4628, 1);
      const tx = cx + Math.cos(ang) * spd * 0.6;
      const ty = cy + Math.sin(ang) * spd * 0.6 - 40;
      this.tweens.add({
        targets: p, x: tx, y: ty, alpha: 0,
        duration: 500 + Math.random() * 400,
        ease: 'Cubic.Out',
        onComplete: () => p.destroy()
      });
    }
    // humo expansivo
    for (let i = 0; i < 6; i++) {
      const s = this.add.circle(cx + (Math.random() - 0.5) * 10, cy - 4 - i * 2, 8 + Math.random() * 6, 0x444444, 0.55);
      this.tweens.add({
        targets: s, y: s.y - 60 - Math.random() * 30, alpha: 0, scale: 2.4,
        duration: 900 + Math.random() * 400,
        onComplete: () => s.destroy()
      });
    }

    // daño y empuje a gusanos
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
          if (w.hp <= 0) {
            w.alive = false;
            w.hp = 0;
            w.gfx.clear();
            w.label.setVisible(false);
          }
        }
      }
    }

    // los gusanos sobre el cráter caen: nada extra a hacer, la gravedad los lleva
    this.checkVictory();
  }
}

new Phaser.Game({
  type: Phaser.AUTO,
  width: WIDTH,
  height: HEIGHT,
  parent: 'game',
  scene: [MainScene],
  pixelArt: false
});

// Персонаж-фигурка: маленький человечек, которого, как фишку настольной
// игры, переставляют по боксам. Собирается кодом из простых фигур - в том
// же low-poly стиле, что мебель комнаты, - и одевается по «образу»: что
// надето в каждом слоте.
//
// Этот файл нужен и редактору персонажа (avatar_pages), и виджету
// мини-игры: бот раздаёт папку avatar_pages, и страница комнаты
// (room_pages/view.html) рисует из него фигурку игрока на поле и в комнате.
//
// Договорённость: одна клетка комнаты = 1 единица. Фигурка стоит прямо на
// полу: подошвы в y = 0, между ступнями - точка (0, 0, 0). Смотрит на +z.
// Рост без головного убора - около 1.9.
//
// Слоты и предметы описаны в catalog.json. У предмета одежды есть style -
// какой функцией он строится, и color (и иногда accent) - в какой цвет
// покрашен. Новый цвет того же фасона - просто строка в каталоге, новый
// фасон - функция ниже в STYLES.

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

// Размеры фигурки - от пола
export const FIGURE = {
  height: 1.92,       // до макушки, без головного убора
  headY: 1.45,        // центр головы
  headR: 0.4,         // радиус головы
};
// Детали тела ниже размечены от высоты SOLE - там подошвы. Собранное тело
// опускается на SOLE целиком, и фигурка встаёт на пол
const SOLE = 0.13;
const HEAD_Y = FIGURE.headY + SOLE;
const R = FIGURE.headR;
const HEAD_SQUASH = 0.94;   // голова чуть приплюснута сверху

// Головные уборы, под которыми не видно макушки: причёска под ними
// строится без того, что торчит вверх (шипы, пучок, ирокез)
const COVERING = new Set(['cap', 'beanie', 'cowboy', 'tophat', 'beret', 'witch']);
// Высокие уборы: нимб над ними парит выше
const TALL_HATS = new Set(['tophat', 'cowboy', 'bunny', 'crown', 'witch']);

// ------------------------------------------------------------------ каталог и образ

export class Wardrobe {
  constructor(catalog) {
    this.catalog = catalog;
    this.slots = catalog.slots;
    this.items = catalog.items;
    this.byId = new Map(this.items.map((item) => [item.id, item]));
    this.byCode = new Map(this.items.map((item) => [item.code, item]));
    this.slotById = new Map(this.slots.map((slot) => [slot.id, slot]));
  }

  inSlot(slotId) {
    return this.items.filter((item) => item.slot === slotId);
  }

  // Образ по умолчанию: первый стартовый предмет в каждом слоте
  defaultLook() {
    const look = {};
    for (const slot of this.slots) {
      const item = this.items.find((x) => x.slot === slot.id && x.starter);
      look[slot.id] = item ? item.id : null;
    }
    return look;
  }

  // Номера из кода образа -> {слот: id}. Чего нет - по умолчанию
  lookFromCodes(codes) {
    const look = this.defaultLook();
    const optionalEmpty = new Set(this.slots.filter((slot) => slot.optional).map((slot) => slot.id));
    for (const code of codes || []) {
      const item = this.byCode.get(code);
      if (!item) continue;
      look[item.slot] = item.id;
      optionalEmpty.delete(item.slot);
    }
    // Необязательный слот, которого нет в коде, - пустой (сняли шляпу)
    if (codes) for (const slot of optionalEmpty) look[slot] = null;
    return look;
  }

  lookCodes(look) {
    return Object.values(look).filter(Boolean).map((id) => this.byId.get(id)).filter(Boolean).map((item) => item.code);
  }

  // {слот: предмет} - для постройки
  resolve(look) {
    const resolved = {};
    for (const slot of this.slots) {
      const id = look[slot.id];
      resolved[slot.id] = id ? this.byId.get(id) || null : null;
    }
    return resolved;
  }
}

// ------------------------------------------------------------------ материалы и формы

const materials = new Map();
function mat(color, { rough = 0.72, metal = 0.02, emissive = 0x000000, glow = 0, flat = false } = {}) {
  const key = [new THREE.Color(color).getHexString(), rough, metal, emissive, glow, flat].join('|');
  if (!materials.has(key)) {
    materials.set(key, new THREE.MeshStandardMaterial({
      color, roughness: rough, metalness: metal, emissive, emissiveIntensity: glow, flatShading: flat,
    }));
  }
  return materials.get(key);
}

function shade(color, k) {
  const c = new THREE.Color(color);
  if (k < 1) c.multiplyScalar(k);
  else c.lerp(new THREE.Color(0xffffff), k - 1);
  return c;
}

const geometries = new Map();
function cached(key, make) {
  if (!geometries.has(key)) geometries.set(key, make());
  return geometries.get(key);
}

function roundedBox(w, h, d, r) {
  const radius = Math.max(0, Math.min(r, w / 2 - 0.002, h / 2 - 0.002, d / 2 - 0.002));
  return cached(`rb|${w}|${h}|${d}|${radius.toFixed(3)}`,
    () => (radius > 0.006 ? new RoundedBoxGeometry(w, h, d, 2, radius) : new THREE.BoxGeometry(w, h, d)));
}

function place(g, geometry, material, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geometry, material);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  g.add(m);
  return m;
}

const box = (g, w, h, d, material, x, y, z, r = 0.04) => place(g, roundedBox(w, h, d, r), material, x, y, z);
const sphere = (g, radius, material, x, y, z, detail = 16) =>
  place(g, cached(`s|${radius}|${detail}`, () => new THREE.SphereGeometry(radius, detail * 2, detail)), material, x, y, z);
const cylinder = (g, top, bottom, h, material, x, y, z, segments = 24) =>
  place(g, cached(`c|${top}|${bottom}|${h}|${segments}`, () => new THREE.CylinderGeometry(top, bottom, h, segments)), material, x, y, z);
const cone = (g, radius, h, material, x, y, z, segments = 12) =>
  place(g, cached(`k|${radius}|${h}|${segments}`, () => new THREE.ConeGeometry(radius, h, segments)), material, x, y, z);
const capsule = (g, radius, length, material, x, y, z) =>
  place(g, cached(`p|${radius}|${length}`, () => new THREE.CapsuleGeometry(radius, length, 6, 14)), material, x, y, z);
const torus = (g, radius, tube, material, x, y, z, arc = Math.PI * 2) =>
  place(g, cached(`t|${radius}|${tube}|${arc}`, () => new THREE.TorusGeometry(radius, tube, 10, 36, arc)), material, x, y, z);

// Часть сферы головы: шапочка волос, купол шапки. thetaLength - как низко спускается
function dome(g, radius, thetaLength, material, y = 0) {
  const geometry = cached(`d|${radius}|${thetaLength}`,
    () => new THREE.SphereGeometry(radius, 36, 18, 0, Math.PI * 2, 0, thetaLength));
  return place(g, geometry, material, 0, y, 0);
}

// Сужающаяся трубка вдоль плавной кривой через точки: прядь волос, хвост,
// рог. r0 - толщина у основания, r1 - на конце. colors - [у основания,
// на конце]: цвет плавно перетекает (материал - vertexMat)
function taperedTube(points, r0, r1, { segments = 18, radial = 12, colors = null, ease = 1 } = {}) {
  const curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(...p)));
  const frames = curve.computeFrenetFrames(segments, false);
  const pos = [], nor = [], uv = [], col = [], idx = [];
  const c0 = colors && new THREE.Color(colors[0]), c1 = colors && new THREE.Color(colors[1]);
  const n = new THREE.Vector3();
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const p = curve.getPointAt(t);
    const r = r1 + (r0 - r1) * Math.pow(1 - t, ease);
    const c = colors ? c0.clone().lerp(c1, t) : null;
    for (let j = 0; j <= radial; j++) {
      const v = (j / radial) * Math.PI * 2;
      n.set(0, 0, 0).addScaledVector(frames.normals[i], -Math.cos(v)).addScaledVector(frames.binormals[i], Math.sin(v)).normalize();
      pos.push(p.x + r * n.x, p.y + r * n.y, p.z + r * n.z);
      nor.push(n.x, n.y, n.z);
      uv.push(j / radial, t);
      if (c) col.push(c.r, c.g, c.b);
    }
  }
  for (let i = 0; i < segments; i++) {
    for (let j = 0; j < radial; j++) {
      const a = i * (radial + 1) + j, b = a + radial + 1;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setIndex(idx);
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  if (colors) geometry.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return geometry;
}

// Материал, который берёт цвет из самой формы (taperedTube с colors, перепонка крыла)
function vertexMat(rough = 0.6, doubleSide = false) {
  const key = `vertex|${rough}|${doubleSide}`;
  if (!materials.has(key)) {
    materials.set(key, new THREE.MeshStandardMaterial({
      vertexColors: true, roughness: rough, metalness: 0.02, side: doubleSide ? THREE.DoubleSide : THREE.FrontSide,
    }));
  }
  return materials.get(key);
}

// Прядь, хвост: трубка по точкам, форма запоминается по ключу
function strand(g, key, points, r0, r1, material, options = {}) {
  return place(g, cached(`strand|${key}`, () => taperedTube(points, r0, r1, options)), material);
}

// Палочка от точки a до точки b (на плоскости xy): кость крыла
function limb(g, a, b, radius, material) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const length = Math.hypot(dx, dy);
  const m = cylinder(g, radius * 0.75, radius, length, material, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2, 0, 8);
  m.rotation.z = Math.atan2(dy, dx) - Math.PI / 2;
  return m;
}

// Палочка между двумя точками в пространстве: лямка маски, шнурок
function stick(g, a, b, radius, material, segments = 8) {
  const from = new THREE.Vector3(...a), to = new THREE.Vector3(...b);
  const direction = to.clone().sub(from);
  const m = cylinder(g, radius, radius, direction.length(), material, ...from.clone().add(to).multiplyScalar(0.5).toArray(), segments);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
  return m;
}

// Ткань с рисунком: картинка на холсте, натянутая на детали одежды.
// decal - картинка с прозрачными местами (нашивка, принт, маска)
const patterns = new Map();
function pattern(key, width, height, draw, rough = 0.9, decal = false) {
  if (!patterns.has(key)) {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    draw(canvas.getContext('2d'), width, height);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;
    patterns.set(key, new THREE.MeshStandardMaterial({
      map: texture, roughness: rough, metalness: 0.02,
      ...(decal ? { transparent: true, alphaTest: 0.4, side: THREE.DoubleSide } : {}),
    }));
  }
  return patterns.get(key);
}

// Материал, видный с обеих сторон: открытые снизу юбки и оборки
function twoSided(color, rough = 0.85) {
  const key = `two|${new THREE.Color(color).getHexString()}|${rough}`;
  if (!materials.has(key)) {
    materials.set(key, new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: 0.02, side: THREE.DoubleSide }));
  }
  return materials.get(key);
}

// Светящаяся деталь: неоновые швы, камень тиары
const glow = (color, k = 1.4) => mat(color, { emissive: new THREE.Color(color).getHex(), glow: k, rough: 0.4 });

const hex = (color, k = 1) => `#${shade(color, k).getHexString()}`;

// Облачко: несколько кружков, слитых в одно, с тёмным контуром
function drawCloud(ctx, x, y, size, fill, line) {
  const puffs = [[-0.9, 0.2, 0.55], [-0.35, -0.25, 0.75], [0.35, -0.15, 0.7], [0.9, 0.2, 0.55], [0, 0.25, 0.65]];
  ctx.fillStyle = line;
  for (const [dx, dy, r] of puffs) {
    ctx.beginPath(); ctx.arc(x + dx * size, y + dy * size, r * size + 2.5, 0, Math.PI * 2); ctx.fill();
  }
  ctx.fillStyle = fill;
  for (const [dx, dy, r] of puffs) {
    ctx.beginPath(); ctx.arc(x + dx * size, y + dy * size, r * size, 0, Math.PI * 2); ctx.fill();
  }
}

// Звёздочка-искорка о четырёх лучах
function drawSparkle(ctx, x, y, r, color) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(x, y - r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.quadraticCurveTo(x, y, x, y + r);
  ctx.quadraticCurveTo(x, y, x - r, y);
  ctx.quadraticCurveTo(x, y, x, y - r);
  ctx.fill();
}

// Ткань худи-облачка: оранжевая, в светлых облаках
function cloudCloth(color) {
  return pattern(`cloud|${color}`, 256, 256, (ctx, w, h) => {
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, w, h);
    const clouds = [[40, 50, 16], [150, 30, 13], [220, 110, 15], [90, 130, 18], [30, 200, 13], [170, 205, 17], [250, 240, 12], [120, 250, 11]];
    for (const [x, y, size] of clouds) {
      for (const ox of [-w, 0, w]) drawCloud(ctx, x + ox, y, size, hex(color, 1.3), hex(color, 0.84));
    }
  });
}

// Звёздные штаны: тёмно-синие, к низу - в рыжих облаках и искорках
function starCloth(color, accent) {
  return pattern(`stars|${color}|${accent}`, 128, 256, (ctx, w, h) => {
    const gradient = ctx.createLinearGradient(0, 0, 0, h);
    gradient.addColorStop(0, color);
    gradient.addColorStop(0.5, hex(color, 1.12));
    gradient.addColorStop(0.82, '#a9849a');
    gradient.addColorStop(1, '#efa47c');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, w, h);
    for (const [x, y, size] of [[20, 200, 10], [96, 186, 12], [60, 238, 13], [120, 240, 9], [0, 236, 9]]) {
      drawCloud(ctx, x, y, size, 'rgba(250, 178, 140, 0.92)', 'rgba(214, 120, 96, 0.8)');
    }
    for (const [x, y, r] of [[24, 40, 7], [90, 70, 9], [50, 118, 6], [104, 140, 8], [16, 160, 5], [70, 30, 4], [112, 20, 5], [40, 80, 3]]) {
      drawSparkle(ctx, x, y, r, accent);
    }
  });
}

// Вязаное полотно: резинка - продольные полоски, по ним - петельки
function knitCloth(color) {
  return pattern(`knit|${color}`, 64, 64, (ctx, w, h) => {
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = hex(color, 0.84);
    for (let x = 0; x < w; x += 8) ctx.fillRect(x, 0, 3, h);
    ctx.strokeStyle = hex(color, 1.1);
    ctx.lineWidth = 1.5;
    for (let x = 4; x < w; x += 8) {
      for (let y = 0; y < h; y += 6) {
        ctx.beginPath(); ctx.moveTo(x - 2, y); ctx.lineTo(x, y + 3); ctx.lineTo(x + 2, y); ctx.stroke();
      }
    }
  }, 0.97);
}

// Вязка косами: по полотну - жгуты-«косички» и между ними резинка
function cableCloth(color) {
  return pattern(`cable|${color}`, 96, 96, (ctx, w, h) => {
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = hex(color, 0.82);
    for (const x of [0, 30, 62]) ctx.fillRect(x, 0, 4, h);
    ctx.strokeStyle = hex(color, 1.16);
    ctx.lineWidth = 4;
    for (const cx of [17, 47, 79]) {
      for (let y = -8; y < h + 8; y += 16) {
        ctx.beginPath(); ctx.moveTo(cx - 6, y); ctx.bezierCurveTo(cx - 6, y + 8, cx + 6, y + 8, cx + 6, y + 16); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(cx + 6, y); ctx.bezierCurveTo(cx + 6, y + 6, cx + 1, y + 7, cx, y + 8); ctx.stroke();
      }
    }
  }, 0.97);
}

// Шотландка: по красному полю тёмные полосы в обе стороны и тонкие светлые
// нити. Три клетки в ширину - на юбку хватает без повтора
function tartanCloth(color, accent) {
  return pattern(`tartan|${color}|${accent}`, 384, 128, (ctx, w, h) => {
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, w, h);
    ctx.globalAlpha = 0.55;
    ctx.fillStyle = accent;
    for (let x = 0; x < w; x += 128) ctx.fillRect(x + 40, 0, 48, h);
    for (let y = 0; y < h; y += 128) ctx.fillRect(0, y + 40, w, 48);
    ctx.globalAlpha = 0.35;
    for (let x = 0; x < w; x += 128) ctx.fillRect(x + 8, 0, 12, h);
    ctx.fillRect(0, 8, w, 12);
    ctx.globalAlpha = 0.8;
    ctx.fillStyle = '#f2d36b';
    for (let x = 0; x < w; x += 128) ctx.fillRect(x + 104, 0, 3, h);
    ctx.fillRect(0, 104, w, 3);
    ctx.globalAlpha = 1;
  }, 0.9);
}

// Батик «паранг»: по тёмному полю косые полосы из золотых волн-завитков,
// между ними - ряды точек
function batikCloth(color, accent) {
  return pattern(`batik|${color}|${accent}`, 256, 256, (ctx, w, h) => {
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, w, h);
    ctx.save();
    ctx.translate(w / 2, h / 2);
    ctx.rotate(-Math.PI / 4);
    ctx.lineCap = 'round';
    const band = 46;
    for (let row = -6; row <= 6; row++) {
      const y = row * band;
      ctx.strokeStyle = accent;
      ctx.lineWidth = 4;
      for (let x = -260; x < 260; x += 30) {
        // Завиток-«S»: волна с закрученными концами
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.bezierCurveTo(x + 8, y - 16, x + 22, y - 16, x + 15, y - 4);
        ctx.bezierCurveTo(x + 10, y + 4, x + 20, y + 14, x + 30, y);
        ctx.stroke();
      }
      ctx.strokeStyle = hex(accent, 0.7);
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(-260, y + 12); ctx.lineTo(260, y + 12); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-260, y - 20); ctx.lineTo(260, y - 20); ctx.stroke();
      ctx.fillStyle = accent;
      for (let x = -260; x < 260; x += 12) {
        ctx.beginPath(); ctx.arc(x, y + 24, 2, 0, Math.PI * 2); ctx.fill();
      }
    }
    ctx.restore();
  }, 0.75);
}

// Плюш (боа): мелкие завитки чуть светлее и темнее основы
function furCloth(color) {
  return pattern(`fur|${color}`, 128, 128, (ctx, w, h) => {
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, w, h);
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    for (let i = 0; i < 260; i++) {
      const x = (i * 37) % w, y = (i * 59 + (i % 5) * 7) % h;
      ctx.strokeStyle = i % 3 ? hex(color, 0.86) : hex(color, 1.12);
      ctx.beginPath(); ctx.arc(x, y, 3.5, (i % 4) * 1.4, (i % 4) * 1.4 + 3.6); ctx.stroke();
    }
  }, 1);
}

// Корсет спереди: шов посередине, люверсы в два ряда и шнуровка крест-накрест
function lacingCloth(color, accent) {
  return pattern(`lacing|${color}|${accent}`, 128, 128, (ctx, w, h) => {
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = hex(color, 0.7);
    for (const x of [22, 106]) ctx.fillRect(x, 0, 3, h);
    ctx.fillRect(62, 0, 4, h);
    ctx.strokeStyle = accent;
    ctx.lineWidth = 3;
    const rows = 7;
    for (let i = 0; i < rows; i++) {
      const y = 8 + i * ((h - 16) / (rows - 1));
      if (i < rows - 1) {
        const next = 8 + (i + 1) * ((h - 16) / (rows - 1));
        ctx.beginPath(); ctx.moveTo(50, y); ctx.lineTo(78, next); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(78, y); ctx.lineTo(50, next); ctx.stroke();
      }
      for (const x of [50, 78]) {
        ctx.fillStyle = hex(accent, 0.8);
        ctx.beginPath(); ctx.arc(x, y, 4, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = color;
        ctx.beginPath(); ctx.arc(x, y, 1.8, 0, Math.PI * 2); ctx.fill();
      }
    }
  }, 0.55);
}

// Кружево: тёмная ткань в мелкой светлой сеточке и цветочках
function laceCloth(color, accent) {
  return pattern(`lace|${color}|${accent}`, 128, 128, (ctx, w, h) => {
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = accent;
    ctx.globalAlpha = 0.18;
    ctx.lineWidth = 1;
    for (let i = -h; i < w; i += 8) {
      ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i + h, h); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(i + h, 0); ctx.lineTo(i, h); ctx.stroke();
    }
    ctx.globalAlpha = 0.42;
    ctx.lineWidth = 1.2;
    for (let y = 8; y < h; y += 32) {
      for (let x = 8 + ((y / 32) % 2) * 16; x < w; x += 32) {
        for (let i = 0; i < 5; i++) {
          const a = (i / 5) * Math.PI * 2;
          ctx.beginPath(); ctx.arc(x + Math.cos(a) * 3, y + Math.sin(a) * 3, 2.2, 0, Math.PI * 2); ctx.stroke();
        }
      }
    }
    ctx.globalAlpha = 1;
  }, 0.8);
}

// Нашивка-буква на груди куртки: буква цвета color в тёмной обводке outline
function letterPatch(letter, color, outline) {
  return pattern(`letter|${letter}|${color}|${outline}`, 128, 128, (ctx, w, h) => {
    ctx.font = 'bold 112px Georgia, "Times New Roman", serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = outline;
    ctx.lineWidth = 16;
    ctx.strokeText(letter, w / 2, h / 2 + 6);
    ctx.fillStyle = color;
    ctx.fillText(letter, w / 2, h / 2 + 6);
  }, 0.95, true);
}

// Принт панк-топа: череп и молнии - светлым по тёмному
function skullPrint(color) {
  return pattern(`skull|${color}`, 128, 128, (ctx, w, h) => {
    ctx.fillStyle = color;
    ctx.beginPath(); ctx.arc(64, 56, 30, 0, Math.PI * 2); ctx.fill();
    ctx.fillRect(46, 70, 36, 24);
    ctx.fillStyle = '#000';
    ctx.globalCompositeOperation = 'destination-out';
    for (const x of [52, 76]) { ctx.beginPath(); ctx.arc(x, 58, 9, 0, Math.PI * 2); ctx.fill(); }
    ctx.beginPath(); ctx.moveTo(64, 68); ctx.lineTo(59, 78); ctx.lineTo(69, 78); ctx.closePath(); ctx.fill();
    for (const x of [54, 62, 70]) ctx.fillRect(x, 84, 3, 10);
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = color;
    for (const s of [-1, 1]) {
      const x = 64 + s * 46;
      ctx.beginPath();
      ctx.moveTo(x + s * 4, 24); ctx.lineTo(x - s * 6, 52); ctx.lineTo(x + s * 2, 52); ctx.lineTo(x - s * 8, 84);
      ctx.lineTo(x + s * 10, 46); ctx.lineTo(x + s * 2, 46); ctx.lineTo(x + s * 10, 24);
      ctx.closePath(); ctx.fill();
    }
  }, 0.95, true);
}

// ------------------------------------------------------------------ лицо: рисуется на холсте

// Холст натянут на переднюю часть головы: по горизонтали ±FACE_PHI от
// центра, по вертикали от FACE_THETA0 до FACE_THETA0 + FACE_THETA
const FACE_PHI = 0.9;
const FACE_THETA0 = 0.28 * Math.PI;
const FACE_THETA = 0.52 * Math.PI;
const FACE_W = 512, FACE_H = 440;
const EYE_X = 92, EYE_Y = 210;

function darker(color, k = 0.55) {
  return `#${shade(color, k).getHexString()}`;
}

function drawEye(ctx, x, y, style, color, side) {
  if (style === 'none') return;   // манекен без лица
  const ink = '#2a1c1a';
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (style === 'closed') {
    // Закрытый глаз - дужка вниз и ресничка у внешнего края
    ctx.strokeStyle = ink; ctx.lineWidth = 15;
    ctx.beginPath(); ctx.arc(x, y - 20, 40, Math.PI * 0.2, Math.PI * 0.8); ctx.stroke();
    ctx.lineWidth = 11;
    const a = side < 0 ? Math.PI * 0.8 : Math.PI * 0.2;
    const ex = x + Math.cos(a) * 40, ey = y - 20 + Math.sin(a) * 40;
    ctx.beginPath(); ctx.moveTo(ex, ey); ctx.lineTo(ex + side * 16, ey + 12); ctx.stroke();
    return;
  }
  const iris = (r, py = 0) => {
    ctx.fillStyle = ink;
    ctx.beginPath(); ctx.ellipse(x, y + py, r + 7, r * 1.12 + 7, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = color;
    ctx.beginPath(); ctx.ellipse(x, y + py, r, r * 1.12, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = ink;
    ctx.beginPath(); ctx.ellipse(x, y + py + r * 0.12, r * 0.52, r * 0.6, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.beginPath(); ctx.arc(x - r * 0.35, y + py - r * 0.4, r * 0.28, 0, Math.PI * 2); ctx.fill();
  };
  switch (style) {
    case 'happy':
      ctx.strokeStyle = ink; ctx.lineWidth = 16;
      ctx.beginPath(); ctx.arc(x, y + 14, 34, Math.PI * 1.1, Math.PI * 1.9); ctx.stroke();
      break;
    case 'sleepy':
      iris(38, 10);
      ctx.fillStyle = 'rgba(0,0,0,0)';
      ctx.globalCompositeOperation = 'destination-out';
      ctx.fillRect(x - 60, y - 70, 120, 66);
      ctx.globalCompositeOperation = 'source-over';
      ctx.strokeStyle = ink; ctx.lineWidth = 14;
      ctx.beginPath(); ctx.moveTo(x - 48, y - 3); ctx.lineTo(x + 48, y - 3); ctx.stroke();
      break;
    case 'big':
      iris(56, 4);
      ctx.fillStyle = '#ffffff';
      ctx.beginPath(); ctx.arc(x + 20, y + 30, 9, 0, Math.PI * 2); ctx.fill();
      break;
    case 'wink':
      if (side < 0) {
        iris(48);
      } else {
        ctx.strokeStyle = ink; ctx.lineWidth = 16;
        ctx.beginPath(); ctx.moveTo(x - 38, y + 4); ctx.lineTo(x + 34, y - 8); ctx.stroke();
      }
      break;
    case 'star': {
      ctx.fillStyle = ink;
      star(ctx, x, y, 58, 5);
      ctx.fillStyle = color;
      star(ctx, x, y + 2, 44, 5);
      ctx.fillStyle = '#ffffff';
      ctx.beginPath(); ctx.arc(x - 12, y - 10, 9, 0, Math.PI * 2); ctx.fill();
      break;
    }
    case 'anime':
    case 'sly':
      animeEye(ctx, x, y, style === 'sly', color, side);
      break;
    default:
      iris(48);
  }
}

// Большой блестящий глаз, как в аниме: радужка темнеет кверху, два блика,
// густые верхние ресницы с хвостиком к виску. sly - верхнее веко опущено
// и скошено: хитрый, довольный взгляд
function animeEye(ctx, x, y, sly, color, side) {
  const ink = '#2b1a24';
  const w = 44, h = 58, cy = y + 4;
  ctx.save();
  ctx.beginPath();
  ctx.ellipse(x, cy, w + 4, h, 0, 0, Math.PI * 2);
  ctx.clip();
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(x - 60, cy - 70, 120, 140);
  const gradient = ctx.createLinearGradient(0, cy - h, 0, cy + h);
  gradient.addColorStop(0, hex(color, 0.32));
  gradient.addColorStop(0.45, color);
  gradient.addColorStop(1, hex(color, 1.5));
  ctx.fillStyle = gradient;
  ctx.beginPath(); ctx.ellipse(x, cy + 3, w - 4, h - 3, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = hex(color, 0.2);
  ctx.beginPath(); ctx.ellipse(x, cy - 2, 15, 24, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = 'rgba(255, 255, 255, 0.35)';
  ctx.beginPath(); ctx.ellipse(x, cy + 26, 22, 12, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.beginPath(); ctx.ellipse(x - 13, cy - 16, 11, 15, -0.3, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(x + 13, cy + 22, 6, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
  // Где проходит верхнее веко: у хитрого глаза - ниже и наискось
  const inner = { x: x - side * (w + 6), y: sly ? cy - h * 0.12 : cy - h * 0.55 };
  const outer = { x: x + side * (w + 6), y: sly ? cy - h * 0.42 : cy - h * 0.55 };
  if (sly) {
    ctx.save();
    ctx.globalCompositeOperation = 'destination-out';
    ctx.beginPath();
    ctx.moveTo(inner.x, inner.y);
    ctx.lineTo(outer.x, outer.y);
    ctx.lineTo(outer.x, cy - h - 20);
    ctx.lineTo(inner.x, cy - h - 20);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
  ctx.strokeStyle = ink;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = 14;
  ctx.beginPath();
  if (sly) {
    ctx.moveTo(inner.x, inner.y);
    ctx.quadraticCurveTo(x, (inner.y + outer.y) / 2 - 8, outer.x, outer.y);
  } else {
    ctx.ellipse(x, cy, w + 5, h + 2, 0, Math.PI * 1.1, Math.PI * 1.9);
  }
  ctx.stroke();
  // Хвостик ресниц к виску
  ctx.lineWidth = 11;
  ctx.beginPath();
  ctx.moveTo(outer.x - side * 6, outer.y + (sly ? 0 : 14));
  ctx.lineTo(outer.x + side * 16, outer.y - 10);
  ctx.stroke();
  // Нижнее веко - тонкий штрих у внешнего края
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.ellipse(x, cy, w + 2, h, 0, side > 0 ? Math.PI * 0.08 : Math.PI * 0.62, side > 0 ? Math.PI * 0.38 : Math.PI * 0.92);
  ctx.stroke();
}

function star(ctx, x, y, r, points) {
  ctx.beginPath();
  for (let i = 0; i < points * 2; i++) {
    const radius = i % 2 ? r * 0.45 : r;
    const a = -Math.PI / 2 + (i * Math.PI) / points;
    ctx.lineTo(x + Math.cos(a) * radius, y + Math.sin(a) * radius);
  }
  ctx.closePath();
  ctx.fill();
}

// closed - глаза закрыты (сон, моргание); брови остаются как у самих глаз
const faceTextures = new Map();
// Рта у фигурок нет: его всё равно не разглядеть, а без него лицо чище
function faceTexture(eyes, eyeColor, hairColor, closed = false) {
  const key = [eyes, eyeColor, hairColor, closed].join('|');
  if (faceTextures.has(key)) return faceTextures.get(key);
  const canvas = document.createElement('canvas');
  canvas.width = FACE_W;
  canvas.height = FACE_H;
  const ctx = canvas.getContext('2d');
  const anime = eyes === 'anime' || eyes === 'sly';
  // Румянец - как у раскрашенной фигурки. У аниме-глаз ярче, со штрихами.
  // У манекена (глаз нет) - ни румянца, ни бровей
  ctx.fillStyle = anime ? 'rgba(255, 100, 130, 0.36)' : 'rgba(255, 110, 130, 0.28)';
  for (const sx of eyes === 'none' ? [] : [-1, 1]) {
    ctx.beginPath(); ctx.ellipse(FACE_W / 2 + sx * 142, 276, anime ? 44 : 40, anime ? 24 : 22, 0, 0, Math.PI * 2); ctx.fill();
    if (anime) {
      ctx.strokeStyle = 'rgba(232, 80, 110, 0.55)';
      ctx.lineWidth = 4;
      ctx.lineCap = 'round';
      for (let i = -1; i <= 1; i++) {
        const bx = FACE_W / 2 + sx * 142 + i * 15;
        ctx.beginPath(); ctx.moveTo(bx + 5, 266); ctx.lineTo(bx - 5, 286); ctx.stroke();
      }
    }
  }
  for (const sx of [-1, 1]) drawEye(ctx, FACE_W / 2 + sx * EYE_X, EYE_Y, closed ? 'closed' : eyes, eyeColor, sx);
  // Брови - в цвет волос, так цвет волос виден и без причёски.
  // У аниме-глаз тонкие и высокие, у хитрых - домиком наоборот
  if (eyes !== 'star' && eyes !== 'none') {
    ctx.strokeStyle = darker(hairColor, 0.7);
    ctx.lineWidth = anime ? 8 : 12;
    ctx.lineCap = 'round';
    const low = eyes === 'big' ? 86 : anime ? 92 : 72;
    const high = eyes === 'big' ? 98 : anime ? 102 : 84;
    const half = anime ? 30 : 34;
    const tilt = eyes === 'sly' ? 10 : 0;   // внутренний конец брови ниже
    for (const sx of [-1, 1]) {
      const bx = FACE_W / 2 + sx * EYE_X;
      ctx.beginPath();
      ctx.moveTo(bx - sx * half, EYE_Y - low + 6 + tilt);
      ctx.quadraticCurveTo(bx, EYE_Y - high, bx + sx * half, EYE_Y - low + 6 - tilt * 0.6);
      ctx.stroke();
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  faceTextures.set(key, texture);
  return texture;
}

// Где на лице светятся глаза (см. setEyesGlow): радужка и блик - белые,
// всё остальное - чёрное, не светится
const glowTextures = new Map();
function eyesGlowTexture(eyes) {
  if (glowTextures.has(eyes)) return glowTextures.get(eyes);
  const canvas = document.createElement('canvas');
  canvas.width = FACE_W;
  canvas.height = FACE_H;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, FACE_W, FACE_H);
  for (const sx of [-1, 1]) {
    const x = FACE_W / 2 + sx * EYE_X;
    if (eyes === 'happy') {
      // Глаза-дужки светятся целиком
      ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 16; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.arc(x, EYE_Y + 14, 34, Math.PI * 1.1, Math.PI * 1.9); ctx.stroke();
    } else {
      drawEye(ctx, x, EYE_Y, eyes, '#ffffff', sx);
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  glowTextures.set(eyes, texture);
  return texture;
}

// ------------------------------------------------------------------ части тела

// Новые фасоны обуви: одна нога, x - где она. Голенище высоких сапог
// шире любых штанин - штаны заправлены внутрь
const SHOES = {
  // Высокие сапоги до колена на небольшом каблуке
  knee_boots(g, item, skin, x) {
    const leather = mat(item.color, { rough: 0.45, metal: 0.05 });
    const dark = mat(shade(item.color, 0.5));
    box(g, 0.2, 0.05, 0.31, dark, x, 0.155, 0.03, 0.02);
    box(g, 0.08, 0.06, 0.08, dark, x, 0.18, -0.09, 0.015);
    box(g, 0.19, 0.12, 0.28, leather, x, 0.23, 0.02, 0.06);
    box(g, 0.215, 0.4, 0.245, leather, x, 0.45, -0.005, 0.08);
    box(g, 0.222, 0.04, 0.252, mat(shade(item.color, 0.8), { rough: 0.45 }), x, 0.63, -0.005, 0.015);
  },

  // Берцы: толстая подошва, шнуровка крест-накрест, люверсы
  combat(g, item, skin, x) {
    const leather = mat(item.color, { rough: 0.5 });
    const sole = mat(shade(item.color, 0.55), { rough: 0.9 });
    const lace = mat(item.accent || '#d9d5cc');
    const metal = mat('#a7a9b0', { metal: 0.6, rough: 0.3 });
    box(g, 0.225, 0.075, 0.34, sole, x, 0.168, 0.03, 0.025);
    box(g, 0.205, 0.15, 0.3, leather, x, 0.27, 0.02, 0.06);
    box(g, 0.215, 0.22, 0.245, leather, x, 0.42, -0.005, 0.06);
    box(g, 0.22, 0.04, 0.25, mat(shade(item.color, 0.75)), x, 0.53, -0.005, 0.015);
    for (let i = 0; i < 4; i++) {
      const y = 0.32 + i * 0.05;
      for (const d of [-1, 1]) {
        const strip = box(g, 0.1, 0.012, 0.008, lace, x, y + 0.012, 0.127, 0.003);
        strip.rotation.z = d * 0.35;
        sphere(g, 0.01, metal, x + d * 0.045, y, 0.125, 6);
      }
    }
  },

  // Туфли на каблуке: открытый подъём, лакированный носок, тонкий каблук
  heels(g, item, skin, x) {
    const gloss = mat(item.color, { rough: 0.22, metal: 0.1 });
    box(g, 0.14, 0.09, 0.22, mat(skin), x, 0.24, 0.02, 0.045);
    const shoe = box(g, 0.17, 0.08, 0.3, gloss, x, 0.19, 0.03, 0.04);
    shoe.rotation.x = 0.12;
    cylinder(g, 0.022, 0.016, 0.1, gloss, x, 0.18, -0.1, 8);
    box(g, 0.15, 0.02, 0.03, gloss, x, 0.27, 0.06, 0.008);   // ремешок
  },

  // Лоферы: блестящие, с поперечной перемычкой, и белые носки
  loafers(g, item, skin, x) {
    const leather = mat(item.color, { rough: 0.32, metal: 0.08 });
    box(g, 0.2, 0.04, 0.31, mat(shade(item.color, 0.5)), x, 0.15, 0.03, 0.015);
    box(g, 0.18, 0.1, 0.28, leather, x, 0.215, 0.02, 0.045);
    box(g, 0.186, 0.025, 0.06, mat(shade(item.color, 0.7)), x, 0.25, 0.07, 0.008);
    box(g, 0.15, 0.13, 0.17, mat(item.accent || '#f4f1ea', { rough: 0.95 }), x, 0.31, -0.01, 0.05);
  },

  // Угги: замшевые, мягкие, с мехом по краю
  uggs(g, item, skin, x) {
    const suede = mat(item.color, { rough: 1 });
    const fur = furCloth(item.accent || '#f1e6d2');
    box(g, 0.21, 0.04, 0.32, mat(shade(item.color, 0.6)), x, 0.15, 0.03, 0.015);
    box(g, 0.22, 0.32, 0.3, suede, x, 0.31, 0.01, 0.1);
    box(g, 0.24, 0.07, 0.31, fur, x, 0.47, 0, 0.03);
    box(g, 0.02, 0.26, 0.02, mat(shade(item.color, 0.8)), x, 0.3, -0.15, 0.005);   // шов сзади
  },
};

// Обувь: подошва на высоте SOLE
function buildShoes(g, item, skin) {
  const color = item ? item.color : '#f4f1ea';
  const accent = item && item.accent ? item.accent : shade(color, 0.7);
  const style = item ? item.style : 'sneakers';
  for (const s of [-1, 1]) {
    const x = s * 0.12;
    if (SHOES[style]) {
      SHOES[style](g, item, skin, x);
    } else if (style === 'bare') {
      // Ступня манекена
      box(g, 0.18, 0.12, 0.3, mat(skin, { rough: 0.35 }), x, 0.19, 0.03, 0.055);
    } else if (style === 'boots') {
      box(g, 0.2, 0.05, 0.31, mat(shade(color, 0.45)), x, 0.155, 0.03, 0.02);
      box(g, 0.19, 0.26, 0.26, mat(color), x, 0.3, 0.01, 0.06);
      box(g, 0.2, 0.04, 0.2, mat(shade(color, 0.7)), x, 0.41, -0.01, 0.02);
    } else if (style === 'sandals') {
      box(g, 0.19, 0.04, 0.3, mat(color), x, 0.15, 0.03, 0.02);
      box(g, 0.15, 0.08, 0.24, mat(skin), x, 0.2, 0.03, 0.04);
      box(g, 0.17, 0.03, 0.05, mat(shade(color, 0.7)), x, 0.215, 0.1, 0.01);
      box(g, 0.17, 0.03, 0.05, mat(shade(color, 0.7)), x, 0.225, -0.02, 0.01);
    } else if (style === 'slippers') {
      box(g, 0.22, 0.13, 0.33, mat(color, { rough: 0.95 }), x, 0.19, 0.04, 0.06);
      // Заячьи ушки на носках тапочек
      for (const e of [-1, 1]) {
        const ear = capsule(g, 0.025, 0.08, mat(color, { rough: 0.95 }), x + e * 0.04, 0.3, 0.12);
        ear.rotation.z = e * 0.3;
      }
    } else if (style === 'cat_slippers') {
      // Пушистые тапочки с кошачьей мордочкой, над ними - носки цвета accent
      const fur = mat(color, { rough: 0.97 });
      box(g, 0.22, 0.14, 0.33, fur, x, 0.195, 0.04, 0.068);
      cylinder(g, 0.066, 0.07, 0.11, mat(item.accent || '#f08a55', { rough: 0.95 }), x, 0.3, -0.01, 16);
      for (const e of [-1, 1]) {
        sphere(g, 0.016, mat('#2a1f1a', { rough: 0.4 }), x + e * 0.045, 0.235, 0.19, 8);
        const ear = cone(g, 0.04, 0.07, fur, x + e * 0.06, 0.28, 0.1, 10);
        ear.rotation.z = e * -0.25;
      }
      sphere(g, 0.014, mat('#ff8fa8'), x, 0.215, 0.205, 8);
    } else {
      box(g, 0.2, 0.05, 0.31, mat('#f4f1ea'), x, 0.155, 0.03, 0.02);
      box(g, 0.18, 0.12, 0.26, mat(color), x, 0.23, 0.01, 0.05);
      box(g, 0.185, 0.03, 0.12, mat(accent), x, 0.21, 0.02, 0.01);
    }
  }
}

// Юбка в складку: конус без дна, по краю - складки (радиус то больше, то
// меньше). wave - оборка: край не в складку, а волной
function pleatedGeometry(top, bottom, height, pleats, depth, wave = false) {
  return cached(`pleats|${top}|${bottom}|${height}|${pleats}|${depth}|${wave}`, () => {
    const geometry = new THREE.CylinderGeometry(top, bottom, height, pleats * 2, 4, true);
    const position = geometry.getAttribute('position');
    for (let i = 0; i < position.count; i++) {
      const x = position.getX(i), y = position.getY(i), z = position.getZ(i);
      const angle = Math.atan2(x, z);
      const t = 0.5 - y / height;   // 0 - у пояса, 1 - у подола
      const k = wave ? 1 + depth * Math.sin(angle * pleats) * t
        : 1 + depth * (Math.round(((angle + Math.PI) / (Math.PI * 2)) * pleats * 2) % 2 ? 1 : -1) * (0.3 + 0.7 * t);
      position.setX(i, x * k);
      position.setZ(i, z * k);
    }
    geometry.computeVertexNormals();
    return geometry;
  });
}

// Ноги без штанов: голые или в колготках/гольфах
function bareLegs(g, material, top = 0.71, bottom = 0.25) {
  for (const s of [-1, 1]) box(g, 0.14, top - bottom, 0.16, material, s * 0.11, (top + bottom) / 2, 0, 0.05);
}

// Пояс с пряжкой
function belt(g, material, buckle, y = 0.8, width = 0.47) {
  box(g, width, 0.06, 0.31, material, 0, y, 0, 0.025);
  if (buckle) box(g, 0.06, 0.05, 0.02, buckle, 0, y, 0.157, 0.006);
}

const BOTTOMS = {
  // Клетчатая юбка в складку, гольфы и ремень с цепочкой
  plaid(g, item, skin) {
    bareLegs(g, mat(skin));
    for (const s of [-1, 1]) box(g, 0.15, 0.2, 0.17, mat(item.accent || '#1e1b22', { rough: 0.9 }), s * 0.11, 0.37, 0, 0.05);
    const skirt = place(g, pleatedGeometry(0.245, 0.34, 0.3, 12, 0.06), tartanCloth(item.color, item.accent || '#1e1b22'), 0, 0.64, 0);
    skirt.material.side = THREE.DoubleSide;
    const metal = mat('#c7c9cf', { metal: 0.7, rough: 0.25 });
    belt(g, mat('#1a181d', { rough: 0.5 }), metal, 0.79, 0.5);
    for (let i = 0; i < 5; i++) {
      const link = torus(g, 0.018, 0.005, metal, 0.12 + i * 0.03, 0.73 - Math.sin((i / 4) * Math.PI) * 0.05, 0.19);
      link.rotation.y = i % 2 ? Math.PI / 2 : 0;
    }
  },

  // Кожаная юбка-карандаш до колена: узкая, блестит
  pencil(g, item, skin) {
    bareLegs(g, mat(skin), 0.5);
    const leather = mat(item.color, { rough: 0.3, metal: 0.12 });
    const skirt = cylinder(g, 0.245, 0.215, 0.38, leather, 0, 0.62, 0, 28);
    skirt.scale.z = 0.72;
    const waist = cylinder(g, 0.248, 0.248, 0.05, mat(shade(item.color, 0.7), { rough: 0.35, metal: 0.12 }), 0, 0.79, 0, 28);
    waist.scale.z = 0.73;
    box(g, 0.012, 0.12, 0.01, mat(shade(item.color, 0.5)), 0, 0.49, -0.158, 0.003);   // разрез сзади
  },

  // Пышная юбка с оборками в три яруса и кружевом по краю, тёмные колготки
  ruffle(g, item, skin) {
    bareLegs(g, mat(item.accent || '#2c2933', { rough: 0.5 }));
    const cloth = twoSided(item.color, 0.8);
    const lace = twoSided(shade(item.color, 1.22), 0.9);
    const tiers = [[0.24, 0.31, 0.15, 0.755], [0.29, 0.37, 0.14, 0.635], [0.34, 0.43, 0.14, 0.52]];
    for (const [top, bottom, height, y] of tiers) {
      place(g, pleatedGeometry(top, bottom, height, 10, 0.07, true), cloth, 0, y, 0);
      place(g, pleatedGeometry(bottom, bottom + 0.012, 0.025, 10, 0.07, true), lace, 0, y - height / 2 - 0.01, 0);
    }
    belt(g, mat(shade(item.color, 0.7), { rough: 0.5 }), null, 0.8, 0.5);
    neckBow(g, mat(shade(item.color, 0.7), { rough: 0.5 }), { y: 0.8, z: 0.17, size: 0.8 });
  },

  // Брюки карго: широкие, с накладными карманами на бёдрах и манжетами
  cargo(g, item, skin) {
    const cloth = mat(item.color, { rough: 0.9 });
    const dark = mat(shade(item.color, 0.75));
    for (const s of [-1, 1]) {
      const x = s * 0.115;
      box(g, 0.2, 0.52, 0.23, cloth, x, 0.52, 0, 0.06);
      box(g, 0.035, 0.13, 0.12, cloth, x + s * 0.112, 0.54, 0, 0.012);
      box(g, 0.037, 0.03, 0.125, dark, x + s * 0.113, 0.6, 0, 0.006);
      box(g, 0.2, 0.05, 0.235, dark, x, 0.28, 0, 0.02);
    }
    belt(g, mat('#1a181d', { rough: 0.5 }), mat('#c7c9cf', { metal: 0.7, rough: 0.25 }), 0.79, 0.49);
  },

  // Длинная юбка в мелкую складку - до щиколоток
  pleated(g, item, skin) {
    bareLegs(g, mat(skin), 0.4);
    const skirt = place(g, pleatedGeometry(0.245, 0.33, 0.48, 16, 0.045), twoSided(item.color, 0.75), 0, 0.575, 0);
    skirt.castShadow = true;
    belt(g, mat(shade(item.color, 0.7), { rough: 0.6 }), null, 0.8, 0.5);
  },
};

// Ноги от 0.26 до 0.78
function buildBottom(g, item, skin) {
  const color = item ? item.color : '#3d5a8a';
  const style = item ? item.style : 'jeans';
  if (BOTTOMS[style]) {
    BOTTOMS[style](g, item, skin);
    return;
  }
  const legY = 0.52, legH = 0.52;
  for (const s of [-1, 1]) {
    const x = s * 0.11;
    if (style === 'shorts') {
      box(g, 0.19, 0.24, 0.22, mat(color), x, 0.66, 0, 0.05);
      box(g, 0.14, 0.34, 0.16, mat(skin), x, 0.42, 0, 0.05);
    } else if (style === 'skirt') {
      box(g, 0.14, 0.46, 0.16, mat(skin), x, 0.48, 0, 0.05);
    } else if (style === 'bare') {
      box(g, 0.16, 0.56, 0.19, mat(skin, { rough: 0.35 }), x, 0.52, 0, 0.07);
    } else if (style === 'stars') {
      // Штанины чуть короче - из-под них видны щиколотки (и носки).
      // Сбоку - жёлтые лампасы
      box(g, 0.19, 0.46, 0.22, starCloth(color, item.accent || '#f2c84b'), x, 0.56, 0, 0.06);
      box(g, 0.02, 0.42, 0.05, mat(item.accent || '#f2c84b', { rough: 0.5 }), x + s * 0.096, 0.57, 0, 0.008);
      cylinder(g, 0.058, 0.062, 0.1, mat(skin), x, 0.3, -0.01, 14);
    } else {
      box(g, 0.18, legH, 0.21, mat(color), x, legY, 0, 0.06);
      if (style === 'sweatpants') {
        box(g, 0.2, 0.06, 0.22, mat(shade(color, 0.7)), x, 0.3, 0, 0.02);
        box(g, 0.02, legH * 0.8, 0.215, mat('#f4f1ea'), x + s * 0.09, legY + 0.03, 0, 0.005);
      }
    }
  }
  if (style === 'skirt') {
    cylinder(g, 0.25, 0.36, 0.34, mat(color), 0, 0.64, 0, 28);
  } else if (style === 'bare') {
    box(g, 0.42, 0.14, 0.27, mat(skin, { rough: 0.35 }), 0, 0.78, 0, 0.06);
  } else {
    // Пояс
    box(g, 0.46, 0.08, 0.3, mat(shade(color, style === 'jeans' ? 0.75 : 0.85)), 0, 0.78, 0, 0.03);
    if (style === 'jeans') box(g, 0.08, 0.06, 0.02, mat('#d9b44a', { metal: 0.5, rough: 0.35 }), 0, 0.78, 0.155, 0.01);
  }
}

// Руки: плечо, рукав, кисть. kind - какой рукав: long - длинный,
// short - короткий, puffy - пышный рукав-фонарик с манжетой, puffy_long -
// пышный у плеча и длинный до запястья, bell - широкий книзу; без sleeve -
// голые руки. sleeve - цвет или материал ткани. cuff - манжета (цвет или
// материал), fat - рукав потолще (плюшевая куртка). Руки - в
// g.userData.arms: ими можно помахать (продавец в магазине)
function buildArms(g, sleeve, skin, kind, { cuff = null, fat = false } = {}) {
  const arms = [];
  const cloth = sleeve && (sleeve.isMaterial ? sleeve : mat(sleeve));
  const band = cuff && (cuff.isMaterial ? cuff : mat(cuff));
  const wide = ['puffy', 'puffy_long', 'bell'].includes(kind) || fat;
  for (const s of [-1, 1]) {
    const arm = new THREE.Group();
    arm.position.set(s * 0.3, 1.17, 0);
    arm.rotation.z = s * (wide ? 0.2 : 0.13);
    g.add(arm);
    if (cloth && kind === 'puffy') {
      const puff = sphere(arm, 0.5, cloth, 0, -0.2, 0, 14);
      puff.scale.set(0.27, 0.47, 0.28);
      cylinder(arm, 0.07, 0.074, 0.07, cloth, 0, -0.41, 0.005, 16);
    } else if (cloth && kind === 'puffy_long') {
      const puff = sphere(arm, 0.5, cloth, 0, -0.1, 0, 14);
      puff.scale.set(0.26, 0.3, 0.27);
      box(arm, 0.13, 0.26, 0.14, cloth, 0, -0.29, 0, 0.055);
    } else if (cloth && kind === 'bell') {
      box(arm, 0.15, 0.24, 0.16, cloth, 0, -0.12, 0, 0.06);
      cylinder(arm, 0.08, 0.13, 0.22, cloth, 0, -0.32, 0, 18);
    } else if (cloth && kind === 'long') {
      box(arm, fat ? 0.17 : 0.14, 0.44, fat ? 0.18 : 0.15, cloth, 0, -0.2, 0, fat ? 0.08 : 0.06);
    } else if (cloth) {
      box(arm, 0.155, 0.17, 0.165, cloth, 0, -0.07, 0, 0.06);
      box(arm, 0.12, 0.3, 0.13, mat(skin), 0, -0.26, 0, 0.055);
    } else {
      box(arm, 0.12, 0.44, 0.13, mat(skin), 0, -0.2, 0, 0.055);
    }
    if (band) {
      const bell = kind === 'bell';
      cylinder(arm, bell ? 0.13 : fat ? 0.092 : 0.078, bell ? 0.135 : fat ? 0.094 : 0.08, 0.05, band,
        0, bell ? -0.425 : -0.405, 0, 16);
    }
    sphere(arm, 0.075, mat(skin), 0, -0.45, 0.01, 10);
    arms.push(arm);
  }
  g.userData.arms = arms;
}

// ------------------------------------------------------------------ верх: новые фасоны

// Треугольный вырез спереди (сорочка или майка под пиджаком): плоский
// треугольник на передней стенке туловища от top вниз до bottom
function vNeck(g, material, top, bottom, width, z) {
  const geometry = cached(`v|${top}|${bottom}|${width}`, () => {
    const shape = new THREE.Shape();
    shape.moveTo(-width / 2, top);
    shape.lineTo(width / 2, top);
    shape.lineTo(0, bottom);
    shape.closePath();
    return new THREE.ShapeGeometry(shape);
  });
  return place(g, geometry, material, 0, 0, z);
}

// Лацканы вдоль выреза: полоски от краёв выреза вниз к его острию
function lapels(g, material, top, bottom, width, z, thick = 0.05) {
  const length = Math.hypot(width / 2, top - bottom);
  const angle = Math.atan2(width / 2, top - bottom);
  for (const s of [-1, 1]) {
    const lapel = box(g, thick, length, 0.014, material, s * (width / 4 + thick * 0.45), (top + bottom) / 2, z + 0.006, 0.006);
    lapel.rotation.z = -s * angle;
  }
}

// Пуговицы столбиком по середине: ys - высоты
function buttons(g, material, ys, z, x = 0, radius = 0.016) {
  for (const y of ys) sphere(g, radius, material, x, y, z, 8);
}

// Бант на шее: петли, узелок, у ленты - хвостики
function neckBow(g, material, { y = 1.2, z = 0.16, size = 1, tails = false } = {}) {
  for (const s of [-1, 1]) {
    const loop = sphere(g, 0.5, material, s * 0.045 * size, y, z, 10);
    loop.scale.set(0.085 * size, 0.055 * size, 0.03);
    loop.rotation.z = s * 0.2;
    if (tails) {
      const tail = box(g, 0.03 * size, 0.09 * size, 0.012, material, s * 0.025 * size, y - 0.06 * size, z - 0.004, 0.004);
      tail.rotation.z = s * 0.3;
    }
  }
  sphere(g, 0.02 * size, material, 0, y, z + 0.012, 8);
}

// Пиджак: школьный (с бантом) или смокинг (атласные лацканы и бабочка).
// color - сукно, accent - сорочка, trim - бант или бабочка
function buildSuit(g, item, skin, tuxedo) {
  const cloth = mat(item.color, { rough: tuxedo ? 0.55 : 0.82 });
  const shirt = mat(item.accent || '#f6f3ee', { rough: 0.7 });
  const z = 0.157;
  box(g, 0.47, 0.5, 0.31, cloth, 0, 1.0, 0, 0.06);
  box(g, 0.49, 0.1, 0.32, cloth, 0, 0.78, 0, 0.04);   // полы чуть шире
  vNeck(g, shirt, 1.235, 0.98, 0.17, z);
  // Сорочка у горла и воротничок
  box(g, 0.17, 0.04, 0.27, shirt, 0, 1.235, 0, 0.015);
  const lapel = tuxedo ? mat(item.trim || '#0f0e12', { rough: 0.22, metal: 0.1 }) : mat(shade(item.color, 0.8));
  lapels(g, lapel, 1.235, 0.98, 0.17, z, tuxedo ? 0.055 : 0.048);
  const button = tuxedo ? lapel : mat('#d9b44a', { metal: 0.55, rough: 0.35 });
  buttons(g, button, tuxedo ? [0.94] : [0.93, 0.85], z + 0.004, 0, 0.017);
  // Карманы: клапаны внизу, нагрудный - платок у смокинга, эмблема у школьного
  for (const s of [-1, 1]) box(g, 0.12, 0.022, 0.012, mat(shade(item.color, 0.75)), s * 0.14, 0.86, z + 0.003, 0.005);
  if (tuxedo) {
    box(g, 0.07, 0.035, 0.012, shirt, 0.13, 1.1, z + 0.003, 0.005);
    neckBow(g, mat(item.trim || '#0f0e12', { rough: 0.3 }), { y: 1.2, z: z + 0.01, size: 0.85 });
  } else {
    const badge = cylinder(g, 0.028, 0.028, 0.008, mat('#d9b44a', { metal: 0.55, rough: 0.35 }), 0.13, 1.08, z + 0.003, 14);
    badge.rotation.x = Math.PI / 2;
    neckBow(g, mat(item.trim || '#c9303c', { rough: 0.55 }), { y: 1.2, z: z + 0.01, size: 1.15, tails: true });
  }
  buildArms(g, cloth, skin, 'long', { cuff: shirt });
}

const TOPS = {
  // Бомбер: блестящая стёганая ткань, резинка на поясе, у горла и на
  // манжетах, молния и кармашек на рукаве
  bomber(g, item, skin) {
    const body = mat(item.color, { rough: 0.5 });
    const rib = knitCloth(item.accent);
    box(g, 0.5, 0.44, 0.33, body, 0, 1.03, 0, 0.13);
    box(g, 0.47, 0.08, 0.31, rib, 0, 0.8, 0, 0.035);
    const collar = torus(g, 0.12, 0.04, rib, 0, 1.245, 0.01);
    collar.rotation.x = Math.PI / 2;
    box(g, 0.11, 0.07, 0.02, mat('#f4f1ea'), 0, 1.19, 0.158, 0.01);
    box(g, 0.014, 0.38, 0.012, mat('#c7c9cf', { metal: 0.6, rough: 0.3 }), 0, 1.0, 0.168, 0.004);
    buildArms(g, body, skin, 'long', { cuff: rib });
    const arm = g.userData.arms[1];
    box(arm, 0.02, 0.09, 0.08, mat(shade(item.color, 0.8)), 0.073, -0.12, 0, 0.008);
    box(arm, 0.022, 0.012, 0.03, mat('#c7c9cf', { metal: 0.6, rough: 0.3 }), 0.075, -0.09, 0, 0.003);
  },

  // Варсити: шерстяной корпус, кожаные рукава другого цвета, полосатая
  // резинка, кнопки и большая буква на груди
  varsity(g, item, skin) {
    const body = mat(item.color, { rough: 0.9 });
    const leather = mat(item.accent, { rough: 0.45 });
    const rib = pattern(`varsity-rib|${item.color}|${item.accent}`, 32, 32, (ctx, w, h) => {
      ctx.fillStyle = item.color;
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = item.accent;
      ctx.fillRect(0, 9, w, 5);
      ctx.fillRect(0, 19, w, 5);
    });
    box(g, 0.48, 0.46, 0.32, body, 0, 1.02, 0, 0.12);
    box(g, 0.47, 0.08, 0.31, rib, 0, 0.8, 0, 0.035);
    const collar = torus(g, 0.12, 0.04, rib, 0, 1.245, 0.01);
    collar.rotation.x = Math.PI / 2;
    buttons(g, leather, [0.88, 0.97, 1.06, 1.15], 0.163, 0, 0.017);
    const patch = place(g, cached('patch', () => new THREE.PlaneGeometry(0.15, 0.15)), letterPatch('Л', item.accent, shade(item.color, 0.5)),
      0.12, 1.09, 0.164);
    patch.castShadow = false;
    buildArms(g, leather, skin, 'long', { cuff: rib });
  },

  blazer(g, item, skin) {
    buildSuit(g, item, skin, false);
  },

  tuxedo(g, item, skin) {
    buildSuit(g, item, skin, true);
  },

  // Кардиган: вязаный, с V-вырезом и пуговицами, под ним - светлая майка
  cardigan(g, item, skin) {
    const knit = knitCloth(item.color);
    const inner = mat(item.accent);
    box(g, 0.48, 0.47, 0.31, knit, 0, 1.0, 0, 0.06);
    vNeck(g, inner, 1.225, 1.0, 0.18, 0.157);
    lapels(g, mat(shade(item.color, 0.88), { rough: 0.95 }), 1.225, 1.0, 0.18, 0.157, 0.035);
    box(g, 0.49, 0.06, 0.32, mat(shade(item.color, 0.88), { rough: 0.95 }), 0, 0.79, 0, 0.025);
    buttons(g, mat('#fbf6ee', { rough: 0.3 }), [0.84, 0.91, 0.97], 0.162, 0, 0.016);
    buildArms(g, knit, skin, 'long', { cuff: mat(shade(item.color, 0.88), { rough: 0.95 }) });
  },

  // Жилет с карманами поверх футболки: лямки через плечи, четыре кармана
  utility(g, item, skin) {
    const tee = mat(item.accent);
    const vest = mat(item.color, { rough: 0.8 });
    const dark = mat(shade(item.color, 0.7));
    box(g, 0.44, 0.48, 0.28, tee, 0, 1.0, 0, 0.1);
    box(g, 0.47, 0.4, 0.31, vest, 0, 0.97, 0, 0.06);
    vNeck(g, tee, 1.17, 1.02, 0.15, 0.157);
    for (const s of [-1, 1]) {
      box(g, 0.075, 0.06, 0.32, vest, s * 0.135, 1.2, 0, 0.02);   // лямка через плечо
      box(g, 0.1, 0.07, 0.02, vest, s * 0.115, 1.05, 0.162, 0.008);
      box(g, 0.1, 0.02, 0.022, dark, s * 0.115, 1.085, 0.163, 0.005);
      box(g, 0.13, 0.11, 0.024, vest, s * 0.12, 0.86, 0.163, 0.01);
      box(g, 0.13, 0.025, 0.026, dark, s * 0.12, 0.915, 0.164, 0.006);
    }
    box(g, 0.012, 0.36, 0.01, mat('#a7a9b0', { metal: 0.5, rough: 0.35 }), 0, 0.92, 0.161, 0.003);
    buildArms(g, item.accent, skin, 'short');
  },

  // Тренч: длинный, до колен, двубортный, с поясом и погонами
  trench(g, item, skin) {
    const cloth = mat(item.color, { rough: 0.8 });
    const dark = mat(item.accent || shade(item.color, 0.7));
    box(g, 0.48, 0.5, 0.32, cloth, 0, 1.0, 0, 0.07);
    box(g, 0.53, 0.5, 0.35, cloth, 0, 0.6, 0, 0.08);
    box(g, 0.012, 0.44, 0.012, dark, 0.03, 0.6, 0.176, 0.004);   // где полы сходятся
    box(g, 0.51, 0.06, 0.345, dark, 0, 0.86, 0, 0.02);           // пояс
    box(g, 0.06, 0.05, 0.02, mat('#c9a253', { metal: 0.55, rough: 0.35 }), 0.06, 0.86, 0.176, 0.006);
    vNeck(g, mat('#f2eee6'), 1.235, 1.04, 0.15, 0.162);
    lapels(g, cloth, 1.235, 1.04, 0.15, 0.162, 0.06);
    for (const s of [-1, 1]) {
      buttons(g, dark, [0.95, 1.06], 0.166, s * 0.09, 0.016);
      box(g, 0.1, 0.02, 0.07, cloth, s * 0.17, 1.245, 0, 0.008);   // погоны
    }
    buildArms(g, cloth, skin, 'long', { cuff: dark });
  },

  // Рубашка-батик: тёмная, в золотых завитках, с воротником и планкой
  batik(g, item, skin) {
    const cloth = batikCloth(item.color, item.accent);
    box(g, 0.46, 0.48, 0.3, cloth, 0, 1.0, 0, 0.08);
    box(g, 0.035, 0.44, 0.012, mat(item.color), 0, 0.99, 0.153, 0.004);
    buttons(g, mat(item.accent, { metal: 0.4, rough: 0.35 }), [0.84, 0.94, 1.04, 1.14], 0.161, 0, 0.012);
    for (const s of [-1, 1]) {
      const point = box(g, 0.09, 0.05, 0.02, mat(item.color), s * 0.055, 1.215, 0.15, 0.008);
      point.rotation.z = s * 0.5;
    }
    buildArms(g, cloth, skin, 'long', { cuff: mat(item.color) });
  },

  // Готический корсет: кружевная блузка с пышными рукавами, сверху -
  // корсет со шнуровкой, высокий кружевной воротник
  corset(g, item, skin) {
    const lace = laceCloth(item.color, item.accent);
    box(g, 0.44, 0.48, 0.28, lace, 0, 1.0, 0, 0.1);
    box(g, 0.47, 0.34, 0.31, lacingCloth(shade(item.color, 0.85), item.accent), 0, 0.93, 0, 0.07);
    // Острый мыс корсета книзу и косточки по бокам
    const point = cone(g, 0.07, 0.08, mat(shade(item.color, 0.85), { rough: 0.55 }), 0, 0.735, 0.13, 4);
    point.rotation.x = Math.PI;
    point.scale.z = 0.4;
    for (const s of [-1, 1]) box(g, 0.012, 0.3, 0.012, mat(item.accent, { metal: 0.5, rough: 0.35 }), s * 0.2, 0.93, 0.157, 0.004);
    const collar = cylinder(g, 0.1, 0.1, 0.07, lace, 0, 1.28, 0, 18);
    collar.scale.z = 0.95;
    for (let i = 0; i < 3; i++) {
      const frill = sphere(g, 0.5, lace, 0, 1.16 - i * 0.045, 0.15, 10);
      frill.scale.set(0.12 - i * 0.02, 0.05, 0.04);
    }
    buildArms(g, lace, skin, 'puffy_long', { cuff: mat(item.accent, { rough: 0.8 }) });
  },

  // Панк-топ: короткий, открывает живот; принт - череп и молнии, чокер с кольцом
  punk(g, item, skin) {
    box(g, 0.41, 0.2, 0.27, mat(skin), 0, 0.86, 0, 0.09);
    box(g, 0.46, 0.31, 0.3, mat(item.color, { rough: 0.85 }), 0, 1.085, 0, 0.1);
    const print = place(g, cached('punk-print', () => new THREE.PlaneGeometry(0.22, 0.22)), skullPrint(item.accent), 0, 1.07, 0.152);
    print.castShadow = false;
    const metal = mat('#c7c9cf', { metal: 0.7, rough: 0.25 });
    const choker = torus(g, 0.09, 0.018, mat('#18161b', { rough: 0.5 }), 0, 1.3, 0);
    choker.rotation.x = Math.PI / 2;
    torus(g, 0.022, 0.006, metal, 0, 1.275, 0.093);
    buildArms(g, null, skin, 'none');
    // Напульсники с шипами
    for (const arm of g.userData.arms) {
      cylinder(arm, 0.072, 0.074, 0.07, mat('#18161b', { rough: 0.5 }), 0, -0.37, 0, 14);
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2 + 0.4;
        const spike = cone(arm, 0.012, 0.03, metal, Math.sin(a) * 0.078, -0.37, Math.cos(a) * 0.078, 6);
        spike.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(Math.sin(a), 0, Math.cos(a)));
      }
    }
  },

  // Блузка с бантом: оборка у горла, планка с жемчужными пуговками и
  // защипами по бокам, пышные длинные рукава
  blouse(g, item, skin) {
    const cloth = mat(item.color, { rough: 0.85 });
    const tuck = mat(shade(item.color, 0.9));
    box(g, 0.45, 0.48, 0.29, cloth, 0, 1.0, 0, 0.1);
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      const frill = sphere(g, 0.5, cloth, Math.sin(a) * 0.11, 1.255, Math.cos(a) * 0.11, 8);
      frill.scale.set(0.07, 0.035, 0.07);
    }
    box(g, 0.05, 0.36, 0.012, tuck, 0, 0.98, 0.147, 0.004);
    buttons(g, mat('#fffaf2', { rough: 0.25 }), [0.86, 0.94, 1.02, 1.1], 0.155, 0, 0.011);
    for (const s of [-1, 1]) {
      for (const x of [0.06, 0.085, 0.11]) box(g, 0.008, 0.3, 0.008, tuck, s * x, 1.01, 0.146, 0.002);
    }
    neckBow(g, mat(item.accent, { rough: 0.5 }), { y: 1.2, z: 0.17, size: 1.05, tails: true });
    buildArms(g, cloth, skin, 'puffy_long', { cuff: mat(shade(item.color, 0.92)) });
  },

  // Плюшевая куртка: пушистое боа, джинсовые кокетка, воротник и карманы
  boa(g, item, skin) {
    const fur = furCloth(item.color);
    const denim = mat(item.accent, { rough: 0.9 });
    box(g, 0.53, 0.48, 0.35, fur, 0, 1.01, 0, 0.15);
    box(g, 0.5, 0.08, 0.33, denim, 0, 1.21, 0, 0.04);
    const collar = torus(g, 0.13, 0.045, denim, 0, 1.25, 0.01);
    collar.rotation.x = Math.PI / 2;
    vNeck(g, mat('#f4f1ea'), 1.2, 1.06, 0.12, 0.178);
    for (const s of [-1, 1]) box(g, 0.1, 0.08, 0.02, denim, s * 0.12, 1.06, 0.177, 0.01);
    buttons(g, mat('#c9a253', { metal: 0.55, rough: 0.35 }), [0.88, 0.97], 0.178, 0, 0.016);
    buildArms(g, fur, skin, 'long', { cuff: denim, fat: true });
  },

  // Вязаный жилет косами поверх белой рубашки с воротничком
  knit_vest(g, item, skin) {
    const shirt = mat(item.accent, { rough: 0.7 });
    box(g, 0.44, 0.48, 0.28, shirt, 0, 1.0, 0, 0.1);
    box(g, 0.47, 0.42, 0.31, cableCloth(item.color), 0, 0.97, 0, 0.06);
    vNeck(g, shirt, 1.18, 1.0, 0.17, 0.157);
    lapels(g, mat(shade(item.color, 0.85), { rough: 0.95 }), 1.18, 1.0, 0.17, 0.157, 0.03);
    box(g, 0.48, 0.05, 0.32, mat(shade(item.color, 0.85), { rough: 0.95 }), 0, 0.785, 0, 0.02);
    for (const s of [-1, 1]) {
      const point = box(g, 0.08, 0.05, 0.02, shirt, s * 0.05, 1.215, 0.15, 0.008);
      point.rotation.z = s * 0.55;
    }
    buildArms(g, shirt, skin, 'long', { cuff: shirt });
  },

  // Неоновая техно-куртка: просторная, с капюшоном за спиной; швы, молния,
  // край и свисающие стропы светятся
  neon(g, item, skin) {
    const cloth = mat(item.color, { rough: 0.68 });
    const line = glow(item.accent, 1.6);
    const pink = glow(item.trim || item.accent, 1.6);
    box(g, 0.53, 0.52, 0.35, cloth, 0, 0.99, 0, 0.1);
    box(g, 0.5, 0.12, 0.33, cloth, 0.02, 0.7, 0, 0.05);
    const hood = sphere(g, 0.5, cloth, 0, 1.28, -0.19, 16);
    hood.scale.set(0.5, 0.3, 0.3);
    const rim = torus(g, 0.15, 0.012, line, 0, 1.27, 0.01);
    rim.rotation.x = Math.PI / 2;
    const z = 0.177;
    box(g, 0.016, 0.56, 0.008, line, 0, 0.94, z, 0.003);
    for (const s of [-1, 1]) {
      const seam = box(g, 0.014, 0.3, 0.008, line, s * 0.12, 1.12, z, 0.003);
      seam.rotation.z = s * -0.7;
      box(g, 0.014, 0.2, 0.008, pink, s * 0.2, 0.85, z, 0.003);
    }
    box(g, 0.51, 0.014, 0.34, pink, 0.02, 0.645, 0, 0.004);
    for (const [x, length] of [[-0.14, 0.2], [0.17, 0.14], [0.05, 0.1]]) {
      box(g, 0.022, length, 0.008, x > 0 ? line : pink, x, 0.64 - length / 2, z - 0.004, 0.003);
    }
    buildArms(g, cloth, skin, 'bell', { cuff: line });
    for (const arm of g.userData.arms) box(arm, 0.012, 0.22, 0.012, pink, 0, -0.15, 0.081, 0.003);
  },
};

// Туловище от 0.76 до 1.24
function buildTop(g, item, skin) {
  const color = item ? item.color : '#4f7fe0';
  const accent = item && item.accent ? item.accent : shade(color, 1.35);
  const style = item ? item.style : 'tshirt';
  const torsoY = 1.0;
  if (TOPS[style]) {
    TOPS[style](g, item, skin);
  } else if (style === 'bare') {
    // Манекен: гладкое туловище без одежды
    box(g, 0.44, 0.48, 0.29, mat(skin, { rough: 0.35 }), 0, torsoY, 0, 0.12);
    buildArms(g, null, skin, 'none');
  } else if (style === 'jacket') {
    box(g, 0.44, 0.48, 0.28, mat(accent), 0, torsoY, 0, 0.1);
    for (const s of [-1, 1]) {
      box(g, 0.2, 0.5, 0.3, mat(color), s * 0.13, torsoY, 0, 0.08);
      const lapel = box(g, 0.08, 0.2, 0.02, mat(shade(color, 0.8)), s * 0.07, 1.14, 0.155, 0.01);
      lapel.rotation.z = s * -0.35;
    }
    buildArms(g, color, skin, 'long');
  } else if (style === 'cloud') {
    // Худи-облачко: свободное, короткое и нараспашку, под ним майка
    // цвета accent. Рукава-фонарики, большой капюшон, две тёмные завязки
    // и чокер на шее
    const cloth = cloudCloth(color);
    box(g, 0.4, 0.47, 0.27, mat(accent), 0, torsoY, 0, 0.1);
    box(g, 0.54, 0.42, 0.13, cloth, 0, 1.04, -0.1, 0.06);
    for (const s of [-1, 1]) box(g, 0.15, 0.43, 0.34, cloth, s * 0.205, 1.035, 0.005, 0.07);
    const hood = sphere(g, 0.5, cloth, 0, 1.21, -0.19, 16);
    hood.scale.set(0.5, 0.24, 0.3);
    const tie = mat('#3b3e4b', { rough: 0.6 });
    for (const s of [-1, 1]) {
      const band = box(g, 0.055, 0.25, 0.025, tie, s * 0.06, 1.1, 0.17, 0.012);
      band.rotation.z = s * 0.12;
      sphere(g, 0.032, tie, s * 0.075, 0.97, 0.172, 8);
    }
    const choker = torus(g, 0.088, 0.017, mat('#24222a', { rough: 0.45 }), 0, 1.27, 0);
    choker.rotation.x = Math.PI / 2;
    buildArms(g, cloth, skin, 'puffy');
  } else {
    box(g, style === 'tank' ? 0.42 : 0.46, 0.48, 0.3, mat(color), 0, torsoY, 0, 0.11);
    if (style === 'hoodie') {
      // Капюшон за шеей, карман-кенгуру и шнурки
      const hood = torus(g, 0.16, 0.07, mat(shade(color, 0.88)), 0, 1.24, -0.1);
      hood.rotation.x = Math.PI / 2 + 0.35;
      box(g, 0.3, 0.13, 0.03, mat(shade(color, 0.85)), 0, 0.86, 0.15, 0.02);
      for (const s of [-1, 1]) cylinder(g, 0.012, 0.012, 0.16, mat('#f4f1ea'), s * 0.06, 1.12, 0.155, 6);
      buildArms(g, color, skin, 'long');
    } else if (style === 'sweater') {
      box(g, 0.47, 0.08, 0.31, mat(accent), 0, 1.04, 0, 0.03);
      for (let i = -2; i <= 2; i++) box(g, 0.035, 0.035, 0.01, mat(color), i * 0.08, 1.04, 0.158, 0.005);
      const collar = torus(g, 0.1, 0.035, mat(shade(color, 0.8)), 0, 1.24, 0);
      collar.rotation.x = Math.PI / 2;
      buildArms(g, color, skin, 'long');
    } else if (style === 'tank') {
      buildArms(g, null, skin, 'none');
    } else {
      buildArms(g, color, skin, 'short');
    }
  }
  // Шея
  cylinder(g, 0.085, 0.09, 0.12, mat(skin), 0, 1.28, 0, 16);
}

// ------------------------------------------------------------------ голова

function buildHead(g, look, colors) {
  const head = new THREE.Group();
  head.position.set(0, HEAD_Y, 0);
  g.add(head);

  const shape = new THREE.Group();
  shape.scale.set(1, HEAD_SQUASH, 0.97);
  head.add(shape);
  sphere(shape, R, mat(colors.skin), 0, 0, 0, 20);
  for (const s of [-1, 1]) sphere(head, 0.075, mat(colors.skin), s * R * 0.97, -0.03, -0.01, 8);

  const eyes = look.eyes ? look.eyes.style : 'round';
  const faceMaterial = new THREE.MeshStandardMaterial({
    map: faceTexture(eyes, colors.eye, colors.hair), transparent: true, roughness: 0.6, depthWrite: false,
  });
  const face = new THREE.Mesh(
    cached('face', () => new THREE.SphereGeometry(R * 1.004, 40, 24, Math.PI / 2 - FACE_PHI, FACE_PHI * 2, FACE_THETA0, FACE_THETA)),
    faceMaterial,
  );
  face.renderOrder = 1;
  shape.add(face);
  // Глаза закрываются сменой картинки лица - см. setEyesClosed(). Материал
  // берём у самого лица: его могли заменить копией (двойник в мини-игре)
  g.userData.eyesClosed = false;
  g.userData.closeEyes = (closed) => {
    face.material.map = faceTexture(eyes, colors.eye, colors.hair, closed);
  };
  g.userData.face = face;
  g.userData.eyes = eyes;
  // «Счастливые» глаза-дужки и так почти закрыты - им моргать незачем
  g.userData.blinks = eyes !== 'happy';

  buildNose(head, look.nose, colors.skin);
  const hat = look.headwear;
  const covered = Boolean(hat && COVERING.has(hat.style));
  buildHair(head, look.hair ? look.hair.style : 'short', colors.hair, covered);
  // Ушки растут из-под волос, под шапкой их не видно
  if (look.ears && !covered) buildEars(head, look.ears, colors);
  if (hat) buildHeadwear(head, hat, colors, !look.hair || look.hair.style === 'bald');
  if (look.head_extra) buildHeadExtra(head, look.head_extra, hat, g);
}

// Кошачьи ушки - в цвет волос, внутри розовые (accent)
function buildEars(head, item, colors) {
  const outer = mat(colors.hair, { rough: 0.85 });
  const inner = mat(item.accent || '#ffb3c6', { rough: 0.9 });
  for (const s of [-1, 1]) {
    const ear = new THREE.Group();
    ear.position.set(s * 0.245, 0.31, -0.03);
    ear.rotation.set(-0.12, s * 0.2, s * -0.42);
    head.add(ear);
    const o = cone(ear, 0.14, 0.27, outer, 0, 0.1, 0, 18);
    o.scale.z = 0.5;
    const i = cone(ear, 0.085, 0.18, inner, 0, 0.075, 0.035, 18);
    i.scale.z = 0.3;
  }
}

// Над головой: нимб - светится и чуть парит; рожки - изогнутые, темнеют к концам.
// Нимб - в userData.halo (его можно покачивать)
function buildHeadExtra(head, item, hat, figure) {
  if (item.style === 'halo') {
    const high = hat && TALL_HATS.has(hat.style);
    const glowColor = new THREE.Color(item.accent || item.color).getHex();
    const ring = torus(head, 0.21, 0.03, mat(item.color, { emissive: glowColor, glow: 0.9, rough: 0.3, metal: 0.25 }),
      0, high ? 1.02 : 0.66, -0.05);
    ring.rotation.x = Math.PI / 2 - 0.3;
    figure.userData.halo = ring;
  } else if (item.style === 'horns') {
    const horn = vertexMat(0.38);
    for (const s of [-1, 1]) {
      strand(head, `horn|${s}|${item.color}|${item.accent}`,
        [[s * 0.15, 0.25, 0.17], [s * 0.2, 0.42, 0.14], [s * 0.25, 0.54, 0.04], [s * 0.26, 0.58, -0.09]],
        0.068, 0.008, horn, { colors: [item.color, item.accent || '#2c1452'], ease: 0.85 });
    }
  }
}

// Маска на лице - вместо носа. Это кусок сферы чуть больше головы: по
// горизонтали ±MASK_PHI от середины лица, по вертикали от MASK_THETA0 вниз
// на MASK_THETA. Сама маска, лямки к ушам и принт нарисованы на холсте, а
// всё вокруг них прозрачное
const MASK_PHI = 1.5;
const MASK_THETA0 = 0.5 * Math.PI;
const MASK_THETA = 0.35 * Math.PI;
const MASK_W = 512, MASK_H = 256;
// Холст растянут по горизонтали сильнее, чем по вертикали: принт рисуется
// сжатым по x, чтобы на лице кружки были кружками
const MASK_SQUEEZE = 0.81;

const maskX = (offset) => ((offset + MASK_PHI) / (MASK_PHI * 2)) * MASK_W;   // offset - радианы от середины лица
const maskY = (theta) => ((theta - MASK_THETA0) / MASK_THETA) * MASK_H;

function drawMaskPrint(ctx, print, ink) {
  ctx.save();
  ctx.translate(MASK_W / 2, 0);
  ctx.scale(MASK_SQUEEZE, 1);
  ctx.strokeStyle = ink;
  ctx.fillStyle = ink;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = 7;
  const mouth = (y, r = 14) => {
    ctx.beginPath(); ctx.arc(-r, y, r, 0.05, Math.PI - 0.15); ctx.stroke();
    ctx.beginPath(); ctx.arc(r, y, r, 0.15, Math.PI - 0.05); ctx.stroke();
  };
  const whiskers = (y) => {
    ctx.lineWidth = 5;
    for (const s of [-1, 1]) {
      for (let i = 0; i < 3; i++) {
        ctx.beginPath();
        ctx.moveTo(s * 62, y + i * 13);
        ctx.lineTo(s * 168, y - 18 + i * 22);
        ctx.stroke();
      }
    }
    ctx.lineWidth = 7;
  };
  if (print === 'kawaii') {
    // ˃ ω ˂ и румянец
    ctx.lineWidth = 8;
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(s * 62, 84); ctx.lineTo(s * 36, 100); ctx.lineTo(s * 62, 116);
      ctx.stroke();
    }
    ctx.lineWidth = 6;
    mouth(118, 11);
    ctx.fillStyle = 'rgba(255, 128, 160, 0.75)';
    for (const s of [-1, 1]) { ctx.beginPath(); ctx.ellipse(s * 96, 132, 22, 11, 0, 0, Math.PI * 2); ctx.fill(); }
    ctx.restore();
    return;
  }
  // Носик-сердечко или треугольник, от него вниз - ротик «ω»
  ctx.beginPath();
  if (print === 'cat') {
    ctx.moveTo(0, 96);
    ctx.bezierCurveTo(-30, 76, -18, 58, 0, 70);
    ctx.bezierCurveTo(18, 58, 30, 76, 0, 96);
  } else {
    ctx.moveTo(-16, 70); ctx.quadraticCurveTo(0, 64, 16, 70); ctx.lineTo(0, 90); ctx.closePath();
  }
  ctx.fill();
  ctx.beginPath(); ctx.moveTo(0, 92); ctx.lineTo(0, 104); ctx.stroke();
  mouth(104);
  whiskers(92);
  if (print === 'fangs') {
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(s * 10, 114); ctx.lineTo(s * 24, 112); ctx.lineTo(s * 18, 136); ctx.closePath(); ctx.fill();
    }
  } else if (print === 'tongue') {
    ctx.fillStyle = '#ff7f9f';
    ctx.beginPath();
    ctx.moveTo(-4, 116); ctx.lineTo(24, 114);
    ctx.bezierCurveTo(28, 146, -2, 150, -4, 116);
    ctx.fill();
    ctx.strokeStyle = '#d4566f';
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(11, 120); ctx.lineTo(11, 136); ctx.stroke();
  }
  ctx.restore();
}

function maskCloth(item) {
  const color = item.color || '#24232b', ink = item.accent || '#f4f1ea';
  return pattern(`mask|${item.print}|${color}|${ink}`, MASK_W, MASK_H, (ctx) => {
    const side = maskX(1.15), top = maskY(0.6 * Math.PI), low = maskY(0.74 * Math.PI);
    const eye = maskY(0.607 * Math.PI), bridge = maskY(0.548 * Math.PI), chin = maskY(0.835 * Math.PI);
    const left = MASK_W - side, mid = MASK_W / 2, under = maskX(0.32) - mid;
    // Лямки к ушам
    ctx.strokeStyle = hex(color, 0.8);
    ctx.lineWidth = 10;
    ctx.lineCap = 'round';
    for (const [x0, x1] of [[left, 0], [side, MASK_W]]) {
      ctx.beginPath(); ctx.moveTo(x0, top + 10); ctx.quadraticCurveTo((x0 + x1) / 2, top - 10, x1, 6); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x0, low - 8); ctx.quadraticCurveTo((x0 + x1) / 2, low - 30, x1, 44); ctx.stroke();
    }
    ctx.beginPath();
    ctx.moveTo(left, top);
    ctx.quadraticCurveTo(left + 90, top + 12, mid - under, eye);
    ctx.quadraticCurveTo(mid - 20, bridge + 4, mid, bridge);
    ctx.quadraticCurveTo(mid + 20, bridge + 4, mid + under, eye);
    ctx.quadraticCurveTo(side - 90, top + 12, side, top);
    ctx.lineTo(side, low);
    ctx.quadraticCurveTo(side - 60, chin, mid, chin);
    ctx.quadraticCurveTo(left + 60, chin, left, low);
    ctx.closePath();
    const gradient = ctx.createLinearGradient(0, bridge, 0, chin);
    gradient.addColorStop(0, hex(color, 1.25));
    gradient.addColorStop(0.25, color);
    gradient.addColorStop(1, hex(color, 0.8));
    ctx.fillStyle = gradient;
    ctx.fill();
    // Складка ткани посередине
    ctx.strokeStyle = hex(color, 0.75);
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(left + 20, (top + low) / 2 + 30); ctx.quadraticCurveTo(mid, chin - 30, side - 20, (top + low) / 2 + 30); ctx.stroke();
    drawMaskPrint(ctx, item.print, ink);
  }, 0.9, true);
}

function buildMask(head, item) {
  const shape = new THREE.Group();
  shape.scale.set(1, HEAD_SQUASH, 0.97);
  head.add(shape);
  const geometry = cached('mask', () => new THREE.SphereGeometry(R * 1.035, 48, 20, Math.PI / 2 - MASK_PHI, MASK_PHI * 2,
    MASK_THETA0, MASK_THETA));
  const mask = place(shape, geometry, maskCloth(item));
  mask.renderOrder = 2;
}

// Маска ниндзя: ткань обёрнута вокруг головы до самых глаз, сзади - узел
// с двумя хвостами
function buildNinjaMask(head, item) {
  const cloth = pattern(`ninja|${item.color}`, 256, 64, (ctx, w, h) => {
    ctx.fillStyle = item.color;
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = hex(item.color, 0.72);
    ctx.lineWidth = 2;
    for (const y of [20, 38, 52]) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.bezierCurveTo(w * 0.3, y + 6, w * 0.7, y - 6, w, y); ctx.stroke();
    }
    ctx.fillStyle = hex(item.color, 1.3);
    ctx.fillRect(0, 0, w, 3);
  });
  const shape = new THREE.Group();
  shape.scale.set(1, HEAD_SQUASH, 0.97);
  head.add(shape);
  place(shape, cached('ninja', () => new THREE.SphereGeometry(R * 1.045, 48, 14, 0, Math.PI * 2, 0.575 * Math.PI, 0.32 * Math.PI)), cloth);
  const knotMaterial = mat(item.accent || shade(item.color, 1.2), { rough: 0.85 });
  sphere(head, 0.055, knotMaterial, 0, -0.1, -0.43, 10);
  for (const s of [-1, 1]) {
    flatStrand(head, `ninja-tail|${s}`, [[s * 0.02, -0.1, -0.45], [s * 0.08, -0.22, -0.5], [s * 0.13, -0.38, -0.47]],
      0.05, 0.03, knotMaterial, [1, 1, 0.4], { segments: 10 });
  }
}

function buildNose(head, item, skin) {
  const style = item ? item.style : 'button';
  if (style === 'none') return;
  if (style === 'mask') return buildMask(head, item);
  if (style === 'ninja') return buildNinjaMask(head, item);
  const z = R * 0.95;
  const y = -0.07;
  if (style === 'dot') {
    sphere(head, 0.03, mat(shade(skin, 0.7)), 0, y, z + 0.005, 8);
  } else if (style === 'long') {
    const nose = cone(head, 0.06, 0.2, mat(shade(skin, 0.95)), 0, y, z + 0.08, 10);
    nose.rotation.x = Math.PI / 2;
  } else if (style === 'clown') {
    sphere(head, 0.085, mat('#e5302f', { rough: 0.35 }), 0, y, z + 0.03, 12);
  } else {
    sphere(head, 0.055, mat(shade(skin, 0.92)), 0, y, z + 0.01, 10);
  }
}

// Шапочка волос: наклонена назад - спереди открывает лоб, сзади ниже
function hairCap(head, color, thetaLength = 0.47 * Math.PI, radius = R * 1.07) {
  const cap = dome(head, radius, thetaLength, mat(color, { rough: 0.85 }), 0.015);
  cap.rotation.x = -0.42;
  cap.scale.set(1, HEAD_SQUASH, 1);
  return cap;
}

// Точка на передней части сферы радиуса r: x, y - куда, z - сам находит
const front = (x, y, r) => [x, y, Math.sqrt(Math.max(0, r * r - x * x - y * y))];

// Плоская прядь: трубка по точкам, сплющенная по одной из осей (flat -
// масштаб по x, y, z). Сплющивается вокруг своей середины, а не вокруг головы
function flatStrand(g, key, points, r0, r1, material, flat, options = {}) {
  const center = points.reduce((sum, p) => sum.map((v, i) => v + p[i] / points.length), [0, 0, 0]);
  const group = new THREE.Group();
  group.position.set(...center);
  group.scale.set(...flat);
  g.add(group);
  strand(group, key, points.map((p) => p.map((v, i) => v - center[i])), r0, r1, material, options);
  return group;
}

// Каре с чёлкой: пышный объём закрывает затылок и бока до подбородка,
// понизу - острые кончики. Лицо обрамляют плоские пряди с подвёрнутыми
// внутрь концами, по лбу - острые прядки чёлки
function buildBob(head, color, covered) {
  const hair = mat(color, { rough: 0.82 });
  hairCap(head, color, 0.52 * Math.PI, R * 1.09);
  const open = 0.98;   // половина выреза для лица, в радианах вокруг головы
  const curtain = place(head, cached('bob-curtain', () => new THREE.SphereGeometry(
    R * 1.1, 44, 20, Math.PI / 2 + open, Math.PI * 2 - open * 2, 0.2 * Math.PI, 0.56 * Math.PI)), hair, 0, -0.025, -0.01);
  curtain.scale.set(1.07, 1, 1.02);
  // Кончики по нижнему краю - каре слегка растрёпано
  const tips = 13;
  for (let i = 0; i < tips; i++) {
    const phi = Math.PI / 2 + open + 0.1 + (i / (tips - 1)) * (Math.PI * 2 - open * 2 - 0.2);
    const x = -Math.cos(phi) * R * 1.1 * 1.07 * 0.92, z = (Math.sin(phi) * R * 1.1 * 1.02 - 0.01) * 0.92;
    const height = 0.13 + (i % 3) * 0.03;
    const tip = cone(head, 0.08, height, hair, x, -0.3 - height * 0.42, z, 10);
    tip.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(x * 0.5, -1, z * 0.5).normalize());
  }
  for (const s of [-1, 1]) {
    // Пряди у лица: от виска до подбородка, концы подвёрнуты внутрь
    flatStrand(head, `bob-face-a|${s}`, [[s * 0.3, 0.26, 0.24], [s * 0.39, 0.06, 0.24], [s * 0.38, -0.17, 0.23], [s * 0.3, -0.3, 0.25]],
      0.095, 0.008, hair, [0.55, 1, 1]);
    flatStrand(head, `bob-face-b|${s}`, [[s * 0.38, 0.24, 0.12], [s * 0.45, 0.02, 0.13], [s * 0.44, -0.22, 0.14], [s * 0.37, -0.36, 0.16]],
      0.1, 0.01, hair, [0.6, 1, 1]);
  }
  if (covered) return;
  // Чёлка: x, длина, куда загибается кончик. Пробор чуть правее середины
  const bangs = [[-0.3, 0.17, -0.04], [-0.2, 0.21, -0.03], [-0.09, 0.23, -0.01], [0.04, 0.2, 0.04], [0.15, 0.22, 0.04], [0.27, 0.18, 0.05]];
  bangs.forEach(([x, length, curl], i) => {
    flatStrand(head, `bob-bang|${i}`,
      [front(x * 0.8, 0.33, 0.43), front(x * 0.97 + curl * 0.3, 0.25, 0.465), front(x * 1.03 + curl, 0.32 - length, 0.452)],
      0.088, 0.006, hair, [1, 1, 0.55], { segments: 12 });
  });
}

function buildHair(head, style, color, covered) {
  const hair = mat(color, { rough: 0.85 });
  if (style === 'bald') return;
  if (style === 'bob') {
    buildBob(head, color, covered);
    return;
  }
  if (style === 'mohawk') {
    if (covered) return hairCap(head, color, 0.36 * Math.PI);
    for (let i = 0; i < 6; i++) {
      const a = -0.95 + i * 0.4;
      const spike = box(head, 0.07, 0.24 - Math.abs(i - 2.5) * 0.02, 0.14, hair, 0, Math.cos(a) * R * 0.98 + 0.06, Math.sin(a) * R * 0.98, 0.03);
      spike.rotation.x = a;
    }
    return;
  }
  hairCap(head, color);
  // Чёлка - несколько прядок у края шапочки. Под шапкой её не видно
  if (style !== 'curly' && !covered) {
    [-0.16, 0, 0.16].forEach((x, i) => {
      const lock = sphere(head, 0.12, hair, x, 0.24 - (i === 1 ? 0.02 : 0), R * 0.66, 10);
      lock.scale.set(1.2, 0.6, 0.7);
    });
  }
  if (style === 'long') {
    box(head, R * 1.9, 0.62, 0.2, hair, 0, -0.24, -R * 0.62, 0.09);
    for (const s of [-1, 1]) box(head, 0.14, 0.5, 0.3, hair, s * R * 0.95, -0.22, -0.12, 0.06);
  } else if (style === 'ponytail') {
    // Высокий хвост торчит назад и вбок - его видно и спереди
    const tail = new THREE.Group();
    tail.position.set(0.05, 0.2, -R * 0.9);
    tail.rotation.set(1.05, 0.5, 0);
    head.add(tail);
    capsule(tail, 0.1, 0.36, hair, 0, -0.26, 0);
    const tie = torus(tail, 0.07, 0.03, mat('#e5484d'), 0, -0.02, 0);
    tie.rotation.x = Math.PI / 2;
  }
  if (covered) return;
  if (style === 'spiky') {
    const spikes = [[0, 1.0, 0.1], [0.5, 0.85, 0.3], [-0.5, 0.85, 0.3], [0.3, 0.8, -0.45], [-0.3, 0.8, -0.45], [0.75, 0.55, -0.1], [-0.75, 0.55, -0.1]];
    for (const [x, y, z] of spikes) {
      const dir = new THREE.Vector3(x, y, z).normalize();
      const spike = cone(head, 0.11, 0.34, hair, dir.x * R * 1.08, dir.y * R * HEAD_SQUASH * 1.08, dir.z * R * 1.08, 8);
      spike.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    }
  } else if (style === 'curly') {
    for (let i = 0; i < 22; i++) {
      const a = i * 2.399963;          // золотой угол - кудряшки ровно по всей голове
      const t = 0.18 + (i / 22) * 0.62;
      const y = Math.cos(t * Math.PI * 0.62);
      const r = Math.sqrt(1 - y * y);
      const z = Math.sin(a) * r;
      if (z > 0.55 && y < 0.75) continue; // лицо не закрываем
      sphere(head, 0.12, hair, Math.cos(a) * r * R * 1.02, y * R * HEAD_SQUASH * 1.02 + 0.03, z * R * 1.02, 8);
    }
  } else if (style === 'bun') {
    sphere(head, 0.15, hair, 0, R * 0.95, -0.14, 12);
    torus(head, 0.1, 0.025, mat(shade(color, 0.7)), 0, R * 0.86, -0.1).rotation.x = Math.PI / 2 + 0.4;
  }
}

// bald - волос нет: то, что лежит поверх причёски (бант, тиара), садится ниже
function buildHeadwear(head, item, colors, bald = false) {
  const lift = bald ? -0.045 : 0;
  const color = item.color || '#e5484d';
  const accent = item.accent || shade(color, 0.7);
  const m = mat(color);
  switch (item.style) {
    case 'cap': {
      // Кепка сидит повыше, козырёк смотрит вперёд и чуть вниз: сверху
      // его видно, а глаза под ним - тоже
      const d = dome(head, R * 1.1, 0.5 * Math.PI, m, 0.11);
      d.scale.set(1, 0.8, 1);
      const brim = box(head, 0.46, 0.04, 0.32, mat(shade(color, 0.85)), 0, 0.12, R * 1.08, 0.018);
      brim.rotation.x = 0.22;
      sphere(head, 0.04, mat(shade(color, 0.85)), 0, R * 0.88 + 0.11, 0, 8);
      break;
    }
    case 'beanie': {
      const d = dome(head, R * 1.13, 0.52 * Math.PI, m, 0.02);
      d.scale.set(1, 0.95, 1);
      const band = torus(head, R * 1.1, 0.06, mat(shade(color, 0.85)), 0, 0.03, 0);
      band.rotation.x = Math.PI / 2;
      sphere(head, 0.11, mat('#f4f1ea', { rough: 0.95 }), 0, R * 1.1 + 0.07, 0, 10);
      break;
    }
    case 'cowboy': {
      cylinder(head, 0.64, 0.64, 0.035, m, 0, 0.2, 0, 36);
      cylinder(head, 0.27, 0.32, 0.3, m, 0, 0.36, 0, 28);
      cylinder(head, 0.325, 0.325, 0.06, mat(shade(color, 0.5)), 0, 0.25, 0, 28);
      break;
    }
    case 'tophat': {
      cylinder(head, 0.44, 0.44, 0.035, m, 0, 0.26, 0, 36);
      cylinder(head, 0.27, 0.27, 0.46, m, 0, 0.5, 0, 32);
      cylinder(head, 0.275, 0.275, 0.07, mat(accent), 0, 0.32, 0, 32);
      break;
    }
    case 'crown': {
      const gold = mat(color, { metal: 0.55, rough: 0.3 });
      const y = R * 0.9;
      cylinder(head, 0.31, 0.29, 0.14, gold, 0, y, 0, 10);
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2;
        cone(head, 0.07, 0.2, gold, Math.sin(a) * 0.29, y + 0.16, Math.cos(a) * 0.29, 6);
        sphere(head, 0.045, mat(i % 2 ? '#4f7fe0' : accent, { rough: 0.25 }), Math.sin(a) * 0.31, y, Math.cos(a) * 0.31, 6);
      }
      break;
    }
    case 'headphones': {
      const band = torus(head, R * 1.12, 0.035, m, 0, 0.02, 0, Math.PI);
      band.rotation.z = 0;
      for (const s of [-1, 1]) {
        const cup = cylinder(head, 0.13, 0.13, 0.09, m, s * R * 1.08, -0.02, 0, 20);
        cup.rotation.z = Math.PI / 2;
        const pad = cylinder(head, 0.1, 0.1, 0.02, mat(accent, { emissive: new THREE.Color(accent).getHex(), glow: 0.35 }), s * R * 1.14, -0.02, 0, 20);
        pad.rotation.z = Math.PI / 2;
      }
      break;
    }
    case 'bunny': {
      torus(head, R * 1.08, 0.025, mat(accent), 0, 0.02, -0.05, Math.PI).rotation.z = 0;
      for (const s of [-1, 1]) {
        const ear = new THREE.Group();
        ear.position.set(s * 0.15, R * 0.9, -0.05);
        ear.rotation.z = s * -0.22;
        head.add(ear);
        capsule(ear, 0.075, 0.34, m, 0, 0.22, 0);
        const inner = capsule(ear, 0.04, 0.26, mat(accent), 0, 0.22, 0.05);
        inner.scale.z = 0.4;
      }
      break;
    }
    case 'flower': {
      // Цветок за ухом: лепестки вокруг жёлтой серединки, смотрит вперёд-вбок
      const flower = new THREE.Group();
      flower.position.set(0.3, 0.26, 0.2);
      flower.lookAt(new THREE.Vector3(0.9, 0.5, 1.2).add(flower.position));
      head.add(flower);
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        const petal = sphere(flower, 0.075, m, Math.cos(a) * 0.09, Math.sin(a) * 0.09, 0, 8);
        petal.scale.set(1, 1, 0.45);
      }
      sphere(flower, 0.055, mat('#ffd23f'), 0, 0, 0.03, 8);
      break;
    }
    case 'beret': {
      // Мягкий плоский блин, сдвинутый набок, ободок и хвостик сверху
      const beret = new THREE.Group();
      beret.position.set(0.04, R * 0.62, -0.03);
      beret.rotation.set(-0.12, 0, -0.24);
      head.add(beret);
      const top = sphere(beret, 0.5, mat(color, { rough: 0.97 }), 0, 0.05, 0, 20);
      top.scale.set(0.94, 0.3, 0.92);
      const band = torus(beret, R * 0.88, 0.035, mat(accent, { rough: 0.95 }), 0, -0.04, 0);
      band.rotation.x = Math.PI / 2;
      cylinder(beret, 0.012, 0.02, 0.07, mat(accent), 0, 0.22, 0, 8);
      break;
    }
    case 'witch': {
      // Широкие поля, высокий конус с заломом на конце, лента с пряжкой
      cylinder(head, 0.66, 0.66, 0.03, m, 0, 0.24, 0, 40);
      strand(head, `witch|${color}`, [[0, 0.25, 0], [0, 0.46, -0.01], [0.02, 0.68, -0.06], [0.1, 0.84, -0.16], [0.23, 0.9, -0.21]],
        0.3, 0.012, m, { segments: 26, radial: 24, ease: 1.25 });
      cylinder(head, 0.302, 0.315, 0.075, mat(accent, { rough: 0.6 }), 0, 0.29, 0, 32);
      const gold = mat('#e8c25a', { metal: 0.6, rough: 0.3 });
      box(head, 0.09, 0.07, 0.02, gold, 0, 0.29, 0.31, 0.01);
      box(head, 0.05, 0.035, 0.022, mat(accent), 0, 0.29, 0.312, 0.008);
      // Звёздочки по полям
      for (const [a, k] of [[0.9, 0.5], [-1.3, 0.56], [2.5, 0.48]]) {
        sphere(head, 0.022, glow('#ffd86b', 0.8), Math.sin(a) * k, 0.26, Math.cos(a) * k, 6);
      }
      break;
    }
    case 'tiara': {
      // Тонкий обруч поверх волос, спереди - зубцы и камень
      const metal = mat(color, { metal: 0.7, rough: 0.28 });
      const tiara = new THREE.Group();
      tiara.position.set(0, R * 0.7 + lift, 0.03);
      tiara.rotation.x = -0.32;
      head.add(tiara);
      const ring = torus(tiara, 0.31, 0.022, metal, 0, 0, 0);
      ring.rotation.x = Math.PI / 2;
      for (let i = -3; i <= 3; i++) {
        const a = i * 0.3;
        const height = 0.09 + (3 - Math.abs(i)) * 0.05;
        cone(tiara, i ? 0.028 : 0.036, height, metal, Math.sin(a) * 0.31, height / 2, Math.cos(a) * 0.31, 6);
        if (i % 2 === 0) sphere(tiara, 0.021, glow(accent, 0.6), Math.sin(a) * 0.31, height + 0.012, Math.cos(a) * 0.31, 8);
      }
      sphere(tiara, 0.048, glow(accent, 0.7), 0, 0.06, 0.325, 12);
      break;
    }
    case 'bow': {
      // Большой бант на макушке: две петли, узелок и хвостики
      const bow = new THREE.Group();
      bow.position.set(0, R * 1.1 + lift, -0.1);
      bow.rotation.x = -0.45;
      head.add(bow);
      const cloth = mat(color, { rough: 0.35, metal: 0.05 });
      for (const s of [-1, 1]) {
        const loop = sphere(bow, 0.5, cloth, s * 0.17, 0.03, 0, 16);
        loop.scale.set(0.36, 0.25, 0.11);
        loop.rotation.z = s * 0.3;
        const fold = sphere(bow, 0.5, mat(shade(color, 0.55)), s * 0.1, 0.025, 0.035, 10);
        fold.scale.set(0.11, 0.14, 0.06);
        const tail = box(bow, 0.07, 0.2, 0.018, cloth, s * 0.065, -0.12, -0.01, 0.007);
        tail.rotation.z = s * 0.35;
      }
      sphere(bow, 0.06, mat(accent, { rough: 0.5 }), 0, 0.015, 0.03, 12);
      break;
    }
  }
}

// ------------------------------------------------------------------ крылья и хвост

// Крылья растут из спины между лопатками, разведены в стороны и чуть
// назад. Каждое крыло строится вправо (+x) - левое просто отражено.
// Крылья - в userData.wings: ими можно взмахивать
function buildWings(g, item) {
  const wings = [];
  for (const s of [-1, 1]) {
    const wing = new THREE.Group();
    wing.position.set(s * 0.09, 1.1, -0.17);
    wing.rotation.set(0.1, s * 0.36, s * 0.36);
    g.add(wing);
    const shape = new THREE.Group();
    const k = item.style === 'bat' ? 1.3 : 1;
    shape.scale.set(s * k, k, k);
    wing.add(shape);
    if (item.style === 'bat') batWing(shape, item);
    else angelWing(shape, item);
    wing.userData.side = s;
    wing.userData.rest = wing.rotation.y;
    wings.push(wing);
  }
  g.userData.wings = wings;
}

// Крыло ангела: верхний край - пушистая дуга, вниз веером свисают острые
// перья - чем дальше от спины, тем длиннее и сильнее развёрнуты наружу.
// Сверху их прикрывает слой мелких пёрышек
function angelWing(w, item) {
  const white = mat(item.color, { rough: 0.92 });
  const soft = mat(item.accent || shade(item.color, 0.88), { rough: 0.95 });
  const edge = (u) => [0.03 + u * 0.76, 0.06 + Math.sin(u * Math.PI * 0.82) * 0.25 - u * u * 0.06];
  const count = 10;
  for (let i = count - 1; i >= 0; i--) {
    const u = i / (count - 1);
    const [x, y] = edge(0.06 + u * 0.92);
    const length = 0.2 + u * 0.32;
    const fan = 0.04 + u * 0.62;    // насколько перо смотрит наружу
    const dx = Math.sin(fan) * length, dy = -Math.cos(fan) * length;
    const feather = flatStrand(w, `feather|${i}`, [[x, y, 0], [x + dx * 0.45 + 0.01, y + dy * 0.5, 0], [x + dx, y + dy, 0]],
      0.075, 0.008, i % 2 ? soft : white, [1, 1, 0.32], { segments: 10, radial: 10, ease: 0.7 });
    feather.position.z = -0.012 * i;
  }
  const covert = sphere(w, 0.5, white, 0.4, 0.17, 0.02, 16);
  covert.scale.set(0.82, 0.3, 0.08);
  covert.rotation.z = 0.12;
  for (let i = 0; i < 8; i++) {
    const u = i / 7;
    const [x, y] = edge(u * 0.88);
    const fluff = sphere(w, 0.5, white, x, y - 0.03, 0.03, 12);
    fluff.scale.set(0.16 - u * 0.05, 0.13 - u * 0.03, 0.08);
  }
}

// Крыло летучей мыши: тонкие кости - от плеча к сгибу и от сгиба
// пальцы, между ними перепонка с фестонами по нижнему краю. Перепонка
// темнеет к костям и светлеет к краю (color - цвет края, accent - костей)
function batWing(w, item) {
  const bone = mat(item.accent || '#2b2142', { rough: 0.5 });
  const wrist = [0.29, 0.2];
  const tips = [[0.66, 0.12], [0.58, -0.17], [0.38, -0.3], [0.15, -0.25]];
  limb(w, [0, 0], wrist, 0.026, bone);
  for (const tip of tips) limb(w, wrist, tip, 0.015, bone);
  const claw = cone(w, 0.025, 0.07, bone, wrist[0] - 0.01, wrist[1] + 0.05, 0, 8);
  claw.rotation.z = 0.5;
  sphere(w, 0.03, bone, ...wrist, 0, 8);
  const geometry = cached(`bat-wing|${item.color}|${item.accent}`, () => {
    const shape = new THREE.Shape();
    shape.moveTo(0, 0.03);
    shape.lineTo(...wrist);
    shape.lineTo(...tips[0]);
    for (let i = 1; i < tips.length; i++) {
      const [ax, ay] = tips[i - 1], [bx, by] = tips[i];
      // Фестон: край между пальцами провисает к сгибу крыла
      const mx = (ax + bx) / 2, my = (ay + by) / 2;
      shape.quadraticCurveTo(mx + (wrist[0] - mx) * 0.38, my + (wrist[1] - my) * 0.38, bx, by);
    }
    shape.quadraticCurveTo(0.1, -0.12, 0.01, -0.08);
    shape.closePath();
    const made = new THREE.ShapeGeometry(shape, 14);
    const dark = new THREE.Color(item.accent || '#2b2142').lerp(new THREE.Color(item.color), 0.35);
    const light = new THREE.Color(item.color);
    const position = made.getAttribute('position');
    const colors = [];
    for (let i = 0; i < position.count; i++) {
      const x = position.getX(i), y = position.getY(i);
      const t = Math.min(1, Math.max(0, (0.22 - y) / 0.5 + x * 0.25));
      const c = dark.clone().lerp(light, t * t * (3 - 2 * t));
      colors.push(c.r, c.g, c.b);
    }
    made.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    return made;
  });
  place(w, geometry, vertexMat(0.62, true));
}

// Кошачий хвост: от поясницы изгибается вбок и кончиком вверх. flip - в
// другую сторону. Хвост - в userData.tail, он вращается вокруг основания
function buildTail(g, item) {
  const s = item.flip ? -1 : 1;
  const tail = new THREE.Group();
  tail.position.set(0, 0.74, -0.15);
  g.add(tail);
  const points = [[0, 0, 0], [s * 0.1, -0.12, -0.13], [s * 0.3, -0.17, -0.2], [s * 0.5, -0.06, -0.16], [s * 0.6, 0.15, -0.07], [s * 0.58, 0.33, 0.0]];
  const fur = mat(item.color, { rough: 0.92 });
  strand(tail, `tail|${s}`, points, 0.062, 0.054, fur, { segments: 32 });
  sphere(tail, 0.054, fur, ...points[points.length - 1], 12);
  tail.userData.side = s;
  g.userData.tail = tail;
}

// ------------------------------------------------------------------ сборка

// look - {слот: id предмета}
export function buildFigure(wardrobe, look) {
  const items = wardrobe.resolve(look);
  const colors = {
    skin: items.skin ? items.skin.color : '#eec1a0',
    eye: items.eye_color ? items.eye_color.color : '#6b4226',
    hair: items.hair_color ? items.hair_color.color : '#6e4228',
  };
  const body = new THREE.Group();
  body.position.y = -SOLE;
  buildShoes(body, items.shoes, colors.skin);
  buildBottom(body, items.bottom, colors.skin);
  buildTop(body, items.top, colors.skin);
  if (items.wings) buildWings(body, items.wings);
  if (items.tail) buildTail(body, items.tail);
  buildHead(body, items, colors);
  const g = new THREE.Group();
  g.add(body);
  // Глаза (закрыть, моргать) - у всей фигурки, см. setEyesClosed
  Object.assign(g.userData, body.userData, { figure: true });
  return g;
}

// Манекен для лавки: гладкая фигурка без лица и волос, а на ней - одна
// вещь (товар). Цвет кожи, глаз или волос показан на самом манекене:
// кожа - его цветом, глаза - лицом, волосы - короткой стрижкой
export const MANNEQUIN_COLOR = '#efe6da';

export function buildMannequin(wardrobe, itemId) {
  const item = wardrobe.byId.get(itemId) || null;
  const look = {};
  for (const slot of wardrobe.slots) look[slot.id] = null;
  if (item) look[item.slot] = item.id;
  const items = wardrobe.resolve(look);
  const slot = item ? item.slot : '';
  const skin = items.skin ? items.skin.color : MANNEQUIN_COLOR;
  const colors = {
    skin,
    eye: items.eye_color ? items.eye_color.color : '#6b4226',
    hair: items.hair_color ? items.hair_color.color : '#6e4228',
  };
  const face = ['eyes', 'nose', 'eye_color'].includes(slot);
  const hair = ['hair', 'hair_color'].includes(slot);
  const bare = { style: 'bare', color: skin };
  const body = new THREE.Group();
  body.position.y = -SOLE;
  buildShoes(body, items.shoes || bare, skin);
  buildBottom(body, items.bottom || bare, skin);
  buildTop(body, items.top || bare, skin);
  if (items.wings) buildWings(body, items.wings);
  if (items.tail) buildTail(body, items.tail);
  buildHead(body, {
    ...items,
    eyes: items.eyes || { style: face ? 'round' : 'none' },
    nose: items.nose || (face ? null : { style: 'none' }),
    hair: items.hair || { style: hair ? 'short' : 'bald' },
  }, colors);
  const g = new THREE.Group();
  g.add(body);
  Object.assign(g.userData, body.userData, { figure: true, mannequin: true });
  return g;
}

// Куда фигурка смотрит, если смотреть на неё из угла комнаты:
// к зрителю, от зрителя, вправо и влево по экрану
export const FACING = {
  down: Math.PI / 4,
  up: -Math.PI * 3 / 4,
  right: Math.PI * 3 / 4,
  left: -Math.PI / 4,
};

// ------------------------------------------------------------------ живая фигурка

// Закрыть или открыть глаза: сон, моргание
export function setEyesClosed(model, closed) {
  if (!model || !model.userData.closeEyes || model.userData.eyesClosed === closed) return;
  model.userData.eyesClosed = closed;
  model.userData.closeEyes(closed);
}

// Глаза светятся цветом color, k - насколько ярко (0 - не светятся).
// Так в мини-игре горят глаза двойника из ложной комнаты
export function setEyesGlow(model, color, k) {
  const face = model && model.userData.face;
  if (!face) return;
  const material = face.material;
  if (!material.emissiveMap) {
    material.emissiveMap = eyesGlowTexture(model.userData.eyes || 'round');
    material.needsUpdate = true;
  }
  material.emissive.set(color);
  material.emissiveIntensity = k;
}

// Дыхание: фигурка чуть вытягивается вверх и снова оседает - совсем
// немного, чтобы не стояла неживой. Центр - у ног, ноги на месте.
// Те же числа - у картинки фигурки в виджете мини-игры
// (obs_widgets/minimap/style.css, @keyframes breathe)
export const BREATH = { period: 2.4, stretch: 0.022, squash: 0.013 };

export function breathe(model, time, scale = 1) {
  const s = Math.sin((time / BREATH.period) * Math.PI * 2);
  const across = scale * (1 - BREATH.squash * s);
  model.scale.set(across, scale * (1 + BREATH.stretch * s), across);
}

// Моргание: раз в несколько секунд глаза закрываются на мгновение.
// update() - каждый кадр, time - в секундах
export class Blinker {
  constructor() {
    this.next = 1.5 + Math.random() * 2;
  }

  update(model, time) {
    if (!model || !model.userData.blinks) return;
    if (time > this.next + 0.14) this.next = time + 2.6 + Math.random() * 3.4;
    setEyesClosed(model, time >= this.next);
  }
}

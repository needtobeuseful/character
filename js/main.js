// Редактор персонажа: гардероб зрителя и его фигурка.
//
// Ссылку на редактор присылает бот по команде !персонаж. После # в ней:
//   n - ник зрителя, i - код его гардероба, l - код того, что сейчас надето.
// Всё после # браузер никуда не отправляет - страница читает это сама.
//
// В гардеробе всегда есть стартовые вещи (в каталоге у них starter: true) -
// по одной в каждом слоте, а цвет кожи можно выбрать любой. Остальное
// зритель находит в сундуках мини-игры.
//
// Без i редактор открывается в режиме каталога: доступны все вещи. Так
// собираются и образы NPC (продавцов в магазинах мини-игры): их готовые
// образы - в catalog.json → npcLooks, кнопками «Образ NPC».
// Сама страница ничего не сохраняет: зритель отправляет в чат
// «!персонаж КОД», и бот сам проверяет, что всё это есть в его гардеробе.

import * as THREE from 'three';
import { Wardrobe, buildFigure, FACING, Blinker, breathe } from './figure.js';
import { decodeLook, decodeWardrobe, encodeLook } from './codec.js';

const $ = (selector) => document.querySelector(selector);

const toastEl = $('#toast');
let toastTimer = 0;
function toast(text, ms = 2200) {
  toastEl.textContent = text;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), ms);
}

function plural(n, forms) {
  const a = Math.abs(n) % 100, b = a % 10;
  if (a > 10 && a < 20) return forms[2];
  if (b > 1 && b < 5) return forms[1];
  if (b === 1) return forms[0];
  return forms[2];
}
const THING_FORMS = ['вещь', 'вещи', 'вещей'];

const catalog = await fetch('catalog.json', { cache: 'no-cache' }).then((response) => {
  if (!response.ok) throw new Error(`catalog.json: ${response.status}`);
  return response.json();
});
const wardrobe = new Wardrobe(catalog);
const RARITIES = catalog.rarities || {};
const SETS = catalog.sets || {};

// ---------------------------------------------------------------- что пришло в ссылке

const params = new URLSearchParams(location.hash.slice(1));
const playerName = (params.get('n') || '').trim().slice(0, 40);
const wardrobeText = params.get('i');
const catalogMode = wardrobeText === null;
const owned = new Set();       // id вещей, которые можно надеть
let unknownOwned = 0;          // вещи, которых этот сайт ещё не знает
let brokenLink = '';

for (const item of wardrobe.items) if (catalogMode || item.starter) owned.add(item.id);
if (!catalogMode) {
  try {
    for (const code of decodeWardrobe(wardrobeText)) {
      const item = wardrobe.byCode.get(code);
      if (item) owned.add(item.id);
      else unknownOwned++;
    }
  } catch (error) {
    brokenLink = `Ссылка повреждена (${error.message}) - попроси у бота новую: !персонаж`;
  }
}

// Надетое из ссылки. Чего нет в гардеробе - заменяется стартовым
function initialLook() {
  let look = wardrobe.defaultLook();
  const text = params.get('l');
  if (text) {
    try {
      look = wardrobe.lookFromCodes(decodeLook(text));
    } catch (error) {
      toast(`Образ из ссылки не открылся: ${error.message}`, 4000);
    }
  }
  const fallback = wardrobe.defaultLook();
  for (const slot of wardrobe.slots) {
    const id = look[slot.id];
    if (id && !owned.has(id)) look[slot.id] = fallback[slot.id];
    if (!id && !slot.optional) look[slot.id] = fallback[slot.id];
  }
  return look;
}

// ---------------------------------------------------------------- сцена

const stage = $('#stage');
const canvas = $('#scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(26, 1, 0.1, 100);

function addLights(target) {
  target.add(new THREE.HemisphereLight(0xfff1dc, 0x2a3142, 1.35));
  const sun = new THREE.DirectionalLight(0xfff0dc, 1.9);
  sun.position.set(4, 7, 3.5);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  Object.assign(sun.shadow.camera, { left: -2, right: 2, top: 3, bottom: -1, near: 0.5, far: 20 });
  sun.shadow.bias = -0.0008;
  sun.shadow.normalBias = 0.02;
  target.add(sun);
  const fill = new THREE.PointLight(0xffc58a, 6, 8, 1.6);
  fill.position.set(-1.2, 2.6, 2.4);
  target.add(fill);
}
addLights(scene);

// Круглая витрина, на которой стоит фигурка
const podium = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.18, 0.16, 64),
  new THREE.MeshStandardMaterial({ color: 0x2b2533, roughness: 0.8 }));
podium.position.y = -0.08;
podium.receiveShadow = true;
scene.add(podium);
const podiumTop = new THREE.Mesh(new THREE.CircleGeometry(1.06, 64),
  new THREE.MeshStandardMaterial({ color: 0x3a3244, roughness: 0.9 }));
podiumTop.rotation.x = -Math.PI / 2;
podiumTop.position.y = 0.001;
podiumTop.receiveShadow = true;
scene.add(podiumTop);

const turntable = new THREE.Group();
scene.add(turntable);
let figure = null;
let figureScale = 1, figureSpeed = 0;

function resize() {
  const width = stage.clientWidth, height = stage.clientHeight;
  renderer.setSize(width, height, false);
  camera.aspect = width / Math.max(1, height);
  // Фигурка целиком в кадре и на телефоне, и на широком экране
  const distance = camera.aspect < 0.9 ? 8.6 : 7.4;
  camera.position.set(0, 2.3, distance);
  camera.lookAt(0, 0.92, 0);
  camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(stage);
resize();

function rebuild(pop = true) {
  if (figure) turntable.remove(figure);
  figure = buildFigure(wardrobe, look);
  turntable.add(figure);
  if (pop) {
    figureScale = 0.9;
    figureSpeed = 0;
  }
}

// ---------------------------------------------------------------- вращение

let spin = FACING.down * 0.25;
let spinSpeed = 0;
let drag = null;
let idleSince = performance.now();

canvas.addEventListener('pointerdown', (event) => {
  drag = { x: event.clientX, spin, t: performance.now(), last: event.clientX };
  canvas.setPointerCapture(event.pointerId);
  canvas.style.cursor = 'grabbing';
  $('#hint').classList.add('gone');
});
canvas.addEventListener('pointermove', (event) => {
  if (!drag) return;
  const now = performance.now();
  const dx = event.clientX - drag.last;
  spinSpeed = (dx / Math.max(1, now - drag.t)) * 0.012 * 16;
  drag.t = now;
  drag.last = event.clientX;
  spin += dx * 0.012;
});
const endDrag = () => {
  drag = null;
  canvas.style.cursor = '';
  idleSince = performance.now();
};
canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', endDrag);

// ---------------------------------------------------------------- картинки вещей

// Отдельный маленький рендерер: каждая вещь рисуется прямо на фигурке,
// с тем, что уже надето, - видно, как она будет смотреться
const THUMB = 160;
const thumbRenderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
thumbRenderer.setPixelRatio(1);
thumbRenderer.setSize(THUMB, THUMB);
thumbRenderer.toneMapping = THREE.ACESFilmicToneMapping;
thumbRenderer.toneMappingExposure = 1.15;
const thumbScene = new THREE.Scene();
addLights(thumbScene);
const thumbCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 50);

// Какую часть фигурки показывать для вещи каждого слота: y - высота от
// пола, half - половина кадра, turn - как повернуть фигурку (хвост виден сзади)
const FRAMES = {
  headwear: { y: 1.65, half: 0.62 },
  head_extra: { y: 1.78, half: 0.66 },
  ears: { y: 1.68, half: 0.6 },
  hair: { y: 1.55, half: 0.56 },
  eyes: { y: 1.45, half: 0.34 },
  mouth: { y: 1.37, half: 0.32 },
  nose: { y: 1.41, half: 0.34 },
  top: { y: 0.91, half: 0.48 },
  bottom: { y: 0.43, half: 0.4 },
  shoes: { y: 0.11, half: 0.3 },
  wings: { y: 1.12, half: 0.98 },
  tail: { y: 0.8, half: 0.62, turn: 2.5 },
};
// От чего зависит картинка вещи: если это поменялось - перерисовать
const DEPENDS = {
  headwear: ['skin', 'hair', 'hair_color', 'eyes', 'mouth', 'nose', 'ears', 'head_extra'],
  head_extra: ['skin', 'hair', 'hair_color', 'headwear', 'ears', 'eyes', 'mouth', 'nose'],
  ears: ['skin', 'hair', 'hair_color', 'headwear', 'head_extra', 'eyes', 'mouth', 'nose'],
  hair: ['skin', 'hair_color', 'headwear', 'eyes', 'mouth', 'nose', 'ears', 'head_extra'],
  eyes: ['skin', 'eye_color', 'hair_color', 'mouth', 'nose'],
  mouth: ['skin', 'eye_color', 'hair_color', 'eyes', 'nose'],
  nose: ['skin', 'eye_color', 'hair_color', 'eyes', 'mouth'],
  top: ['skin'],
  bottom: ['skin', 'top'],
  shoes: ['skin', 'bottom'],
  wings: ['skin', 'top', 'hair', 'hair_color', 'headwear', 'head_extra', 'ears', 'eyes', 'mouth', 'nose', 'tail'],
  tail: ['skin', 'top', 'bottom', 'wings', 'shoes'],
};
const thumbs = new Map();

function thumbFor(slotId, item) {
  const frame = FRAMES[slotId];
  const key = [slotId, item ? item.id : '-', ...DEPENDS[slotId].map((s) => look[s])].join('|');
  if (thumbs.has(key)) return thumbs.get(key);
  const model = buildFigure(wardrobe, { ...look, [slotId]: item ? item.id : null });
  model.rotation.y = frame.turn ?? 0.45;
  thumbScene.add(model);
  thumbCamera.position.set(0, frame.y + 0.5, 6);
  thumbCamera.lookAt(0, frame.y, 0);
  Object.assign(thumbCamera, { left: -frame.half, right: frame.half, top: frame.half, bottom: -frame.half });
  thumbCamera.updateProjectionMatrix();
  thumbRenderer.render(thumbScene, thumbCamera);
  const url = thumbRenderer.domElement.toDataURL('image/png');
  thumbScene.remove(model);
  thumbs.set(key, url);
  return url;
}

// ---------------------------------------------------------------- гардероб

let look = initialLook();
let currentSlot = wardrobe.slots[0].id;
const shopList = $('#shop-list');

function itemsFor(slotId) {
  return wardrobe.inSlot(slotId).filter((item) => owned.has(item.id));
}

// Необязательный слот, где у игрока ничего нет (крылья, хвост - пока
// только у NPC), в его гардеробе не показывается
function slotShown(slot) {
  return catalogMode || !slot.optional || itemsFor(slot.id).length > 0;
}

function renderSlots() {
  const nav = $('#slots');
  nav.replaceChildren();
  for (const slot of wardrobe.slots) {
    if (!slotShown(slot)) continue;
    const chip = document.createElement('button');
    chip.className = `slot${slot.id === currentSlot ? ' on' : ''}`;
    chip.textContent = slot.name;
    if (slot.colors && look[slot.id]) {
      const dot = document.createElement('i');
      dot.style.background = wardrobe.byId.get(look[slot.id]).color;
      chip.prepend(dot);
    }
    chip.addEventListener('click', () => {
      currentSlot = slot.id;
      renderSlots();
      renderCards();
    });
    nav.append(chip);
    // На телефоне слоты листаются вбок - выбранный не должен уехать за край
    if (slot.id === currentSlot) requestAnimationFrame(() => chip.scrollIntoView({ block: 'nearest', inline: 'nearest' }));
  }
}

function renderCards() {
  const slot = wardrobe.slotById.get(currentSlot);
  shopList.replaceChildren();
  const cards = document.createElement('div');
  cards.className = 'cards';
  const list = itemsFor(slot.id);
  if (slot.optional) cards.append(makeCard(slot, null));
  for (const item of list) cards.append(makeCard(slot, item));
  const heading = document.createElement('h3');
  heading.textContent = catalogMode
    ? `${slot.name} · ${list.length}`
    : `${slot.name} · ${list.length} из ${wardrobe.inSlot(slot.id).length}`;
  shopList.append(heading, cards);
}

function makeCard(slot, item) {
  const card = document.createElement('button');
  card.className = 'card';
  const on = (look[slot.id] || null) === (item ? item.id : null);
  card.classList.toggle('on', on);
  const rarity = item && RARITIES[item.rarity];
  if (rarity) card.style.setProperty('--rc', rarity.color);
  let picture;
  if (!item) {
    picture = '<span class="none-pic">∅</span>';
  } else if (slot.colors) {
    picture = `<span class="swatch"><span style="--sw: ${item.color}"></span></span>`;
  } else {
    picture = `<img alt="" src="${thumbFor(slot.id, item)}">`;
  }
  card.innerHTML = `${picture}<span class="name"></span><span class="meta"><span class="rarity"></span></span>`;
  card.querySelector('.name').textContent = item ? item.name : slot.emptyName || 'Ничего';
  // В каталоге у вещей NPC вместо редкости - чьи они
  const setName = catalogMode && item && item.set && SETS[item.set];
  card.querySelector('.rarity').textContent = item
    ? (item.starter ? 'есть у всех' : setName || (rarity ? rarity.name : '')) : '';
  if (setName) card.classList.add('npc');
  card.addEventListener('click', () => wear(slot.id, item ? item.id : null));
  return card;
}

function wear(slotId, id) {
  if ((look[slotId] || null) === id) return;
  look = { ...look, [slotId]: id };
  rebuild();
  saveState();
  renderSlots();
  renderCards();
  $('#hint').classList.add('gone');
}

function randomLook() {
  const next = {};
  for (const slot of wardrobe.slots) {
    const list = itemsFor(slot.id);
    const empty = slot.optional && Math.random() < 0.25;
    next[slot.id] = empty || !list.length ? null : list[Math.floor(Math.random() * list.length)].id;
  }
  look = next;
  rebuild();
  saveState();
  renderSlots();
  renderCards();
}

$('#random').addEventListener('click', randomLook);

// Готовые образы NPC (catalog.json → npcLooks) - только в режиме каталога
function renderTemplates() {
  const box = $('#templates');
  const looks = catalog.npcLooks || {};
  const names = Object.keys(looks);
  box.hidden = !catalogMode || !names.length;
  if (box.hidden) return;
  box.replaceChildren();
  const label = document.createElement('span');
  label.textContent = 'Образ NPC:';
  box.append(label);
  for (const name of names) {
    const button = document.createElement('button');
    button.className = 'slot';
    button.textContent = SETS[name] || name;
    button.addEventListener('click', () => {
      look = wardrobe.lookFromCodes(looks[name].map((id) => wardrobe.byId.get(id)).filter(Boolean).map((item) => item.code));
      rebuild();
      saveState();
      renderSlots();
      renderCards();
      $('#hint').classList.add('gone');
    });
    box.append(button);
  }
}

// ---------------------------------------------------------------- ссылка и «Готово»

const currentCode = () => encodeLook(wardrobe.lookCodes(look));

function stateHash() {
  const parts = [];
  if (playerName) parts.push(`n=${encodeURIComponent(playerName)}`);
  if (!catalogMode) parts.push(`i=${wardrobeText}`);
  parts.push(`l=${currentCode()}`);
  return parts.join('&');
}

function saveState() {
  history.replaceState(null, '', `#${stateHash()}`);
}

const dialog = $('#result');
$('#done').addEventListener('click', () => {
  const code = currentCode();
  const command = catalogMode ? code : `!персонаж ${code}`;
  $('#result-command').textContent = command;
  $('#result-length').textContent = catalogMode ? `${code.length} символов` : `${command.length} из 500 символов`;
  $('#result-link').value = `${location.origin}${location.pathname}#${stateHash()}`;
  dialog.showModal();
});

async function copy(text, button) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const area = document.createElement('textarea');
    area.value = text;
    document.body.append(area);
    area.select();
    document.execCommand('copy');
    area.remove();
  }
  const label = button.textContent;
  button.textContent = 'Скопировано';
  setTimeout(() => { button.textContent = label; }, 1400);
}

$('#copy-command').addEventListener('click', (event) => copy($('#result-command').textContent, event.currentTarget));
$('#copy-link').addEventListener('click', (event) => copy($('#result-link').value, event.currentTarget));
$('#close-result').addEventListener('click', () => dialog.close());

// ---------------------------------------------------------------- кадр

const clock = new THREE.Clock();
const blinker = new Blinker();
renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.05);
  const time = clock.elapsedTime;
  if (!drag) {
    spin += spinSpeed * dt * 60;
    spinSpeed *= Math.pow(0.9, dt * 60);
    // Постояв, фигурка сама поворачивается лицом и чуть покачивается
    if (performance.now() - idleSince > 2500 && Math.abs(spinSpeed) < 0.002) {
      const rest = Math.round(spin / (Math.PI * 2)) * Math.PI * 2 + 0.35 + Math.sin(time * 0.6) * 0.25;
      spin += (rest - spin) * (1 - Math.exp(-dt * 1.5));
    }
  }
  turntable.rotation.y = spin;
  // Пружинка при переодевании
  const force = (1 - figureScale) * 300 - figureSpeed * 16;
  figureSpeed += force * dt;
  figureScale += figureSpeed * dt;
  if (figure) {
    // Фигурка дышит и моргает - как в мини-игре
    breathe(figure, time, figureScale);
    blinker.update(figure, time);
  }
  renderer.render(scene, camera);
});

// ---------------------------------------------------------------- запуск

function setupTexts() {
  if (catalogMode) {
    document.title = 'Все вещи персонажа';
    $('#title').textContent = 'Все вещи';
    $('#mode-badge').hidden = false;
    $('#shop-sub').textContent = 'Режим каталога: без ограничений';
    $('#result-title').textContent = 'Код образа';
    $('#result-lead').textContent = 'Код этого образа. Вещи в нём не сверяются ни с чьим гардеробом:';
    $('#result-note').textContent = 'Режим каталога: открыт без гардероба игрока.';
  } else {
    const title = playerName ? `Персонаж ${playerName}` : 'Мой персонаж';
    document.title = title;
    $('#title').textContent = title;
  }
  const found = [...owned].filter((id) => !wardrobe.byId.get(id).starter).length;
  $('#count-text').textContent = catalogMode
    ? `${owned.size} ${plural(owned.size, THING_FORMS)}`
    : `${owned.size} ${plural(owned.size, THING_FORMS)}`;
  $('#count-pill').title = catalogMode ? 'Все вещи в игре' : `В гардеробе, из них найдено в сундуках: ${found}`;
  if (!catalogMode) {
    $('#shop-sub').textContent = found
      ? `Найдено в сундуках: ${found} ${plural(found, THING_FORMS)}`
      : 'Одежда выпадает из сундуков в мини-игре на стриме';
  }
}

setupTexts();
renderTemplates();
rebuild(false);
renderSlots();
renderCards();
saveState();
$('#loading').classList.add('gone');
if (brokenLink) toast(brokenLink, 6000);
else if (unknownOwned) {
  toast(`${unknownOwned} ${plural(unknownOwned, THING_FORMS)} из гардероба сайт ещё не знает - стример скоро обновит страницу`, 5000);
}
window.__avatarReady = true;

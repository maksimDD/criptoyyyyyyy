#!/usr/bin/env node
'use strict';

// Refresh the complete marketable CS2 catalogue without changing BLUP's 25 case definitions/prices.
// Sources: ByMykel metadata + Skinport and Market.CSGO public USD price lists.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = __dirname;
const ROOT_FILE = path.join(ROOT, 'cases-data.json');
const PUBLIC_FILE = path.join(ROOT, 'public', 'cases-data.json');
const API = 'https://raw.githubusercontent.com/ByMykel/CSGO-API/main/public/api/en/';
const MIN_PRICE = 0.05;
const MAX_PRICE = 55.00;

async function getJson(url, optional = false) {
  const response = await fetch(url, {
    headers: { 'User-Agent': 'BLUP-CS2-Catalog-Sync/1.0', 'Accept': 'application/json', 'Accept-Encoding': 'gzip, br' },
    signal: AbortSignal.timeout(90000)
  });
  if (!response.ok) {
    if (optional) return null;
    throw new Error(`${response.status} ${response.statusText}: ${url}`);
  }
  return response.json();
}
const toArray = x => Array.isArray(x) ? x : [];
const safeNumber = value => {
  if (typeof value === 'string') value = value.replace(',', '.').replace(/[^0-9.]/g, '');
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
};
const idFor = (name, category) => {
  const slug = String(name).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 54) || 'item';
  const hash = crypto.createHash('sha1').update(`${category}|${name}`).digest('hex').slice(0, 8);
  return `cs2_${slug}_${hash}`;
};
const rarityKey = item => {
  const raw = `${item?.rarity?.id || ''} ${item?.rarity?.name || ''}`.toLowerCase();
  if (/contraband|covert|extraordinary|ancient|legendary/.test(raw)) return 'legendary';
  if (/classified|mythical|remarkable/.test(raw)) return 'epic';
  if (/restricted|rare/.test(raw)) return 'rare';
  return 'common';
};

async function main() {
  const existing = JSON.parse(fs.readFileSync(ROOT_FILE, 'utf8'));
  const oldSkins = existing.skins || {};
  const oldByName = new Map(Object.values(oldSkins).map(x => [x.marketHashName || x.name, x]));

  const categories = [
    ['skins_not_grouped.json', 'skin'],
    ['crates.json', 'case/capsule'],
    ['stickers.json', 'sticker'],
    ['graffiti.json', 'graffiti'],
    ['agents.json', 'agent'],
    ['patches.json', 'patch'],
    ['music_kits.json', 'music kit'],
    ['keychains.json', 'charm'],
    ['collectibles.json', 'collectible'],
    ['keys.json', 'key'],
    ['sticker_slabs.json', 'sticker slab'],
    ['tools.json', 'tool'],
    ['pets.json', 'pet'],
    ['highlights.json', 'highlight']
  ];

  const [marketCsgo, skinport, ...metadataLists] = await Promise.all([
    getJson('https://market.csgo.com/api/v2/prices/USD.json', true),
    getJson('https://api.skinport.com/v1/items?app_id=730&currency=USD', true),
    ...categories.map(([file]) => getJson(API + file, true))
  ]);

  const prices = new Map();
  const addPrice = (name, value, source) => {
    const price = safeNumber(value);
    if (!name || !price) return;
    const current = prices.get(name);
    if (!current || price < current.price) prices.set(name, { price, source });
  };

  const csgoItems = toArray(marketCsgo?.items || marketCsgo?.data || marketCsgo);
  for (const item of csgoItems) {
    const name = item.market_hash_name || item.marketHashName || item.name;
    addPrice(name, item.price_usd ?? item.price, 'Market.CSGO');
  }
  for (const item of toArray(skinport)) {
    const name = item.market_hash_name || item.marketHashName || item.name;
    addPrice(name, item.min_price ?? item.price, 'Skinport');
  }
  if (!prices.size) throw new Error('Оба источника цен недоступны или вернули пустой каталог. Старые данные сохранены.');

  const result = {};
  let imported = 0, retained = 0;
  const allByName = new Map();

  for (let i = 0; i < categories.length; i++) {
    const [file, category] = categories[i];
    const list = toArray(metadataLists[i]);
    for (const item of list) {
      if (!item || item.marketable === false) continue;
      const marketName = item.market_hash_name || item.marketHashName || item.name;
      if (!marketName) continue;
      const priceRow = prices.get(marketName);
      const old = oldByName.get(marketName);
      const price = priceRow?.price ?? (old ? Number(old.price) : null);
      if (!price || price < MIN_PRICE || price > MAX_PRICE) continue;

      const key = marketName;
      const previous = allByName.get(key);
      if (previous && previous.price <= price) continue;

      const entry = {
        id: old?.id || idFor(marketName, category),
        name: item.name || marketName,
        marketHashName: marketName,
        price: Number(price.toFixed(2)),
        rarity: old?.rarity || rarityKey(item),
        category,
        image: item.image || old?.image || null,
        priceSource: priceRow?.source || 'previous BLUP snapshot',
        priceUpdated: priceRow ? new Date().toISOString() : (old?.priceUpdated || null)
      };
      if (item.wear?.name) entry.wear = item.wear.name;
      if (item.stattrak) entry.statTrak = true;
      if (item.souvenir) entry.souvenir = true;
      if (item.phase) entry.phase = item.phase;
      allByName.set(key, entry);
    }
  }

  // Keep every existing case drop addressable; refresh its price when a live market match exists.
  for (const old of Object.values(oldSkins)) {
    const key = old.marketHashName || old.name;
    if (allByName.has(key)) continue;
    const priceRow = prices.get(key);
    const price = priceRow?.price ?? Number(old.price);
    if (price >= MIN_PRICE && price <= MAX_PRICE) {
      allByName.set(key, {
        ...old,
        marketHashName: old.marketHashName || key,
        price: Number(price.toFixed(2)),
        priceSource: priceRow?.source || 'previous BLUP snapshot',
        priceUpdated: priceRow ? new Date().toISOString() : (old.priceUpdated || null)
      });
    }
  }

  for (const entry of allByName.values()) {
    result[entry.id] = entry;
    imported++;
  }
  retained = Object.values(result).filter(x => String(x.priceSource).includes('previous BLUP')).length;

  const next = {
    ...existing,
    currency: 'USD',
    priceUpdated: new Date().toISOString(),
    priceSource: 'Lowest available listing from Skinport and Market.CSGO; metadata from ByMykel CSGO-API. Range $0.05–$55.00. Price is refreshed when this script runs.',
    catalogScope: categories.map(x => x[1]),
    skins: result
    // existing.cases intentionally retained byte-for-byte as data: all 25 BLUP case names, images and prices stay unchanged.
  };

  const json = JSON.stringify(next, null, 2) + '\n';
  const tmp = ROOT_FILE + '.tmp';
  fs.writeFileSync(tmp, json);
  fs.renameSync(tmp, ROOT_FILE);
  fs.writeFileSync(PUBLIC_FILE, json);
  console.log(`CS2 catalogue updated: ${imported} items ($${MIN_PRICE.toFixed(2)}–$${MAX_PRICE.toFixed(2)}).`);
  console.log(`Prices from live markets: ${imported - retained}; preserved legacy entries: ${retained}.`);
  console.log(`BLUP cases preserved: ${(next.cases || []).length}; case prices were not recalculated or changed.`);
  if (!marketCsgo) console.warn('Market.CSGO unavailable; used Skinport where possible.');
  if (!skinport) console.warn('Skinport unavailable; used Market.CSGO where possible.');
}

main().catch(error => {
  console.error('CS2 catalogue sync failed:', error.message);
  process.exitCode = 1;
});

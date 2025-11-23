const express = require('express');
const https = require('https');
const db = require('../db');
const { authenticate } = require('../services/session-store');
const { coerceRole, isHeadCoach } = require('../utils/role');

const router = express.Router();
const UPC_LOOKUP_URL = 'https://world.openfoodfacts.org/api/v2';
const SEARCH_URL = 'https://world.openfoodfacts.org/cgi/search.pl';
const REMOTE_SEARCH_CACHE_TTL_MS = 1000 * 60 * 5; // 5 minutes
const REMOTE_SEARCH_CACHE_LIMIT = 50;
const REMOTE_SEARCH_TIMEOUT_MS = 400;
const BARCODE_LOOKUP_CACHE_TTL_MS = 1000 * 60 * 60 * 6; // 6 hours
const BARCODE_LOOKUP_CACHE_LIMIT = 250;
const keepAliveAgent = new https.Agent({
  keepAlive: true,
  keepAliveMsecs: 1000 * 15,
  maxSockets: 8,
  timeout: 1000 * 30,
});
const remoteSuggestionCache = new Map();
const barcodeLookupCache = new Map();

function fetchJson(targetUrl) {
  return new Promise((resolve, reject) => {
    const request = https.get(targetUrl, { agent: keepAliveAgent }, (response) => {
      const { statusCode } = response;
      if (statusCode && statusCode >= 400) {
        response.resume();
        reject(new Error(`Lookup service returned ${statusCode}`));
        return;
      }
      let raw = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => {
        raw += chunk;
      });
      response.on('end', () => {
        try {
          const parsed = JSON.parse(raw);
          resolve(parsed);
        } catch (error) {
          reject(new Error('Invalid response from lookup service.'));
        }
      });
    });
    request.on('error', (error) => {
      reject(new Error(`Lookup failed: ${error.message}`));
    });
    request.setTimeout(5000, () => {
      request.destroy(new Error('Lookup timed out.'));
    });
  });
}

const selectUser = db.prepare(
  `SELECT id,
          role,
          goal_calories AS goalCalories
     FROM users
    WHERE id = ?`
);

const accessStatement = db.prepare(
  `SELECT 1
     FROM coach_athlete_links
    WHERE coach_id = ? AND athlete_id = ?`
);

const latestGoalStatement = db.prepare(
  `SELECT target_calories AS calories,
          protein_grams   AS protein,
          carbs_grams     AS carbs,
          fats_grams      AS fats
     FROM nutrition_macros
    WHERE user_id = ?
    ORDER BY date DESC, id DESC
    LIMIT 1`
);

const macrosByDateStatement = db.prepare(
  `SELECT date,
          target_calories AS calories,
          protein_grams   AS protein,
          carbs_grams     AS carbs,
          fats_grams      AS fats
     FROM nutrition_macros
    WHERE user_id = ?
    ORDER BY date DESC, id DESC`
);

const insertMacroStatement = db.prepare(
  `INSERT INTO nutrition_macros
    (user_id, date, target_calories, protein_grams, carbs_grams, fats_grams)
    VALUES (?, ?, ?, ?, ?, ?)`
);

const deleteMacroByDateStatement = db.prepare(
  `DELETE FROM nutrition_macros
    WHERE user_id = ?
      AND date = ?`
);

const entriesByDateStatement = db.prepare(
  `SELECT id,
          date,
          item_name        AS name,
          item_type        AS type,
          barcode,
          calories,
          protein_grams    AS protein,
          carbs_grams      AS carbs,
          fats_grams       AS fats,
          weight_amount    AS weightAmount,
          weight_unit      AS weightUnit,
          photo_data       AS photoData,
          created_at       AS createdAt
     FROM nutrition_entries
    WHERE user_id = ?
      AND date = ?
    ORDER BY created_at DESC, id DESC`
);

const windowTotalsStatement = db.prepare(
  `SELECT date,
          SUM(calories)      AS calories,
          SUM(protein_grams) AS protein,
          SUM(carbs_grams)   AS carbs,
          SUM(fats_grams)    AS fats
     FROM nutrition_entries
    WHERE user_id = ?
      AND date >= ?
    GROUP BY date
    ORDER BY date DESC`
);

const insertEntryStatement = db.prepare(
  `INSERT INTO nutrition_entries
    (user_id, date, item_name, item_type, barcode, calories, protein_grams, carbs_grams, fats_grams, weight_amount, weight_unit, photo_data)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
);

const entryByIdStatement = db.prepare(
  `SELECT id,
          user_id        AS userId,
          date,
          item_name      AS name,
          item_type      AS type,
          barcode,
          calories,
          protein_grams  AS protein,
          carbs_grams    AS carbs,
          fats_grams     AS fats,
          weight_amount  AS weightAmount,
          weight_unit    AS weightUnit,
          photo_data     AS photoData
     FROM nutrition_entries
    WHERE id = ?`
);

const deleteEntryStatement = db.prepare(`DELETE FROM nutrition_entries WHERE id = ?`);

const localSuggestionStatement = db.prepare(
  `SELECT id,
          item_name     AS name,
          item_type     AS type,
          barcode,
          calories,
          protein_grams AS protein,
          carbs_grams   AS carbs,
          fats_grams    AS fats,
          weight_amount AS weightAmount,
          weight_unit   AS weightUnit,
          photo_data    AS photoData,
          created_at    AS createdAt
     FROM nutrition_entries
    WHERE user_id = ?
      AND item_name LIKE ? ESCAPE '\\'
    ORDER BY datetime(created_at) DESC, id DESC
    LIMIT 40`
);

const entryByBarcodeStatement = db.prepare(
  `SELECT item_name     AS name,
          item_type     AS type,
          barcode,
          calories,
          protein_grams AS protein,
          carbs_grams   AS carbs,
          fats_grams    AS fats,
          weight_amount AS weightAmount,
          weight_unit   AS weightUnit
     FROM nutrition_entries
    WHERE user_id = ?
      AND barcode = ?
      AND barcode IS NOT NULL
      AND barcode != ''
    ORDER BY datetime(created_at) DESC, id DESC
    LIMIT 1`
);

const QUICK_ADD_ITEMS = [
  {
    id: 'quick-water',
    name: 'Water (500 ml)',
    keywords: ['water', 'h2o', 'plain water'],
    serving: '500 ml',
    prefill: {
      type: 'Liquid',
      calories: 0,
      protein: 0,
      carbs: 0,
      fats: 0,
      weightAmount: 500,
      weightUnit: 'ml',
    },
  },
  {
    id: 'quick-diet-coke',
    name: 'Diet Coke (can)',
    keywords: ['diet coke', 'coke zero', 'coca cola zero', 'zero coke'],
    serving: '355 ml can',
    prefill: {
      type: 'Liquid',
      calories: 0,
      protein: 0,
      carbs: 0,
      fats: 0,
      weightAmount: 355,
      weightUnit: 'ml',
      barcode: '049000050103',
    },
  },
  {
    id: 'quick-black-coffee',
    name: 'Black Coffee (12 oz)',
    keywords: ['coffee', 'black coffee', 'americano'],
    serving: '355 ml',
    prefill: {
      type: 'Liquid',
      calories: 5,
      protein: 0,
      carbs: 1,
      fats: 0,
      weightAmount: 355,
      weightUnit: 'ml',
    },
  },
  {
    id: 'quick-eggs',
    name: 'Scrambled Eggs (2 large)',
    keywords: ['egg', 'eggs', 'scrambled eggs'],
    serving: '2 large eggs',
    prefill: {
      type: 'Food',
      calories: 140,
      protein: 12,
      carbs: 1,
      fats: 10,
      weightAmount: 100,
      weightUnit: 'g',
    },
  },
  {
    id: 'quick-wheat-bread',
    name: 'Whole Wheat Bread (2 slices)',
    keywords: ['bread', 'toast', 'whole wheat'],
    serving: '2 slices',
    prefill: {
      type: 'Food',
      calories: 120,
      protein: 5,
      carbs: 22,
      fats: 2,
      weightAmount: 60,
      weightUnit: 'g',
    },
  },
  {
    id: 'quick-brown-rice',
    name: 'Brown Rice (1 cup cooked)',
    keywords: ['rice', 'brown rice'],
    serving: '1 cup cooked',
    prefill: {
      type: 'Food',
      calories: 215,
      protein: 5,
      carbs: 45,
      fats: 2,
      weightAmount: 185,
      weightUnit: 'g',
    },
  },
  {
    id: 'quick-pasta',
    name: 'Pasta (1 cup cooked)',
    keywords: ['pasta', 'noodles'],
    serving: '1 cup cooked',
    prefill: {
      type: 'Food',
      calories: 220,
      protein: 7,
      carbs: 42,
      fats: 1,
      weightAmount: 140,
      weightUnit: 'g',
    },
  },
  {
    id: 'quick-chicken-breast',
    name: 'Chicken Breast (grilled)',
    keywords: ['chicken', 'chicken breast', 'grilled chicken'],
    serving: '150 g',
    prefill: {
      type: 'Food',
      calories: 230,
      protein: 43,
      carbs: 0,
      fats: 5,
      weightAmount: 150,
      weightUnit: 'g',
    },
  },
  {
    id: 'quick-greek-yogurt',
    name: 'Plain Greek Yogurt',
    keywords: ['yogurt', 'greek yogurt'],
    serving: '170 g cup',
    prefill: {
      type: 'Food',
      calories: 100,
      protein: 17,
      carbs: 6,
      fats: 0,
      weightAmount: 170,
      weightUnit: 'g',
    },
  },
  {
    id: 'quick-apple',
    name: 'Apple (medium)',
    keywords: ['apple'],
    serving: '1 medium apple',
    prefill: {
      type: 'Food',
      calories: 95,
      protein: 0,
      carbs: 25,
      fats: 0,
      weightAmount: 180,
      weightUnit: 'g',
    },
  },
  {
    id: 'quick-banana',
    name: 'Banana (medium)',
    keywords: ['banana'],
    serving: '1 medium banana',
    prefill: {
      type: 'Food',
      calories: 105,
      protein: 1,
      carbs: 27,
      fats: 0,
      weightAmount: 120,
      weightUnit: 'g',
    },
  },
  {
    id: 'quick-peanut-butter',
    name: 'Peanut Butter (2 tbsp)',
    keywords: ['peanut butter', 'pb'],
    serving: '2 tbsp',
    prefill: {
      type: 'Food',
      calories: 190,
      protein: 8,
      carbs: 7,
      fats: 16,
      weightAmount: 32,
      weightUnit: 'g',
    },
  },
  {
    id: 'quick-almonds',
    name: 'Almonds (handful)',
    keywords: ['almonds', 'nuts'],
    serving: '28 g',
    prefill: {
      type: 'Food',
      calories: 170,
      protein: 6,
      carbs: 6,
      fats: 15,
      weightAmount: 28,
      weightUnit: 'g',
    },
  },
  {
    id: 'quick-oatmeal',
    name: 'Oatmeal (cooked)',
    keywords: ['oatmeal', 'oats', 'porridge'],
    serving: '1 cup cooked',
    prefill: {
      type: 'Food',
      calories: 150,
      protein: 6,
      carbs: 27,
      fats: 3,
      weightAmount: 240,
      weightUnit: 'g',
    },
  },
  {
    id: 'quick-sweet-potato',
    name: 'Sweet Potato (medium)',
    keywords: ['sweet potato', 'yam'],
    serving: '1 medium (130 g)',
    prefill: {
      type: 'Food',
      calories: 112,
      protein: 2,
      carbs: 26,
      fats: 0,
      weightAmount: 130,
      weightUnit: 'g',
    },
  },
  {
    id: 'quick-broccoli',
    name: 'Broccoli (steamed cup)',
    keywords: ['broccoli'],
    serving: '1 cup steamed',
    prefill: {
      type: 'Food',
      calories: 55,
      protein: 4,
      carbs: 11,
      fats: 1,
      weightAmount: 156,
      weightUnit: 'g',
    },
  },
  {
    id: 'quick-cottage-cheese',
    name: 'Cottage Cheese (1/2 cup)',
    keywords: ['cottage cheese', 'curds'],
    serving: '1/2 cup',
    prefill: {
      type: 'Food',
      calories: 110,
      protein: 13,
      carbs: 5,
      fats: 5,
      weightAmount: 113,
      weightUnit: 'g',
    },
  },
  {
    id: 'quick-avocado',
    name: 'Avocado (half)',
    keywords: ['avocado', 'guacamole'],
    serving: '1/2 avocado',
    prefill: {
      type: 'Food',
      calories: 120,
      protein: 1,
      carbs: 6,
      fats: 11,
      weightAmount: 75,
      weightUnit: 'g',
    },
  },
  {
    id: 'quick-spinach',
    name: 'Spinach (raw cup)',
    keywords: ['spinach', 'leafy greens'],
    serving: '1 cup raw',
    prefill: {
      type: 'Food',
      calories: 7,
      protein: 1,
      carbs: 1,
      fats: 0,
      weightAmount: 30,
      weightUnit: 'g',
    },
  },
  {
    id: 'quick-carrots',
    name: 'Carrots (baby handful)',
    keywords: ['carrot', 'carrots'],
    serving: '85 g',
    prefill: {
      type: 'Food',
      calories: 35,
      protein: 1,
      carbs: 8,
      fats: 0,
      weightAmount: 85,
      weightUnit: 'g',
    },
  },
  {
    id: 'quick-hummus',
    name: 'Hummus (3 tbsp)',
    keywords: ['hummus'],
    serving: '3 tbsp',
    prefill: {
      type: 'Food',
      calories: 105,
      protein: 5,
      carbs: 9,
      fats: 6,
      weightAmount: 45,
      weightUnit: 'g',
    },
  },
  {
    id: 'quick-protein-shake',
    name: 'Protein Shake (1 scoop)',
    keywords: ['protein shake', 'whey shake'],
    serving: '30 g powder',
    prefill: {
      type: 'Liquid',
      calories: 120,
      protein: 24,
      carbs: 3,
      fats: 2,
      weightAmount: 350,
      weightUnit: 'ml',
    },
  },
  {
    id: 'quick-cottage-egg',
    name: 'Egg Whites (1 cup)',
    keywords: ['egg white', 'egg whites'],
    serving: '1 cup liquid whites',
    prefill: {
      type: 'Food',
      calories: 125,
      protein: 26,
      carbs: 2,
      fats: 0,
      weightAmount: 243,
      weightUnit: 'g',
    },
  },
  {
    id: 'quick-salmon',
    name: 'Salmon Fillet (baked)',
    keywords: ['salmon', 'fish'],
    serving: '120 g',
    prefill: {
      type: 'Food',
      calories: 235,
      protein: 25,
      carbs: 0,
      fats: 14,
      weightAmount: 120,
      weightUnit: 'g',
    },
  },
  {
    id: 'quick-ground-turkey',
    name: 'Ground Turkey (lean, 4 oz)',
    keywords: ['turkey', 'ground turkey'],
    serving: '4 oz cooked',
    prefill: {
      type: 'Food',
      calories: 170,
      protein: 23,
      carbs: 0,
      fats: 8,
      weightAmount: 113,
      weightUnit: 'g',
    },
  },
  {
    id: 'quick-black-beans',
    name: 'Black Beans (1/2 cup)',
    keywords: ['beans', 'black beans'],
    serving: '1/2 cup cooked',
    prefill: {
      type: 'Food',
      calories: 110,
      protein: 7,
      carbs: 20,
      fats: 0,
      weightAmount: 85,
      weightUnit: 'g',
    },
  },
  {
    id: 'quick-lentils',
    name: 'Lentils (1 cup cooked)',
    keywords: ['lentils'],
    serving: '1 cup cooked',
    prefill: {
      type: 'Food',
      calories: 230,
      protein: 18,
      carbs: 40,
      fats: 1,
      weightAmount: 198,
      weightUnit: 'g',
    },
  },
  {
    id: 'quick-mixed-berries',
    name: 'Mixed Berries (cup)',
    keywords: ['berries', 'fruit mix'],
    serving: '1 cup',
    prefill: {
      type: 'Food',
      calories: 70,
      protein: 1,
      carbs: 17,
      fats: 0,
      weightAmount: 140,
      weightUnit: 'g',
    },
  },
  {
    id: 'quick-canned-tuna',
    name: 'Canned Tuna (in water)',
    keywords: ['tuna', 'canned tuna'],
    serving: '1 can drained',
    prefill: {
      type: 'Food',
      calories: 120,
      protein: 26,
      carbs: 0,
      fats: 1,
      weightAmount: 142,
      weightUnit: 'g',
    },
  },
  {
    id: 'quick-granola',
    name: 'Granola (1/2 cup)',
    keywords: ['granola'],
    serving: '1/2 cup',
    prefill: {
      type: 'Food',
      calories: 200,
      protein: 5,
      carbs: 32,
      fats: 6,
      weightAmount: 60,
      weightUnit: 'g',
    },
  },
  {
    id: 'quick-trail-mix',
    name: 'Trail Mix (1/4 cup)',
    keywords: ['trail mix', 'nuts mix'],
    serving: '1/4 cup',
    prefill: {
      type: 'Food',
      calories: 150,
      protein: 4,
      carbs: 17,
      fats: 8,
      weightAmount: 40,
      weightUnit: 'g',
    },
  },
  {
    id: 'quick-cheddar',
    name: 'Cheddar Cheese (1 oz)',
    keywords: ['cheddar', 'cheese'],
    serving: '28 g',
    prefill: {
      type: 'Food',
      calories: 115,
      protein: 7,
      carbs: 1,
      fats: 9,
      weightAmount: 28,
      weightUnit: 'g',
    },
  },
  {
    id: 'quick-yogurt-parfait',
    name: 'Yogurt Parfait (cup)',
    keywords: ['parfait'],
    serving: '1 cup',
    prefill: {
      type: 'Food',
      calories: 180,
      protein: 10,
      carbs: 30,
      fats: 4,
      weightAmount: 220,
      weightUnit: 'g',
    },
  },
  {
    id: 'quick-orange-juice',
    name: 'Orange Juice (250 ml)',
    keywords: ['orange juice', 'oj'],
    serving: '250 ml',
    prefill: {
      type: 'Liquid',
      calories: 110,
      protein: 2,
      carbs: 26,
      fats: 0,
      weightAmount: 250,
      weightUnit: 'ml',
    },
  },
  {
    id: 'quick-iced-tea',
    name: 'Unsweet Iced Tea (16 oz)',
    keywords: ['iced tea', 'tea'],
    serving: '16 oz',
    prefill: {
      type: 'Liquid',
      calories: 5,
      protein: 0,
      carbs: 1,
      fats: 0,
      weightAmount: 473,
      weightUnit: 'ml',
    },
  },
  {
    id: 'quick-sparkling-water',
    name: 'Sparkling Water (can)',
    keywords: ['sparkling water', 'seltzer'],
    serving: '355 ml',
    prefill: {
      type: 'Liquid',
      calories: 0,
      protein: 0,
      carbs: 0,
      fats: 0,
      weightAmount: 355,
      weightUnit: 'ml',
    },
  },
  {
    id: 'quick-tofu',
    name: 'Tofu (firm, 100 g)',
    keywords: ['tofu'],
    serving: '100 g',
    prefill: {
      type: 'Food',
      calories: 85,
      protein: 9,
      carbs: 3,
      fats: 5,
      weightAmount: 100,
      weightUnit: 'g',
    },
  },
  {
    id: 'quick-quinoa',
    name: 'Quinoa (1 cup cooked)',
    keywords: ['quinoa'],
    serving: '1 cup cooked',
    prefill: {
      type: 'Food',
      calories: 220,
      protein: 8,
      carbs: 39,
      fats: 4,
      weightAmount: 185,
      weightUnit: 'g',
    },
  },
  {
    id: 'quick-bagel',
    name: 'Bagel (plain)',
    keywords: ['bagel'],
    serving: '1 medium bagel',
    prefill: {
      type: 'Food',
      calories: 270,
      protein: 10,
      carbs: 55,
      fats: 2,
      weightAmount: 105,
      weightUnit: 'g',
    },
  },
  {
    id: 'quick-flour-tortilla',
    name: 'Flour Tortilla (large)',
    keywords: ['tortilla', 'wrap'],
    serving: '1 large tortilla',
    prefill: {
      type: 'Food',
      calories: 180,
      protein: 6,
      carbs: 30,
      fats: 4,
      weightAmount: 60,
      weightUnit: 'g',
    },
  },
  {
    id: 'quick-olive-oil',
    name: 'Olive Oil (1 tbsp)',
    keywords: ['olive oil', 'oil'],
    serving: '1 tbsp',
    prefill: {
      type: 'Food',
      calories: 119,
      protein: 0,
      carbs: 0,
      fats: 14,
      weightAmount: 14,
      weightUnit: 'g',
    },
  },
  {
    id: 'quick-butter',
    name: 'Butter (1 tbsp)',
    keywords: ['butter'],
    serving: '1 tbsp',
    prefill: {
      type: 'Food',
      calories: 100,
      protein: 0,
      carbs: 0,
      fats: 11,
      weightAmount: 14,
      weightUnit: 'g',
    },
  },
  {
    id: 'quick-cheese-stick',
    name: 'Cheese Stick (mozzarella)',
    keywords: ['string cheese', 'mozzarella'],
    serving: '1 stick',
    prefill: {
      type: 'Food',
      calories: 80,
      protein: 7,
      carbs: 1,
      fats: 6,
      weightAmount: 28,
      weightUnit: 'g',
    },
  },
  {
    id: 'quick-protein-bar',
    name: 'Protein Bar (generic)',
    keywords: ['protein bar', 'bar'],
    serving: '1 bar',
    prefill: {
      type: 'Food',
      calories: 210,
      protein: 20,
      carbs: 22,
      fats: 8,
      weightAmount: 60,
      weightUnit: 'g',
    },
  },
  {
    id: 'quick-veggie-burger',
    name: 'Veggie Burger Patty',
    keywords: ['veggie burger', 'plant-based patty'],
    serving: '1 patty',
    prefill: {
      type: 'Food',
      calories: 150,
      protein: 15,
      carbs: 10,
      fats: 6,
      weightAmount: 100,
      weightUnit: 'g',
    },
  },
  {
    id: 'quick-cauliflower',
    name: 'Cauliflower Rice (cup)',
    keywords: ['cauliflower', 'cauli rice'],
    serving: '1 cup',
    prefill: {
      type: 'Food',
      calories: 25,
      protein: 2,
      carbs: 5,
      fats: 0,
      weightAmount: 120,
      weightUnit: 'g',
    },
  },
  {
    id: 'quick-potato',
    name: 'Baked Potato (medium)',
    keywords: ['potato', 'baked potato', 'white potato'],
    serving: '1 medium potato',
    prefill: {
      type: 'Food',
      calories: 160,
      protein: 4,
      carbs: 37,
      fats: 0,
      weightAmount: 173,
      weightUnit: 'g',
    },
  },
  {
    id: 'quick-onion',
    name: 'Onion (medium)',
    keywords: ['onion', 'yellow onion', 'white onion', 'red onion'],
    serving: '1 medium onion',
    prefill: {
      type: 'Food',
      calories: 45,
      protein: 1,
      carbs: 11,
      fats: 0,
      weightAmount: 110,
      weightUnit: 'g',
    },
  },
  {
    id: 'quick-chia-pudding',
    name: 'Chia Pudding (1/2 cup)',
    keywords: ['chia', 'chia pudding'],
    serving: '1/2 cup',
    prefill: {
      type: 'Food',
      calories: 150,
      protein: 5,
      carbs: 12,
      fats: 9,
      weightAmount: 120,
      weightUnit: 'g',
    },
  },
  {
    id: 'quick-edamame',
    name: 'Edamame (1 cup shelled)',
    keywords: ['edamame', 'soybeans'],
    serving: '1 cup shelled',
    prefill: {
      type: 'Food',
      calories: 190,
      protein: 17,
      carbs: 15,
      fats: 8,
      weightAmount: 155,
      weightUnit: 'g',
    },
  },
  {
    id: 'quick-pbj',
    name: 'PB&J Sandwich',
    keywords: ['pb&j', 'peanut butter jelly'],
    serving: '1 sandwich',
    prefill: {
      type: 'Food',
      calories: 330,
      protein: 11,
      carbs: 42,
      fats: 14,
      weightAmount: 140,
      weightUnit: 'g',
    },
  },
  {
    id: 'quick-tomato-soup',
    name: 'Tomato Soup (cup)',
    keywords: ['tomato soup', 'soup'],
    serving: '1 cup',
    prefill: {
      type: 'Liquid',
      calories: 90,
      protein: 3,
      carbs: 18,
      fats: 1,
      weightAmount: 245,
      weightUnit: 'ml',
    },
  },
  {
    id: 'quick-apple-juice',
    name: 'Apple Juice (8 oz)',
    keywords: ['apple juice'],
    serving: '240 ml',
    prefill: {
      type: 'Liquid',
      calories: 110,
      protein: 0,
      carbs: 27,
      fats: 0,
      weightAmount: 240,
      weightUnit: 'ml',
    },
  },
];

const ISO_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const NON_FOOD_TERMS = [
  'packaging',
  'package',
  'promo',
  'promotion',
  'coupon',
  'voucher',
  'sample',
  'test product',
  'test item',
  'gift card',
  'sticker',
  'tray',
  'fork',
  'spoon',
  'knife',
  'cutlery',
  'napkin',
  'straw',
  'utensil',
  'tableware',
  'lid',
  'cap',
  'container',
  'film',
  'plastic film',
  'sachet',
  'bag for',
  'bottle deposit',
  'package insert',
  'label',
  'brochure',
  'flyer',
  'merch',
  'pack of',
  'bundle',
  'collector',
  'souvenir',
  'straws',
  'cups',
  'plates',
  'wrapper',
  'advertisement',
];
const PROMO_PATTERNS = [
  /scan\s+to\s+win/,
  /scan.*win/,
  /win.*scan/,
  /enter.*win/,
  /collect.*points/,
  /instant\s+win/,
  /game\s*piece/,
  /contest/,
  /sweepstake/,
  /promotion/,
];

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function resolveDate(input) {
  if (typeof input === 'string' && ISO_DATE_REGEX.test(input.trim())) {
    return input.trim();
  }
  return todayIso();
}

function canViewSubject(viewerId, viewerRole, subjectId) {
  if (viewerId === subjectId) {
    return true;
  }
  if (isHeadCoach(viewerRole)) {
    return true;
  }
  const link = accessStatement.get(viewerId, subjectId);
  return Boolean(link);
}

function computeTotals(entries = []) {
  if (!entries.length) {
    return null;
  }
  return entries.reduce(
    (acc, entry) => ({
      calories: acc.calories + (entry.calories || 0),
      protein: acc.protein + (entry.protein || 0),
      carbs: acc.carbs + (entry.carbs || 0),
      fats: acc.fats + (entry.fats || 0),
      count: acc.count + 1,
    }),
    { calories: 0, protein: 0, carbs: 0, fats: 0, count: 0 }
  );
}

function normalizeGoals(subject, latestGoal) {
  return {
    calories: latestGoal?.calories ?? subject.goalCalories ?? null,
    protein: latestGoal?.protein ?? null,
    carbs: latestGoal?.carbs ?? null,
    fats: latestGoal?.fats ?? null,
  };
}

function normalizeGoalInput(value, { max = 10000 } = {}) {
  const numeric = Number.parseInt(value, 10);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return null;
  }
  return Math.min(numeric, max);
}

function parseServingSize(value, fallbackUnit = 'g') {
  if (!value) return null;
  const raw = value.toString().trim();
  if (!raw) return null;
  const normalized = raw.toLowerCase();

  const gramMatch = normalized.match(/(\d[\d.,]*)\s*g/);
  const kgMatch = normalized.match(/(\d[\d.,]*)\s*kg/);
  const mlMatch = normalized.match(/(\d[\d.,]*)\s*ml/);
  const litreMatch = normalized.match(/(\d[\d.,]*)\s*l/);
  const portionMatch = normalized.match(/(\d[\d.,]*)?\s*(serving|portion)/);

  let gramsEquivalent = null;
  if (gramMatch) {
    gramsEquivalent = Number.parseFloat(gramMatch[1].replace(',', '.'));
  } else if (kgMatch) {
    gramsEquivalent = Number.parseFloat(kgMatch[1].replace(',', '.')) * 1000;
  }
  if (Number.isFinite(gramsEquivalent)) {
    gramsEquivalent = Math.round(gramsEquivalent * 10) / 10;
  } else {
    gramsEquivalent = null;
  }

  let mlEquivalent = null;
  if (mlMatch) {
    mlEquivalent = Number.parseFloat(mlMatch[1].replace(',', '.'));
  } else if (litreMatch) {
    mlEquivalent = Number.parseFloat(litreMatch[1].replace(',', '.')) * 1000;
  }
  if (Number.isFinite(mlEquivalent)) {
    mlEquivalent = Math.round(mlEquivalent * 10) / 10;
  } else {
    mlEquivalent = null;
  }

  if (portionMatch) {
    const portionAmount = Number.parseFloat(
      portionMatch[1] ? portionMatch[1].replace(',', '.') : '1'
    );
    const amount = Number.isFinite(portionAmount) && portionAmount > 0 ? portionAmount : 1;
    return {
      amount,
      unit: 'portion',
      gramsEquivalent,
      mlEquivalent,
    };
  }

  if (Number.isFinite(gramsEquivalent) && gramsEquivalent > 0) {
    return {
      amount: gramsEquivalent,
      unit: 'g',
      gramsEquivalent,
    };
  }

  if (Number.isFinite(mlEquivalent) && mlEquivalent > 0) {
    return {
      amount: mlEquivalent,
      unit: 'ml',
      mlEquivalent,
    };
  }

  if (normalized.includes('portion') || normalized.includes('serving')) {
    return {
      amount: 1,
      unit: 'portion',
      gramsEquivalent,
      mlEquivalent,
    };
  }

  if (fallbackUnit) {
    return {
      amount: 1,
      unit: fallbackUnit,
    };
  }

  return null;
}

function guessUnitFromNutritionData(nutritionPer = '') {
  const normalized = nutritionPer.toString().trim().toLowerCase();
  if (normalized.includes('ml')) return 'ml';
  return 'g';
}

function parseNutritionFromProduct(product = {}) {
  if (!product) return null;
  const nutriments = product.nutriments || {};
  const caloriesServing = Number.parseFloat(nutriments['energy-kcal_serving']);
  const caloriesPer100g = Number.parseFloat(nutriments['energy-kcal_100g']);
  const caloriesPer100ml = Number.parseFloat(nutriments['energy-kcal_100ml']);
  const caloriesGeneric = Number.parseFloat(nutriments['energy-kcal']);
  const rawServing =
    product.serving_size ||
    product.serving_quantity ||
    product.quantity ||
    product.portion_display_name ||
    '';
  const parsedServing = parseServingSize(rawServing, null);
  const hasServingInfo = Boolean(parsedServing);

  let macroSource = null;
  let calories = null;
  if (Number.isFinite(caloriesServing) && hasServingInfo) {
    calories = caloriesServing;
    macroSource = 'serving';
  } else if (Number.isFinite(caloriesPer100g)) {
    calories = caloriesPer100g;
    macroSource = '100g';
  } else if (Number.isFinite(caloriesPer100ml)) {
    calories = caloriesPer100ml;
    macroSource = '100ml';
  } else if (Number.isFinite(caloriesServing)) {
    calories = caloriesServing;
    macroSource = 'serving';
  } else if (Number.isFinite(caloriesGeneric)) {
    calories = caloriesGeneric;
    macroSource = 'generic';
  }

  const protein =
    Number.parseFloat(nutriments.proteins_serving) ||
    Number.parseFloat(nutriments.proteins_100g) ||
    null;
  const carbs =
    Number.parseFloat(nutriments.carbohydrates_serving) ||
    Number.parseFloat(nutriments.carbohydrates_100g) ||
    null;
  const fats =
    Number.parseFloat(nutriments.fat_serving) ||
    Number.parseFloat(nutriments.fat_100g) ||
    null;

  if (![calories, protein, carbs, fats].some((value) => Number.isFinite(value))) {
    return null;
  }

  let servingInfo = parsedServing || null;
  const nutritionDataPer = (product.nutrition_data_per || '').toString().toLowerCase();
  const fallbackUnit = guessUnitFromNutritionData(product.nutrition_data_per);

  if (!servingInfo) {
    if (macroSource === '100g') {
      servingInfo = { amount: 100, unit: 'g', gramsEquivalent: 100 };
    } else if (macroSource === '100ml') {
      servingInfo = { amount: 100, unit: 'ml', mlEquivalent: 100 };
    } else if (macroSource === 'serving' || nutritionDataPer.includes('serving')) {
      servingInfo = { amount: 1, unit: 'portion' };
    } else if (fallbackUnit) {
      servingInfo = { amount: 1, unit: fallbackUnit };
    }
  }

  const weightAmount = servingInfo?.amount || null;
  const weightUnit = servingInfo?.unit || null;
  let weightGramsEquivalent =
    servingInfo?.gramsEquivalent ?? (weightUnit === 'g' ? weightAmount : null);
  let weightMlEquivalent =
    servingInfo?.mlEquivalent ?? (weightUnit === 'ml' ? weightAmount : null);

  if (
    (!weightGramsEquivalent || weightGramsEquivalent <= 0) &&
    Number.isFinite(caloriesServing) &&
    Number.isFinite(caloriesPer100g) &&
    caloriesPer100g > 0
  ) {
    const derived = (caloriesServing / caloriesPer100g) * 100;
    if (Number.isFinite(derived) && derived > 0) {
      weightGramsEquivalent = Math.round(derived * 10) / 10;
    }
  }

  if (
    (!weightMlEquivalent || weightMlEquivalent <= 0) &&
    Number.isFinite(caloriesServing) &&
    Number.isFinite(caloriesPer100ml) &&
    caloriesPer100ml > 0
  ) {
    const derived = (caloriesServing / caloriesPer100ml) * 100;
    if (Number.isFinite(derived) && derived > 0) {
      weightMlEquivalent = Math.round(derived * 10) / 10;
    }
  }

  return {
    name: product.product_name || product.generic_name || product.brands || 'Unknown item',
    barcode: product.code || null,
    calories: calories ? Math.round(calories) : null,
    protein: Number.isFinite(protein) ? Math.round(protein) : null,
    carbs: Number.isFinite(carbs) ? Math.round(carbs) : null,
    fats: Number.isFinite(fats) ? Math.round(fats) : null,
    weightAmount,
    weightUnit,
    weightGramsEquivalent,
    weightMlEquivalent,
  };
}

async function lookupByBarcode(barcode, options = {}) {
  const normalizedBarcode = normalizeBarcodeValue(barcode);
  if (!normalizedBarcode) {
    return null;
  }
  const cached = getCachedBarcodeResult(normalizedBarcode);
  if (cached) {
    return cached;
  }
  if (options.userId) {
    const localProduct = lookupLocalProductByBarcode(options.userId, normalizedBarcode);
    if (localProduct) {
      setCachedBarcodeResult(normalizedBarcode, localProduct);
      return localProduct;
    }
  }
  const productUrl = new URL(
    `/product/${encodeURIComponent(normalizedBarcode)}.json`,
    UPC_LOOKUP_URL
  );
  productUrl.searchParams.set('fields', 'code,product_name,generic_name,brands,nutriments');

  const data = await fetchJson(productUrl);
  if (!data?.product) {
    return null;
  }
  const parsed = parseNutritionFromProduct(data.product);
  if (parsed) {
    setCachedBarcodeResult(normalizedBarcode, parsed);
  }
  return parsed;
}

async function lookupByQuery(query) {
  const searchParams = new URLSearchParams({
    search_terms: query,
    search_simple: '1',
    action: 'process',
    json: '1',
    page_size: '1',
    fields: 'code,product_name,generic_name,brands,nutriments',
  });
  const data = await fetchJson(`${SEARCH_URL}?${searchParams.toString()}`);
  const firstHit = data?.products?.[0];
  if (!firstHit) {
    return null;
  }
  return parseNutritionFromProduct(firstHit);
}

async function lookupProduct({ barcode, query, userId }) {
  if (barcode) {
    const result = await lookupByBarcode(barcode, { userId });
    if (result) return result;
  }
  if (query) {
    return lookupByQuery(query);
  }
  return null;
}

function escapeLikePattern(value = '') {
  return value.replace(/([%_\\])/g, '\\$1');
}

function normalizeText(value = '') {
  return value.toString().trim().toLowerCase();
}

function normalizeBarcodeValue(value = '') {
  return value ? value.toString().trim() : '';
}

function parseNullableNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function trimBarcodeLookupCache(limit = BARCODE_LOOKUP_CACHE_LIMIT) {
  if (!limit || limit <= 0) {
    return;
  }
  while (barcodeLookupCache.size > limit) {
    const oldestKey = barcodeLookupCache.keys().next().value;
    if (!oldestKey) {
      break;
    }
    barcodeLookupCache.delete(oldestKey);
  }
}

function setCachedBarcodeResult(barcode, product) {
  const normalized = normalizeBarcodeValue(barcode);
  if (!normalized || !product) {
    return;
  }
  barcodeLookupCache.set(normalized, {
    data: product,
    expiresAt: Date.now() + BARCODE_LOOKUP_CACHE_TTL_MS,
  });
  trimBarcodeLookupCache();
}

function getCachedBarcodeResult(barcode) {
  const normalized = normalizeBarcodeValue(barcode);
  if (!normalized) {
    return null;
  }
  const entry = barcodeLookupCache.get(normalized);
  if (!entry) {
    return null;
  }
  if (entry.expiresAt <= Date.now()) {
    barcodeLookupCache.delete(normalized);
    return null;
  }
  return entry.data;
}

function mapEntryToProduct(row) {
  if (!row) return null;
  const weightAmount = parseNullableNumber(row.weightAmount);
  return {
    name: row.name || 'Logged item',
    barcode: row.barcode || null,
    calories: parseNullableNumber(row.calories),
    protein: parseNullableNumber(row.protein),
    carbs: parseNullableNumber(row.carbs),
    fats: parseNullableNumber(row.fats),
    weightAmount: weightAmount ?? null,
    weightUnit: row.weightUnit || null,
    weightGramsEquivalent: null,
    weightMlEquivalent: null,
  };
}

function lookupLocalProductByBarcode(userId, barcode) {
  const normalized = normalizeBarcodeValue(barcode);
  if (!normalized) {
    return null;
  }
  const numericId = Number(userId);
  if (!Number.isFinite(numericId)) {
    return null;
  }
  const row = entryByBarcodeStatement.get(numericId, normalized);
  if (!row) {
    return null;
  }
  return mapEntryToProduct(row);
}

function levenshteinDistance(a = '', b = '') {
  const lenA = a.length;
  const lenB = b.length;
  if (!lenA) return lenB;
  if (!lenB) return lenA;
  const prevRow = Array(lenB + 1)
    .fill(0)
    .map((_, index) => index);
  const currentRow = new Array(lenB + 1);
  for (let i = 1; i <= lenA; i += 1) {
    currentRow[0] = i;
    for (let j = 1; j <= lenB; j += 1) {
      if (a[i - 1] === b[j - 1]) {
        currentRow[j] = prevRow[j - 1];
      } else {
        currentRow[j] = Math.min(prevRow[j - 1], prevRow[j], currentRow[j - 1]) + 1;
      }
    }
    for (let j = 0; j <= lenB; j += 1) {
      prevRow[j] = currentRow[j];
    }
  }
  return prevRow[lenB];
}

function tokenMatches(word = '', token = '') {
  if (!word || !token) return false;
  if (word === token) return true;
  if (word.startsWith(token) || word.includes(token)) return true;
  if (word.length >= 3 && token.length >= 3) {
    const dist = levenshteinDistance(word, token);
    const normalizedDist = dist / Math.max(word.length, token.length);
    return normalizedDist <= 0.35;
  }
  return false;
}

function computeTokenCoverageFromTokens(nameTokens = [], queryTokens = []) {
  if (!nameTokens.length || !queryTokens.length) return 0;
  let matches = 0;
  queryTokens.forEach((token) => {
    if (token && nameTokens.some((word) => tokenMatches(word, token))) {
      matches += 1;
    }
  });
  return Math.min(matches / queryTokens.length, 1);
}

function computeTokenCoverageRatio(text = '', query = '') {
  const nameTokens = normalizeText(text)
    .split(/\s+/)
    .filter(Boolean);
  const queryTokens = normalizeText(query)
    .split(/\s+/)
    .filter(Boolean);
  return computeTokenCoverageFromTokens(nameTokens, queryTokens);
}

function computeSuggestionScore(text = '', query = '') {
  const normalizedText = normalizeText(text);
  const normalizedQuery = normalizeText(query);
  if (!normalizedText || !normalizedQuery) {
    return 99;
  }
  if (!isLikelyFoodName(normalizedText)) {
    return 98;
  }
  if (normalizedText === normalizedQuery) {
    return 0;
  }
  const fullDistance = levenshteinDistance(normalizedText, normalizedQuery);
  const normalizedFull = fullDistance / Math.max(normalizedText.length, normalizedQuery.length);
  let bestTokenScore = normalizedFull;
  const nameTokens = normalizedText.split(/\s+/).filter(Boolean);
  const queryTokens = normalizedQuery.split(/\s+/).filter(Boolean);
  queryTokens.forEach((token) => {
    nameTokens.forEach((word) => {
      const dist = levenshteinDistance(word, token);
      const normalizedDist = dist / Math.max(word.length, token.length);
      if (normalizedDist < bestTokenScore) {
        bestTokenScore = normalizedDist;
      }
    });
  });
  let bonus = 0;
  if (normalizedText.startsWith(normalizedQuery)) {
    bonus -= 0.15;
  } else if (normalizedText.includes(normalizedQuery)) {
    bonus -= 0.1;
  }
  let coverageRatio = 0;
  coverageRatio = computeTokenCoverageFromTokens(nameTokens, queryTokens);
  if (coverageRatio) {
    bonus -= coverageRatio * 0.25;
  }
  let coveragePenalty = 0;
  if (queryTokens.length > 1) {
    const missingRatio = Math.max(1 - coverageRatio, 0);
    // Penalize suggestions that only cover a small portion of a multi-word query.
    coveragePenalty = missingRatio * 0.5;
  }
  const baseScore = Math.max(bestTokenScore + bonus + coveragePenalty, 0);
  return Number(baseScore.toFixed(4));
}

function isLikelyFoodName(name = '') {
  const normalized = normalizeText(name);
  if (!normalized || normalized.length < 3) return false;
  if (!/[a-z]/i.test(normalized)) return false;
  if (NON_FOOD_TERMS.some((term) => normalized.includes(term))) {
    return false;
  }
  if (PROMO_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return false;
  }
  return true;
}

function hasNutritionData(nutriments = {}) {
  const keys = [
    'energy-kcal',
    'energy-kcal_100g',
    'energy-kcal_serving',
    'proteins_100g',
    'proteins_serving',
    'carbohydrates_100g',
    'carbohydrates_serving',
    'fat_100g',
    'fat_serving',
  ];
  return keys.some((key) => Number.isFinite(Number.parseFloat(nutriments[key])));
}

function bestKeywordScore(keywords = [], query = '') {
  if (!Array.isArray(keywords) || !keywords.length) {
    return 99;
  }
  return keywords.reduce((best, keyword) => {
    const score = computeSuggestionScore(keyword, query);
    return score < best ? score : best;
  }, 99);
}

function hasTokenOverlap(name = '', query = '') {
  const normalizedName = normalizeText(name);
  const normalizedQuery = normalizeText(query);
  if (!normalizedName || !normalizedQuery) return false;
  if (normalizedName.includes(normalizedQuery)) return true;
  const tokens = normalizedQuery.split(/\s+/).filter((token) => token.length >= 2);
  return tokens.some((token) => normalizedName.includes(token));
}

function isRelevantMatch(name = '', query = '', maxScore = 0.6) {
  if (!name || !query) return false;
  if (hasTokenOverlap(name, query)) return true;
  const score = computeSuggestionScore(name, query);
  return score <= maxScore;
}

function formatWeightLabel(amount, unit) {
  const numeric = Number(amount);
  if (!Number.isFinite(numeric) || numeric <= 0 || !unit) {
    return null;
  }
  return `${Math.round(numeric * 10) / 10} ${unit}`;
}

function searchLocalEntries(userId, query) {
  if (!query || !query.trim()) {
    return [];
  }
  const likeTerm = `%${escapeLikePattern(query.trim())}%`;
  const rows = localSuggestionStatement.all(userId, likeTerm);
  const seen = new Set();
  const suggestions = [];
  rows.forEach((row) => {
    const key = row.name?.toLowerCase().trim();
    if (!key || seen.has(key) || !isLikelyFoodName(row.name)) {
      return;
    }
    seen.add(key);
    const weightLabel = formatWeightLabel(row.weightAmount, row.weightUnit);
    const score = computeSuggestionScore(row.name, query);
    suggestions.push({
      id: `recent-${row.id}`,
      name: row.name,
      barcode: row.barcode,
      serving: weightLabel,
      source: 'Recent',
      prefill: {
        calories: Number.isFinite(row.calories) ? row.calories : null,
        protein: Number.isFinite(row.protein) ? row.protein : null,
        carbs: Number.isFinite(row.carbs) ? row.carbs : null,
        fats: Number.isFinite(row.fats) ? row.fats : null,
        weightAmount: Number.isFinite(row.weightAmount) ? row.weightAmount : null,
        weightUnit: row.weightUnit || null,
        type: row.type || 'Food',
        barcode: row.barcode || null,
      },
      score,
    });
  });
  suggestions.sort((a, b) => (a.score ?? 99) - (b.score ?? 99));
  return suggestions.slice(0, 5);
}

function searchQuickAddSuggestions(query) {
  if (!query || !query.trim()) return [];
  const normalized = query.toLowerCase();
  return QUICK_ADD_ITEMS.map((item) => {
    const keywordScore = bestKeywordScore(item.keywords || [], normalized);
    const nameScore = computeSuggestionScore(item.name, query);
    if (keywordScore > 0.85 && nameScore > 0.6 && !hasTokenOverlap(item.name, query)) {
      return null;
    }
    const blended = Math.min(nameScore, keywordScore - 0.1);
    return {
      id: item.id,
      name: item.name,
      serving: item.serving,
      source: 'Quick Add',
      barcode: item.prefill?.barcode || null,
      prefill: item.prefill,
      score: blended,
    };
  })
    .filter(Boolean)
    .sort((a, b) => (a.score ?? 99) - (b.score ?? 99))
    .slice(0, 6);
}
async function searchProducts(query) {
  const searchParams = new URLSearchParams({
    search_terms: query,
    search_simple: '1',
    action: 'process',
    json: '1',
    page_size: '8',
    fields: 'code,product_name,generic_name,brands,serving_size,nutriments',
  });
  const data = await fetchJson(`${SEARCH_URL}?${searchParams.toString()}`);
  const products = data?.products || [];
  return products
    .map((product) => ({
      id: product.code || product._id,
      name: product.product_name || product.generic_name || product.brands || 'Unnamed item',
      barcode: product.code || null,
      serving: product.serving_size || null,
      source: product.brands || 'OpenFoodFacts',
      nutriments: product.nutriments || {},
    }))
    .filter(
      (item) =>
        item.name &&
        isLikelyFoodName(item.name) &&
        hasNutritionData(item.nutriments) &&
        isRelevantMatch(item.name, query, 0.55)
    )
    .map(({ nutriments, ...rest }) => rest)
    .slice(0, 5);
}

function trimRemoteSuggestionCache(limit = REMOTE_SEARCH_CACHE_LIMIT) {
  if (!limit || limit <= 0) {
    return;
  }
  while (remoteSuggestionCache.size > limit) {
    const oldestKey = remoteSuggestionCache.keys().next().value;
    if (!oldestKey) {
      break;
    }
    remoteSuggestionCache.delete(oldestKey);
  }
}

function startRemoteSuggestionFetch(key, query, searchFn, ttlMs, existingEntry = null) {
  const entry =
    existingEntry ||
    {
      data: null,
      expiresAt: Date.now() + ttlMs,
      inflight: null,
    };
  entry.inflight = Promise.resolve()
    .then(() => searchFn(query))
    .then((results) => {
      entry.data = Array.isArray(results) ? results : [];
      entry.expiresAt = Date.now() + ttlMs;
      entry.inflight = null;
      return entry.data;
    })
    .catch((error) => {
      entry.inflight = null;
      if (!entry.data || !entry.data.length) {
        remoteSuggestionCache.delete(key);
      }
      throw error;
    });
  remoteSuggestionCache.set(key, entry);
  trimRemoteSuggestionCache();
  return entry;
}

function raceWithTimeout(promise, timeoutMs) {
  if (!promise) {
    return Promise.resolve({ value: null });
  }
  if (!timeoutMs || timeoutMs <= 0) {
    return promise
      .then((value) => ({ value }))
      .catch((error) => ({ error }));
  }
  let timeoutId;
  const timeoutPromise = new Promise((resolve) => {
    timeoutId = setTimeout(() => resolve({ timedOut: true }), timeoutMs);
  });
  return Promise.race([
    promise
      .then((value) => ({ value }))
      .catch((error) => ({ error })),
    timeoutPromise,
  ]).finally(() => {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  });
}

async function getRemoteSuggestions(query, options = {}) {
  const normalizedKey = normalizeText(query);
  if (!normalizedKey) {
    return [];
  }
  const now = Date.now();
  const searchFn = typeof options.searchFn === 'function' ? options.searchFn : searchProducts;
  const timeoutMs =
    Number.isFinite(options.timeoutMs) && options.timeoutMs > 0
      ? options.timeoutMs
      : REMOTE_SEARCH_TIMEOUT_MS;
  const ttlMs =
    Number.isFinite(options.ttlMs) && options.ttlMs > 0
      ? options.ttlMs
      : REMOTE_SEARCH_CACHE_TTL_MS;
  let entry = remoteSuggestionCache.get(normalizedKey);
  if (!entry) {
    entry = startRemoteSuggestionFetch(normalizedKey, query, searchFn, ttlMs);
  } else if (entry.expiresAt <= now && !entry.inflight) {
    entry = startRemoteSuggestionFetch(normalizedKey, query, searchFn, ttlMs, entry);
  }
  if (entry.data && entry.expiresAt > now) {
    return entry.data;
  }
  if (entry.data && entry.inflight) {
    return entry.data;
  }
  if (!entry.inflight) {
    return entry.data || [];
  }
  const outcome = await raceWithTimeout(entry.inflight, timeoutMs);
  if (outcome && Array.isArray(outcome.value)) {
    return outcome.value;
  }
  return [];
}

function clearRemoteSuggestionCache() {
  remoteSuggestionCache.clear();
}

router.get('/', authenticate, (req, res) => {
  const viewerId = req.user.id;
  const viewerRole = coerceRole(req.user.role);
  const requestedId = Number.parseInt(req.query.athleteId, 10);
  const subjectId = Number.isNaN(requestedId) ? viewerId : requestedId;

  const subject = selectUser.get(subjectId);
  if (!subject) {
    return res.status(404).json({ message: 'Athlete not found.' });
  }

  if (!canViewSubject(viewerId, viewerRole, subjectId)) {
    return res.status(403).json({ message: 'Not authorized to view that athlete.' });
  }

  const activeDate = resolveDate(req.query.date);
  const entries = entriesByDateStatement.all(subjectId, activeDate);
  const totals = computeTotals(entries);
  const latestGoal = latestGoalStatement.get(subjectId);
  const goals = normalizeGoals(subject, latestGoal);

  const macroHistory = macrosByDateStatement.all(subjectId);
  const macroMap = new Map(macroHistory.map((row) => [row.date, row]));
  const thirtyDaysAgo = new Date(activeDate);
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 29);
  const windowStart = thirtyDaysAgo.toISOString().slice(0, 10);
  const rawTrend = windowTotalsStatement.all(subjectId, windowStart);
  const monthTrend = rawTrend.map((row) => {
    const dayGoals = macroMap.get(row.date) || goals;
    const percent =
      dayGoals.calories && row.calories
        ? Math.round((row.calories / dayGoals.calories) * 100)
        : null;
    return {
      date: row.date,
      calories: row.calories || 0,
      protein: row.protein || 0,
      carbs: row.carbs || 0,
      fats: row.fats || 0,
      targetCalories: dayGoals.calories,
      percent,
    };
  });

  return res.json({
    date: activeDate,
    goals,
    dailyTotals: totals,
    entries,
    monthTrend,
    subjectId,
  });
});

router.post('/macros', authenticate, (req, res) => {
  const viewerRole = coerceRole(req.user.role);
  const requestedId = Number.parseInt(req.body?.athleteId, 10);
  const subjectId = Number.isNaN(requestedId) ? req.user.id : requestedId;
  const editingOwnProfile = subjectId === req.user.id;

  if (!editingOwnProfile && !isHeadCoach(viewerRole)) {
    return res
      .status(403)
      .json({ message: 'Not authorized to update macro targets for that athlete.' });
  }

  const subject = selectUser.get(subjectId);
  if (!subject) {
    return res.status(404).json({ message: 'Athlete not found.' });
  }

  const payload = {
    calories: normalizeGoalInput(req.body?.calories, { max: 15000 }),
    protein: normalizeGoalInput(req.body?.protein, { max: 1200 }),
    carbs: normalizeGoalInput(req.body?.carbs, { max: 1500 }),
    fats: normalizeGoalInput(req.body?.fats, { max: 800 }),
  };
  const hasAnyTarget = Object.values(payload).some((value) => value !== null);
  if (!hasAnyTarget) {
    return res.status(400).json({ message: 'Provide at least one macro target.' });
  }

  const targetDate = resolveDate(req.body?.date);
  deleteMacroByDateStatement.run(subjectId, targetDate);
  insertMacroStatement.run(
    subjectId,
    targetDate,
    payload.calories,
    payload.protein,
    payload.carbs,
    payload.fats
  );

  const latestGoal = latestGoalStatement.get(subjectId);
  const goals = normalizeGoals(subject, latestGoal);

  return res.json({
    message: `Macro targets saved for ${targetDate}.`,
    date: targetDate,
    goals,
  });
});

router.post('/', authenticate, async (req, res) => {
  const userId = req.user.id;
  const {
    name,
    type,
    calories,
    protein,
    carbs,
    fats,
    barcode,
    date,
    weightAmount,
    weightUnit,
    photoData,
  } = req.body || {};

  const trimmedName = typeof name === 'string' ? name.trim() : '';
  const trimmedBarcode = typeof barcode === 'string' ? barcode.trim() : '';

  if (!trimmedName && !trimmedBarcode) {
    return res.status(400).json({ message: 'Provide a food name or barcode.' });
  }

  let calorieValue = Number.parseInt(calories, 10);
  let proteinValue = Number.parseInt(protein, 10);
  let carbValue = Number.parseInt(carbs, 10);
  let fatValue = Number.parseInt(fats, 10);
  let productData = null;
  const needsLookup = !Number.isFinite(calorieValue);
  const normalizedType = type === 'Liquid' ? 'Liquid' : 'Food';
  const defaultUnit = normalizedType === 'Liquid' ? 'ml' : 'g';
  const requestedUnit = typeof weightUnit === 'string' ? weightUnit.trim().toLowerCase() : null;
  let normalizedUnit =
    requestedUnit && ['g', 'ml', 'portion'].includes(requestedUnit) ? requestedUnit : defaultUnit;
  const parsedWeight = Number.parseFloat(weightAmount);
  let normalizedWeightAmount =
    Number.isFinite(parsedWeight) && parsedWeight > 0 ? Number(parsedWeight.toFixed(1)) : null;
  if (normalizedUnit === 'portion' && (!Number.isFinite(normalizedWeightAmount) || normalizedWeightAmount <= 0)) {
    normalizedWeightAmount = 1;
  }

  if (needsLookup) {
    try {
      productData = await lookupProduct({
        barcode: trimmedBarcode,
        query: trimmedName,
        userId: req.user.id,
      });
    } catch (error) {
      return res.status(502).json({ message: error.message || 'Nutrition lookup failed.' });
    }
    if (productData?.calories) {
      calorieValue = productData.calories;
      proteinValue = Number.isFinite(proteinValue) ? proteinValue : productData.protein ?? proteinValue;
      carbValue = Number.isFinite(carbValue) ? carbValue : productData.carbs ?? carbValue;
      fatValue = Number.isFinite(fatValue) ? fatValue : productData.fats ?? fatValue;
      if (!normalizedWeightAmount && productData.weightAmount) {
        normalizedWeightAmount = Number(productData.weightAmount);
        if (['ml', 'g', 'portion'].includes(productData.weightUnit)) {
          normalizedUnit = productData.weightUnit;
        }
      }
    }
  }

  if (!Number.isFinite(calorieValue) || calorieValue < 0) {
    return res
      .status(400)
      .json({ message: 'Unable to log without calories. Try adding a value or scanning a barcode.' });
  }

  const payload = {
    protein: Number.isFinite(proteinValue) && proteinValue > 0 ? proteinValue : 0,
    carbs: Number.isFinite(carbValue) && carbValue > 0 ? carbValue : 0,
    fats: Number.isFinite(fatValue) && fatValue > 0 ? fatValue : 0,
  };

  const entryDate = resolveDate(date);
  const displayName = trimmedName || productData?.name || (trimmedBarcode ? `Barcode ${trimmedBarcode}` : 'Logged item');
  const storedBarcode = trimmedBarcode || productData?.barcode || null;
  let normalizedPhotoData = null;
  if (typeof photoData === 'string' && photoData.trim()) {
    normalizedPhotoData = photoData.trim();
    if (normalizedPhotoData.startsWith('data:image')) {
      normalizedPhotoData = normalizedPhotoData.split(',').pop();
    }
    const MAX_BYTES = 5 * 1024 * 1024; // ~5MB base64 string length
    if (normalizedPhotoData.length > MAX_BYTES) {
      return res
        .status(413)
        .json({ message: 'Photo is too large. Try a smaller image or lower quality capture.' });
    }
  }

  insertEntryStatement.run(
    userId,
    entryDate,
    displayName,
    normalizedType,
    storedBarcode,
    calorieValue,
    payload.protein,
    payload.carbs,
    payload.fats,
    normalizedWeightAmount,
    normalizedUnit,
    normalizedPhotoData
  );

  return res.json({
    message: `${displayName} logged.`,
    date: entryDate,
    autoLookup: Boolean(productData),
  });
});

router.delete('/:entryId', authenticate, (req, res) => {
  const entryId = Number.parseInt(req.params.entryId, 10);
  if (!Number.isFinite(entryId) || entryId <= 0) {
    return res.status(400).json({ message: 'Provide a valid entry id.' });
  }

  const entry = entryByIdStatement.get(entryId);
  if (!entry || entry.userId !== req.user.id) {
    return res.status(404).json({ message: 'Entry not found.' });
  }

  deleteEntryStatement.run(entryId);
  return res.json({
    message: `${entry.name} removed.`,
    entry: {
      id: entry.id,
      date: entry.date,
      calories: entry.calories,
      protein: entry.protein,
      carbs: entry.carbs,
      fats: entry.fats,
      weightAmount: entry.weightAmount,
      weightUnit: entry.weightUnit,
      photoData: entry.photoData,
    },
  });
});

router.get('/lookup', authenticate, async (req, res) => {
  const barcode = (req.query.barcode || '').toString().trim();
  const query = (req.query.q || req.query.query || '').toString().trim();

  if (!barcode && !query) {
    return res.status(400).json({ message: 'Provide a barcode or search term.' });
  }

  try {
    const product = await lookupProduct({ barcode, query, userId: req.user.id });
    if (!product) {
      return res.status(404).json({ message: 'No nutrition data found for that item.' });
    }
    return res.json({ product });
  } catch (error) {
    return res.status(502).json({ message: error.message || 'Lookup failed. Try again later.' });
  }
});

router.get('/search', authenticate, async (req, res) => {
  const query = (req.query.q || req.query.query || '').toString().trim();
  if (!query || query.length < 2) {
    const local = query ? searchLocalEntries(req.user.id, query) : [];
    const quick = searchQuickAddSuggestions(query);
    const combined = [...local, ...quick]
      .sort((a, b) => (a.score ?? 99) - (b.score ?? 99))
      .slice(0, 10)
      .map(({ score, ...rest }) => rest);
    return res.json({ suggestions: combined });
  }
  const localSuggestions = searchLocalEntries(req.user.id, query);
  const quickSuggestions = searchQuickAddSuggestions(query);
  const remoteSuggestions = await getRemoteSuggestions(query);
  const combined = [];
  const seen = new Set();
  const normalizedQuery = normalizeText(query);
  const queryTokens = normalizedQuery.split(/\s+/).filter(Boolean);
  const multiTokenQuery = queryTokens.length > 1;
  const pushSuggestion = (item, scoreOverride, bias = 0) => {
    if (!item || !item.name || !isLikelyFoodName(item.name)) {
      return;
    }
    const key = item.name.toLowerCase().trim();
    if (!key || seen.has(key)) {
      return;
    }
    seen.add(key);
    const computedScore = computeSuggestionScore(item.name, query);
    const baseScore =
      typeof scoreOverride === 'number' ? Math.min(scoreOverride, computedScore) : computedScore;
    combined.push({
      ...item,
      score: baseScore + bias,
      tokenCoverage: computeTokenCoverageRatio(item.name, query),
    });
  };
  localSuggestions.forEach((item) => pushSuggestion(item, item.score, -0.1));
  quickSuggestions.forEach((item) => pushSuggestion(item, item.score, -0.15));
  remoteSuggestions.forEach((item) => {
    if (combined.length >= 10) return;
    pushSuggestion(item, undefined, 0.2);
  });
  const sortedCandidates = combined.sort((a, b) => {
    const coverageDiff = (b.tokenCoverage ?? 0) - (a.tokenCoverage ?? 0);
    if (Math.abs(coverageDiff) > 0.05) {
      return coverageDiff;
    }
    return (a.score ?? 99) - (b.score ?? 99);
  });
  const exactMatches = [];
  const others = [];
  sortedCandidates.forEach((item) => {
    if (normalizeText(item.name) === normalizedQuery) {
      exactMatches.push(item);
    } else {
      others.push(item);
    }
  });
  const prioritized = [...exactMatches, ...others];
  let filtered = sortedCandidates.filter((item) => item.score <= 0.7);
  if (!filtered.length) {
    filtered = prioritized;
  } else {
    filtered = prioritized.filter((item) => filtered.includes(item));
  }
  if (multiTokenQuery) {
    const coverageThreshold = queryTokens.length >= 3 ? 0.65 : 0.55;
    const coverageFiltered = filtered.filter((item) => (item.tokenCoverage ?? 0) >= coverageThreshold);
    if (coverageFiltered.length) {
      filtered = coverageFiltered;
    }
  }
  const sorted = filtered.slice(0, 10).map(({ score, tokenCoverage, ...rest }) => rest);
  return res.json({ suggestions: sorted });
});

router.__private__ = {
  getRemoteSuggestions,
  clearRemoteSuggestionCache,
  REMOTE_SEARCH_TIMEOUT_MS,
};

module.exports = router;

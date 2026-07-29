// js/ranking.js — 랭킹 시스템.
//   로컬(localStorage): 프로필(playerId + 닉네임) + 내 플레이 이력.
//   원격(Supabase): 사람×난이도당 최고 거리 1줄 → 전체 랭킹.
import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

export const DIFFS = ['easy', 'medium', 'hard'];
const PROFILE_KEY = 'mr-profile';
const HISTORY_KEY = 'mr-history';
const HISTORY_CAP = 50;

// ---- localStorage helpers -------------------------------------------------
function read(key, fallback) {
  try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; }
  catch { return fallback; }
}
function write(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); } catch {} }

// ---- profile --------------------------------------------------------------
export function getProfile() { return read(PROFILE_KEY, null); }

export function ensureProfile(nickname) {
  const cur = getProfile();
  const playerId = cur?.playerId || crypto.randomUUID();
  const nick = (nickname || cur?.nickname || '플레이어').trim().slice(0, 12) || '플레이어';
  const prof = { playerId, nickname: nick };
  write(PROFILE_KEY, prof);
  return prof;
}

export function setNickname(nickname) {
  const cur = getProfile();
  if (!cur) return;
  write(PROFILE_KEY, { ...cur, nickname: nickname.trim().slice(0, 12) || cur.nickname });
}

// ---- local history --------------------------------------------------------
export function getHistory(difficulty) {
  return read(HISTORY_KEY, [])
    .filter((r) => r.difficulty === difficulty)
    .sort((a, b) => b.ts - a.ts);
}

export function getLocalBest(difficulty) {
  return getHistory(difficulty).reduce((m, r) => Math.max(m, r.distance), 0);
}

// Append a run to local history. Returns { isBest } = new personal best for that difficulty.
export function addRun(difficulty, distance) {
  const d = Math.floor(distance);
  const prevBest = getLocalBest(difficulty);
  const all = read(HISTORY_KEY, []);
  all.push({ difficulty, distance: d, ts: Date.now() });
  write(HISTORY_KEY, all.slice(-HISTORY_CAP)); // keep most recent N overall
  return { isBest: d > prevBest };
}

// ---- remote (Supabase) ----------------------------------------------------
const supa = (SUPABASE_URL && SUPABASE_ANON_KEY)
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false } })
  : null;

export function remoteEnabled() { return !!supa; }

// Upsert my best for a difficulty (one row per player+difficulty). Call only on a new best.
export async function submitBest(difficulty, distance) {
  if (!supa) return;
  const p = getProfile();
  if (!p) return;
  try {
    await supa.from('scores').upsert(
      { player_id: p.playerId, nickname: p.nickname, difficulty, distance: Math.floor(distance) },
      { onConflict: 'player_id,difficulty' }
    );
  } catch { /* offline / failure — local record still stands, retry on next best */ }
}

// Top N of a difficulty, distance desc. Returns [{player_id, nickname, distance}].
export async function fetchTop(difficulty, limit = 100) {
  if (!supa) return [];
  try {
    const { data } = await supa.from('scores')
      .select('player_id,nickname,distance')
      .eq('difficulty', difficulty)
      .order('distance', { ascending: false })
      .limit(limit);
    return data || [];
  } catch { return []; }
}

// My global rank for a difficulty = (# rows with distance > myBest) + 1. Null if no best / offline.
export async function fetchMyRank(difficulty, myBest) {
  if (!supa || myBest <= 0) return null;
  try {
    const { count } = await supa.from('scores')
      .select('*', { count: 'exact', head: true })
      .eq('difficulty', difficulty)
      .gt('distance', Math.floor(myBest));
    return (count ?? 0) + 1;
  } catch { return null; }
}

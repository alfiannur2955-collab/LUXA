/**
 * Solar Exposure & 1-Day Animation Controller (`docs/FASE4_UI_SPEC.md` §4.6):
 * - Calls `engine.exposure(analysisId, date, null, northDeg)` once per date/north
 *   and caches the 13-hour result (06:00..18:00) in memory.
 * - Drives 1-day solar playback (`Space` shortcut / "Putar satu hari" button),
 *   respecting `prefers-reduced-motion`.
 */

import * as engine from '../engine.js';
import { getState, setState } from '../state.js';
import { prefersReducedMotion } from '../ui/glass.js';
import { showToast } from '../ui/toast.js';

class SolarExposureController {
  constructor() {
    this.cache = new Map(); // `${analysisId}|${date}|${northDeg}` -> exposure payload
    this.timerId = null;
    this.inFlightKey = null;
  }

  _key(analysisId, date, northDeg) {
    return `${analysisId}|${date}|${Math.round(Number(northDeg) || 0)}`;
  }

  async ensureExposureLoaded(dateOverride = null, northOverride = null) {
    const s = getState();
    const aid = s.analysisData?.analysis_id;
    if (!aid) return null;

    const date = dateOverride || s.sunDate || '2026-09-23';
    const northDeg =
      northOverride !== null && northOverride !== undefined
        ? Number(northOverride)
        : Number(s.config?.settings?.north_angle_deg || 0);
    const key = this._key(aid, date, northDeg);

    if (this.cache.has(key)) {
      const cached = this.cache.get(key);
      if (s.exposureData !== cached) {
        setState({ exposureData: cached, exposureLoading: false });
      }
      return cached;
    }

    if (this.inFlightKey === key) return null;
    this.inFlightKey = key;
    setState({ exposureLoading: true });

    try {
      const res = await engine.exposure(aid, date, null, { northAngleDeg: northDeg });
      this.cache.set(key, res);
      // Only apply if still on the same analysis & date
      const latest = getState();
      if (latest.analysisData?.analysis_id === aid && latest.sunDate === date) {
        setState({ exposureData: res, exposureLoading: false });
      } else {
        setState({ exposureLoading: false });
      }
      return res;
    } catch (err) {
      setState({ exposureLoading: false });
      showToast(err.message || 'Gagal memuat paparan matahari.', 'warn', 2600);
      return null;
    } finally {
      if (this.inFlightKey === key) this.inFlightKey = null;
    }
  }

  stopPlayback() {
    if (this.timerId) {
      window.clearInterval(this.timerId);
      this.timerId = null;
    }
    if (getState().sunPlaying) {
      setState({ sunPlaying: false });
    }
  }

  async togglePlayback() {
    const s = getState();
    if (s.step !== 'results' || !s.analysisData) {
      showToast('Putar matahari tersedia di langkah Hasil.', 'warn', 2200);
      return;
    }
    if (s.sunPlaying) {
      this.stopPlayback();
      return;
    }
    if (prefersReducedMotion()) {
      showToast('Animasi matahari dinonaktifkan sesuai preferensi gerak berkurang. Geser slider jam secara manual.', 'warn', 3200);
      return;
    }

    // Ensure hourly exposure is loaded before playing if sunlit filter is active
    if (s.facadeFilter === 'sunlit_now') {
      await this.ensureExposureLoaded();
    }

    setState({ sunPlaying: true, sunDomeVisible: true });
    this.timerId = window.setInterval(() => {
      const cur = getState();
      if (cur.step !== 'results' || !cur.sunPlaying) {
        this.stopPlayback();
        return;
      }
      const nextHour = cur.sunHour >= 18 ? 6 : cur.sunHour + 1;
      setState({ sunHour: nextHour });
    }, 650);
  }
}

export const exposureController = new SolarExposureController();

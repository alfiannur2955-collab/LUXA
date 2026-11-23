// Skala warna panas OTTV (0 / 25 / 35 / 50+ W/m², warna skala terang aplikasi) untuk Presentasi dan laporan.
import { ottvToThreeColor } from '../viewer/modes.js';

export const HEAT_TOKENS = { heat0: '#f6e7c8', heat1: '#eeb066', heat2: '#cf5a1f', heat3: '#7d1d10' };
export const heatColor = (v) => '#' + ottvToThreeColor(v, HEAT_TOKENS).getHexString();

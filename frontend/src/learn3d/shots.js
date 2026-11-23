// Sudut kamera (titik awal; disetel di Tahap 2). az dari utara searah jarum jam, el dari horizon, dist dalam meter.
// Sumbu dunia: x = timur, z = selatan. Fasad Barat tower ada di x = -14, lantai k mulai di y = 13,5 + 4k.
export const SHOTS = {
  beranda: { target: [0, 22, 0], az: 200, el: 35, dist: 1100 },
  bab1: { target: [0, 40, 0], az: 200, el: 32, dist: 860 },
  bab4: { target: [-40, 60, 10], az: 200, el: 40, dist: 1050 },
  bab5: { target: [-14, 55.2, -6], az: 245, el: 14, dist: 46, shadow: 28, shadowFocus: [-14, 55, -6] },
  bab7: { target: [0, 50, 0], az: 200, el: 30, dist: 760 },
};

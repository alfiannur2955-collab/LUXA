// Sudut kamera (titik awal; disetel di Tahap 2). az dari utara searah jarum jam, el dari horizon, dist dalam meter.
// Sumbu dunia: x = timur, z = selatan. Fasad Barat tower ada di x = -14, lantai k mulai di y = 13,5 + 4k.
export const SHOTS = {
  beranda: { target: [0, 22, 0], az: 212, el: 35, dist: 1300 },
  bab1: { target: [0, 40, 0], az: 212, el: 32, dist: 900 },
  bab4: { target: [0, 34, 0], az: 212, el: 52, dist: 1150 },
  bab5: { target: [-14, 55.2, -6], az: 300, el: 16, dist: 46, shadow: 28, shadowFocus: [-14, 55, -6] },
  bab7: { target: [0, 50, 0], az: 225, el: 30, dist: 760 },
};

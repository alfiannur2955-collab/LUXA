// Sudut kamera (titik awal; disetel di Tahap 2). az dari utara searah jarum jam, el dari horizon, dist dalam meter.
// Sumbu dunia: x = timur, z = selatan. Fasad Barat tower ada di x = -14, lantai k mulai di y = 13,5 + 4k.
export const SHOTS = {
  beranda: { target: [0, 22, 0], az: 200, el: 35, dist: 1100 },
  bab1: { target: [0, 40, 0], az: 200, el: 32, dist: 860 },
  bab2: { target: [-17.4, 56.8, -6], az: 215, el: 10, dist: 54, shadow: 26, shadowFocus: [-14, 55, -6] },
  bab3: { target: [-14, 52, -6], az: 270, el: 3, dist: 340, shadow: 90, shadowFocus: [-14, 52, -6] },
  bab4: { target: [-40, 60, 10], az: 200, el: 40, dist: 1050 },
  bab5: { target: [-14, 55.2, -6], az: 245, el: 14, dist: 46, shadow: 28, shadowFocus: [-14, 55, -6] },
  bab6: { target: [-15.1, 54.85, -8.6], az: 222, el: 9, dist: 11.5, shadow: 10, shadowFocus: [-15, 54.6, -9] },
  bab7: { target: [0, 48, 0], az: 200, el: 26, dist: 640 },
  bab8: { target: [4, 14, 6], az: 160, el: 50, dist: 210, shadow: 70, shadowFocus: [0, 14, 0] },
};
